import type { Pool, PoolClient } from "pg";
import {
  canonical,
  digest,
  identityKey,
  text,
  trust,
  validateIdentity,
  type AttemptIdentity,
  type TransactionLocator,
  type Verification,
} from "./evidence.ts";
import type { EvidenceBundle, EvidencePolicy } from "./verifier.ts";
export interface Observation {
  readonly sourceId: string;
  readonly endpoint: string;
  readonly bundle: EvidenceBundle | null;
  readonly verificationPolicy: EvidencePolicy;
  readonly verification: Verification;
}
export interface Decision extends Verification {
  readonly conflicting: boolean;
  readonly observations: readonly Observation[];
}
export interface Claim {
  readonly key: string;
  readonly workerId: string;
  readonly fence: string;
  readonly identity: AttemptIdentity;
  readonly locator: TransactionLocator;
}
/** Only local dedicated test DBs are accepted in M5-D. Not wired to the running host. */
export class NativeReconciliationRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  private async client(): Promise<PoolClient> {
    const c = await this.pool.connect();
    try {
      const r = await c.query<{
        db: string;
        role: string;
        host: string | null;
      }>(
        "SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host",
      );
      const x = r.rows[0];
      if (
        x?.db !== "disburse_test" ||
        x.role !== "disburse_test" ||
        (x.host !== null &&
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(x.host))
      )
        throw new Error("Dedicated local test database required");
      return c;
    } catch (e) {
      c.release();
      throw e;
    }
  }
  async enqueue(
    identity: AttemptIdentity,
    locator: TransactionLocator,
  ): Promise<string> {
    validateIdentity(identity);
    text(locator.transactionHash);
    text(locator.senderId);
    const key = identityKey(identity),
      c = await this.client();
    try {
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO public.native_reconciliation_jobs(job_key,identity,locator) VALUES($1,$2::jsonb,$3::jsonb) ON CONFLICT DO NOTHING",
        [key, canonical(identity), canonical(locator)],
      );
      const r = await c.query(
        "SELECT identity,locator FROM public.native_reconciliation_jobs WHERE job_key=$1 FOR UPDATE",
        [key],
      );
      if (
        canonical(r.rows[0]?.identity) !== canonical(identity) ||
        canonical(r.rows[0]?.locator) !== canonical(locator)
      )
        throw new Error(
          "Conflicting immutable reconciliation identity/locator",
        );
      await c.query("COMMIT");
      return key;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async claim(
    workerId: string,
    ttlMs = 30000,
    key?: string,
  ): Promise<Claim | null> {
    text(workerId);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300000)
      throw new Error("Invalid reconciliation lease");
    const c = await this.client();
    try {
      const r = await c.query(
        `WITH candidate AS (
        SELECT job_key FROM public.native_reconciliation_jobs
        WHERE (state='Queued' OR (state='Processing' AND lease_until<=clock_timestamp()))
        AND ($3::text IS NULL OR job_key=$3) ORDER BY created_at,job_key FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE public.native_reconciliation_jobs j SET state='Processing',fence=j.fence+1,
        worker_id=$1,lease_until=clock_timestamp()+($2::bigint*interval '1 millisecond'),updated_at=clock_timestamp()
        FROM candidate c WHERE j.job_key=c.job_key RETURNING j.*`,
        [workerId, ttlMs, key ?? null],
      );
      const x = r.rows[0];
      return x
        ? {
            key: String(x.job_key),
            workerId,
            fence: String(x.fence),
            identity: x.identity as AttemptIdentity,
            locator: x.locator as TransactionLocator,
          }
        : null;
    } finally {
      c.release();
    }
  }
  /** Explicit read-only recheck request; never clears a conflict or changes attempt identity. */
  async recheck(key: string): Promise<void> {
    const c = await this.client();
    try {
      await c.query(
        "UPDATE public.native_reconciliation_jobs SET state='Queued',worker_id=NULL,lease_until=NULL,fence=fence+1 WHERE job_key=$1 AND state IN ('Done','ManualReview')",
        [key],
      );
    } finally {
      c.release();
    }
  }
  async complete(claim: Claim, decision: Decision): Promise<Verification> {
    if (Buffer.byteLength(canonical(decision)) > 8 * 1024 * 1024)
      throw new Error("Oversized evidence record");
    const c = await this.client();
    try {
      await c.query("BEGIN");
      const row = await c.query(
        `SELECT * FROM public.native_reconciliation_jobs WHERE job_key=$1 FOR UPDATE`,
        [claim.key],
      );
      // Lock acquisition may outlive the lease: evaluate database time in a new statement.
      const validity = await c.query(
        "SELECT lease_until>clock_timestamp() AS valid FROM public.native_reconciliation_jobs WHERE job_key=$1",
        [claim.key],
      );
      const j = row.rows[0];
      if (
        !j ||
        j.state !== "Processing" ||
        j.worker_id !== claim.workerId ||
        String(j.fence) !== claim.fence ||
        !validity.rows[0]?.valid
      )
        throw new Error("Stale reconciliation fence/lease");
      if (
        canonical(j.identity) !== canonical(claim.identity) ||
        canonical(j.locator) !== canonical(claim.locator)
      )
        throw new Error("Altered reconciliation claim");
      let conflicting = Boolean(j.conflicted) || decision.conflicting;
      if (
        j.semantic_digest &&
        decision.semanticDigest &&
        j.semantic_digest !== decision.semanticDigest
      )
        conflicting = true;
      for (const obs of decision.observations) {
        text(obs.sourceId);
        text(obs.endpoint);
        await c.query(
          "INSERT INTO public.native_receipt_observations(job_key,source_id,content_digest,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
          [claim.key, obs.sourceId, digest(obs), canonical(obs)],
        );
      }
      if (
        decision.transferReceiptId &&
        decision.classification !== "ManualReview"
      ) {
        const i = claim.identity;
        for (const [table, column, value] of [
          [
            "native_reconciliation_receipt_claims",
            "receipt_id",
            decision.transferReceiptId,
          ],
          [
            "native_reconciliation_transaction_claims",
            "transaction_hash",
            claim.locator.transactionHash,
          ],
        ] as const) {
          await c.query(
            `INSERT INTO public.${table}(chain_id,contract_id,${column},job_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [i.chainId, i.contractId, value, claim.key],
          );
          const existing = await c.query(
            `SELECT job_key FROM public.${table} WHERE chain_id=$1 AND contract_id=$2 AND ${column}=$3`,
            [i.chainId, i.contractId, value],
          );
          if (existing.rows[0]?.job_key !== claim.key) conflicting = true;
        }
      }
      const final: Verification = conflicting
        ? {
            classification: "ManualReview",
            reason:
              "Conflicting evidence or reused receipt/transaction; recovery blocked",
            transferReceiptId: null,
            callbackReceiptId: null,
            semanticDigest: null,
            trust,
          }
        : decision;
      const inserted = await c.query(
        `INSERT INTO public.native_reconciliation_decisions(job_key,fence,decision)
         SELECT job_key,fence,$3::jsonb FROM public.native_reconciliation_jobs
         WHERE job_key=$1 AND fence=$2::bigint AND worker_id=$4
         AND state='Processing' AND lease_until>clock_timestamp()`,
        [
          claim.key,
          claim.fence,
          canonical({ ...final, conflicting, workerId: claim.workerId }),
          claim.workerId,
        ],
      );
      if (inserted.rowCount !== 1)
        throw new Error("Stale reconciliation fence/lease");
      const completed = await c.query(
        `UPDATE public.native_reconciliation_jobs SET state=$2,semantic_digest=COALESCE(semantic_digest,$3),conflicted=$4,
        worker_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE job_key=$1 AND state='Processing'
        AND worker_id=$5 AND fence=$6::bigint AND lease_until>clock_timestamp()`,
        [
          claim.key,
          final.classification === "ManualReview" ? "ManualReview" : "Done",
          final.semanticDigest,
          conflicting,
          claim.workerId,
          claim.fence,
        ],
      );
      if (completed.rowCount !== 1)
        throw new Error("Stale reconciliation fence/lease");
      await c.query("COMMIT");
      return final;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async history(key: string): Promise<unknown> {
    const c = await this.client();
    try {
      const [job, observations, decisions] = await Promise.all([
        c.query(
          "SELECT * FROM public.native_reconciliation_jobs WHERE job_key=$1",
          [key],
        ),
        c.query(
          "SELECT source_id,content_digest,payload FROM public.native_receipt_observations WHERE job_key=$1 ORDER BY source_id,content_digest",
          [key],
        ),
        c.query(
          "SELECT fence::text,decision FROM public.native_reconciliation_decisions WHERE job_key=$1 ORDER BY fence",
          [key],
        ),
      ]);
      for (const o of observations.rows)
        if (digest(o.payload) !== o.content_digest)
          throw new Error("Evidence integrity mismatch");
      return {
        job: job.rows[0] ?? null,
        observations: observations.rows,
        decisions: decisions.rows,
      };
    } finally {
      c.release();
    }
  }
}
