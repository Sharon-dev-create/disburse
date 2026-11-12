import { createHash } from "node:crypto";
import {
  validatePayoutSnapshot,
  type ExecutionJobKey,
  type PayoutReservedEvent,
  type PayoutSnapshot,
} from "../domain/payout.ts";
import {
  assertTransition,
  canTransition,
  type JobState,
  type TransitionEvidence,
} from "../state-machine/state.ts";
import { stableExecutionReference } from "../coordinator/references.ts";
import type { PostgresQuery } from "./postgres-security-repositories.ts";
import type {
  DurableJobRepository,
  ExecutionAttempt,
  ExecutionJobCreation,
  ExecutionJobFailure,
  ExecutionJobRecord,
  Lease,
  PersistedExecutionJob,
} from "./repository.ts";

export interface PostgresJobClient {
  readonly query: PostgresQuery;
  release(): void;
}

export interface PostgresJobPool {
  connect(): Promise<PostgresJobClient>;
}

const maximumU64 = 18_446_744_073_709_551_615n;
const maximumU128 = 340_282_366_920_938_463_463_374_607_431_768_211_455n;
const maximumIntervalMs = 2_147_483_647;

const jobSelect = `
  SELECT
    j.job_id::text AS job_id,
    j.network_id, j.contract_id, j.payout_id::text AS payout_id,
    j.campaign_id::text AS campaign_id,
    j.job_creation_idempotency_key, j.snapshot_digest, j.payload_hash,
    j.payout_snapshot, j.input_atomic_amount::text AS input_atomic_amount,
    j.expected_output_atomic_amount::text AS expected_output_atomic_amount,
    j.observed_contract_status, j.state, j.execution_reference,
    j.state_version, j.fencing_counter::text AS fencing_counter,
    j.attempt_count, j.next_eligible_at, j.failure_code, j.failure_description,
    j.discovery_tx_hash, j.discovery_block_hash, j.discovery_receipt_id,
    j.discovery_event_index, j.discovery_block_height::text AS discovery_block_height,
    j.created_at, j.updated_at,
    l.worker_id, l.fencing_token::text AS lease_fencing_token, l.expires_at
  FROM public.execution_jobs j
  LEFT JOIN public.job_leases l ON l.job_id = j.job_id`;

export class JobCreationConflictError extends Error {
  constructor() {
    super(
      "Execution-job idempotency or payout identity conflicts with persisted data",
    );
    this.name = "JobCreationConflictError";
  }
}

export class StaleExecutionJobError extends Error {
  constructor(message = "Execution job version or lease is stale") {
    super(message);
    this.name = "StaleExecutionJobError";
  }
}

export class PostgresJobRepository implements DurableJobRepository {
  private readonly pool: PostgresJobPool;

  constructor(pool: PostgresJobPool) {
    this.pool = pool;
  }

  async enqueueDiscovered(
    event: PayoutReservedEvent,
    payout: PayoutSnapshot,
    nowMs: number,
  ): Promise<{ readonly job: ExecutionJobRecord; readonly created: boolean }> {
    void nowMs;
    const result = await this.createIdempotent({
      event,
      payout,
      idempotencyKey: jobCreationIdempotencyKey(event),
    });
    return { job: result.job, created: result.created };
  }

  async createIdempotent(creation: ExecutionJobCreation): Promise<{
    readonly job: PersistedExecutionJob;
    readonly created: boolean;
  }> {
    const { event, payout, idempotencyKey } = creation;
    validateExecutionJobCreation(creation);
    const key: ExecutionJobKey = {
      networkId: event.identity.networkId,
      contractId: event.identity.contractId,
      payoutId: payout.payoutId,
    };
    const snapshotJson = canonicalJson(payout);
    const snapshotDigest = hashPayoutSnapshot(payout);
    const payloadHash = hashJobCreationPayload(key, payout, event);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN", []);
      const inserted = await client.query(
        `INSERT INTO public.execution_jobs (
          network_id, contract_id, payout_id, campaign_id,
          job_creation_idempotency_key, snapshot_digest, payload_hash,
          payout_snapshot, input_atomic_amount, expected_output_atomic_amount,
          observed_contract_status, state, execution_reference,
          discovery_tx_hash, discovery_block_hash, discovery_receipt_id,
          discovery_event_index, discovery_block_height
        ) VALUES (
          $1, $2, $3::numeric, $4::numeric,
          $5, $6, $7, $8::jsonb, $9::numeric, $10::numeric,
          'Reserved', 'Discovered', $11, $12, $13, $14, $15, $16::numeric
        )
        ON CONFLICT DO NOTHING
        RETURNING job_id::text AS job_id`,
        [
          key.networkId,
          key.contractId,
          key.payoutId,
          payout.campaignId,
          idempotencyKey,
          snapshotDigest,
          payloadHash,
          snapshotJson,
          payout.inputAmount.atomicAmount,
          payout.expectedOutput.atomicAmount,
          stableExecutionReference(key),
          event.identity.transactionHash,
          event.identity.blockHash,
          event.identity.receiptId,
          event.identity.eventIndex,
          event.identity.blockHeight,
        ],
      );

      let jobId: string;
      let created: boolean;
      if (inserted.rows[0]) {
        jobId = requireString(inserted.rows[0], "job_id");
        created = true;
      } else {
        const conflicts = await client.query(
          `SELECT job_id::text AS job_id, payload_hash, snapshot_digest,
                  network_id,
                  contract_id, payout_id::text AS payout_id,
                  job_creation_idempotency_key
           FROM public.execution_jobs
           WHERE (network_id = $1 AND contract_id = $2
                  AND job_creation_idempotency_key = $3)
              OR (network_id = $1 AND contract_id = $2 AND payout_id = $4::numeric)
           FOR UPDATE`,
          [key.networkId, key.contractId, idempotencyKey, key.payoutId],
        );
        if (conflicts.rows.length !== 1) throw new JobCreationConflictError();
        const existing = conflicts.rows[0]!;
        const existingIdempotencyKey = requireString(
          existing,
          "job_creation_idempotency_key",
        );
        const payloadMatches =
          existingIdempotencyKey === idempotencyKey
            ? requireString(existing, "payload_hash") === payloadHash
            : requireString(existing, "snapshot_digest") === snapshotDigest;
        if (
          !payloadMatches ||
          requireString(existing, "network_id") !== key.networkId ||
          requireString(existing, "contract_id") !== key.contractId ||
          requireString(existing, "payout_id") !== key.payoutId
        ) {
          throw new JobCreationConflictError();
        }
        jobId = requireString(existing, "job_id");
        created = false;
      }

      const job = await readJob(client, jobId);
      await client.query("COMMIT", []);
      return { job, created };
    } catch (error) {
      await client.query("ROLLBACK", []).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimNext(
    workerId: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<ExecutionJobRecord | null> {
    void nowMs;
    validateWorkerAndTtl(workerId, ttlMs);
    return this.transaction(async (client) => {
      const result = await client.query(
        `SELECT j.job_id::text AS job_id, j.state, j.state_version
         FROM public.execution_jobs j
         LEFT JOIN public.job_leases l ON l.job_id = j.job_id
         WHERE j.state IN ('Queued', 'Leased')
           AND j.next_eligible_at <= statement_timestamp()
           AND (l.job_id IS NULL OR l.expires_at <= statement_timestamp())
         ORDER BY j.next_eligible_at, j.created_at, j.job_id
         LIMIT 1
         FOR UPDATE OF j SKIP LOCKED`,
        [],
      );
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      const jobId = requireString(row, "job_id");
      const state = readJobState(row.state);
      const stateVersion = requireSafeInteger(row, "state_version");

      if (state === "Leased") {
        assertTransition("Leased", "Queued");
        await updateJobState(client, jobId, state, stateVersion, "Queued");
        await client.query(
          `DELETE FROM public.job_leases
           WHERE job_id = $1::bigint AND expires_at <= statement_timestamp()`,
          [jobId],
        );
      } else {
        await client.query(
          `DELETE FROM public.job_leases
           WHERE job_id = $1::bigint AND expires_at <= statement_timestamp()`,
          [jobId],
        );
      }

      const afterRecoveryVersion = stateVersion + (state === "Leased" ? 1 : 0);
      assertTransition("Queued", "Leased");
      const claimed = await client.query(
        `UPDATE public.execution_jobs
         SET state = 'Leased', state_version = state_version + 1,
             fencing_counter = fencing_counter + 1,
             updated_at = statement_timestamp()
         WHERE job_id = $1::bigint AND state = 'Queued'
           AND state_version = $2
         RETURNING state_version, fencing_counter::text AS fencing_counter`,
        [jobId, afterRecoveryVersion],
      );
      if (!claimed.rows[0]) throw new StaleExecutionJobError();
      const fencingToken = requireString(claimed.rows[0], "fencing_counter");
      await client.query(
        `INSERT INTO public.job_leases (
           job_id, worker_id, fencing_token, acquired_at, renewed_at, expires_at
         )
         VALUES (
           $1::bigint, $2, $3::numeric, statement_timestamp(),
           statement_timestamp(),
           statement_timestamp() + ($4::bigint * interval '1 millisecond')
         )`,
        [jobId, workerId, fencingToken, ttlMs],
      );
      return readJob(client, jobId);
    });
  }

  async renewLease(
    key: ExecutionJobKey,
    lease: Lease,
    nowMs: number,
    ttlMs: number,
  ): Promise<Lease | null> {
    void nowMs;
    validateWorkerAndTtl(lease.workerId, ttlMs);
    return this.transaction(async (client) => {
      const job = await lockJob(client, key);
      if (!job) return null;
      if (!(await hasValidLease(client, job, lease))) return null;
      const updated = await client.query(
        `UPDATE public.execution_jobs
         SET state_version = state_version + 1,
             updated_at = statement_timestamp()
         WHERE job_id = $1::bigint AND state_version = $2
         RETURNING state_version`,
        [job.jobId, lease.stateVersion],
      );
      if (!updated.rows[0]) return null;
      const renewed = await client.query(
        `UPDATE public.job_leases
         SET renewed_at = statement_timestamp(),
             expires_at = statement_timestamp() + ($4::bigint * interval '1 millisecond')
         WHERE job_id = $1::bigint AND worker_id = $2
           AND fencing_token = $3::numeric
           AND expires_at > statement_timestamp()
         RETURNING worker_id, fencing_token::text AS lease_fencing_token,
                   expires_at`,
        [job.jobId, lease.workerId, lease.fencingToken, ttlMs],
      );
      if (!renewed.rows[0]) throw new StaleExecutionJobError();
      return mapLease(
        renewed.rows[0],
        requireSafeInteger(updated.rows[0], "state_version"),
      );
    });
  }

  async transition(
    key: ExecutionJobKey,
    expectedVersion: number,
    next: JobState,
    evidence: TransitionEvidence,
    lease: Lease | null,
    nowMs: number,
  ): Promise<ExecutionJobRecord> {
    void nowMs;
    return this.transaction(async (client) => {
      const job = await lockJob(client, key);
      if (!job) throw new Error("Execution job not found");
      if (job.version !== expectedVersion)
        throw new StaleExecutionJobError("Execution job version conflict");
      if (lease) {
        if (
          lease.stateVersion !== expectedVersion ||
          !(await hasValidLease(client, job, lease))
        )
          throw new StaleExecutionJobError("Worker lease is stale or expired");
      } else if (requiresWorkerLease(job.state)) {
        throw new StaleExecutionJobError("A live worker lease is required");
      }

      assertTransition(job.state, next, evidence);
      await updateJobState(client, job.jobId, job.state, expectedVersion, next);
      if (
        lease &&
        (next === "Queued" || next === "Completed" || next === "Abandoned")
      ) {
        await deleteCurrentLease(client, job.jobId, lease);
      }
      return readJob(client, job.jobId);
    });
  }

  async appendAttempt(
    key: ExecutionJobKey,
    lease: Lease,
    attempt: ExecutionAttempt,
    nowMs: number,
  ): Promise<ExecutionJobRecord> {
    void nowMs;
    validateAttempt(attempt);
    return this.transaction(async (client) => {
      const job = await lockJob(client, key);
      if (!job) throw new Error("Execution job not found");
      if (
        lease.stateVersion !== job.version ||
        !(await hasValidLease(client, job, lease))
      )
        throw new StaleExecutionJobError("Worker lease is stale or expired");
      if (attempt.sequence !== job.attemptCount + 1)
        throw new Error("Execution attempt sequence must be contiguous");

      const inserted = await client.query(
        `INSERT INTO public.execution_attempts (
           job_id, sequence_number, attempt_key, phase, idempotency_key,
           outcome, started_at
         )
         VALUES (
           $1::bigint, $2, $3, $4, $5, $6, statement_timestamp()
         )
         ON CONFLICT DO NOTHING
         RETURNING attempt_id`,
        [
          job.jobId,
          attempt.sequence,
          attempt.attemptKey,
          attempt.phase,
          attempt.idempotencyKey,
          attempt.outcome,
        ],
      );
      if (!inserted.rows[0])
        throw new Error("Duplicate execution attempt key or idempotency key");
      const updated = await client.query(
        `UPDATE public.execution_jobs
         SET attempt_count = attempt_count + 1,
             state_version = state_version + 1,
             updated_at = statement_timestamp()
         WHERE job_id = $1::bigint AND state_version = $2
         RETURNING state_version`,
        [job.jobId, lease.stateVersion],
      );
      if (!updated.rows[0]) throw new StaleExecutionJobError();
      await advanceLeaseVersion(client, job.jobId, lease);
      return readJob(client, job.jobId);
    });
  }

  async releaseLease(
    key: ExecutionJobKey,
    lease: Lease,
    nowMs: number,
  ): Promise<PersistedExecutionJob> {
    void nowMs;
    return this.transaction(async (client) => {
      const job = await lockJob(client, key);
      if (!job) throw new Error("Execution job not found");
      if (
        lease.stateVersion !== job.version ||
        !(await hasValidLease(client, job, lease))
      )
        throw new StaleExecutionJobError("Worker lease is stale or expired");
      await client.query(
        `DELETE FROM public.job_leases
         WHERE job_id = $1::bigint AND worker_id = $2
           AND fencing_token = $3::numeric
           AND expires_at > statement_timestamp()`,
        [job.jobId, lease.workerId, lease.fencingToken],
      );
      await bumpVersion(client, job.jobId, lease.stateVersion);
      return readJob(client, job.jobId);
    });
  }

  async recordFailure(
    key: ExecutionJobKey,
    lease: Lease,
    failure: ExecutionJobFailure,
    nowMs: number,
  ): Promise<PersistedExecutionJob> {
    void nowMs;
    validateFailure(failure);
    return this.transaction(async (client) => {
      const job = await lockJob(client, key);
      if (!job) throw new Error("Execution job not found");
      if (
        lease.stateVersion !== job.version ||
        !(await hasValidLease(client, job, lease))
      )
        throw new StaleExecutionJobError("Worker lease is stale or expired");
      const updated = await client.query(
        `UPDATE public.execution_jobs
         SET failure_code = $3, failure_description = $4,
             state_version = state_version + 1,
             updated_at = statement_timestamp()
         WHERE job_id = $1::bigint AND state_version = $2
         RETURNING state_version`,
        [job.jobId, lease.stateVersion, failure.code, failure.description],
      );
      if (!updated.rows[0]) throw new StaleExecutionJobError();
      await advanceLeaseVersion(client, job.jobId, lease);
      return readJob(client, job.jobId);
    });
  }

  async recoverExpiredLeases(
    nowMs: number,
  ): Promise<{ readonly recovered: number; readonly manualReview: number }> {
    void nowMs;
    return this.transaction(async (client) => {
      const expired = await client.query(
        `SELECT j.job_id::text AS job_id, j.state, j.state_version,
                l.fencing_token::text AS fencing_token
         FROM public.execution_jobs j
         JOIN public.job_leases l ON l.job_id = j.job_id
         WHERE l.expires_at <= statement_timestamp()
         ORDER BY l.expires_at, j.job_id
         FOR UPDATE OF j SKIP LOCKED`,
        [],
      );
      let recovered = 0;
      let manualReview = 0;
      for (const row of expired.rows) {
        const jobId = requireString(row, "job_id");
        const state = readJobState(row.state);
        const version = requireSafeInteger(row, "state_version");
        const action = expiredLeaseRecoveryAction(state);
        if (action === "queue") {
          assertTransition("Leased", "Queued");
          await updateJobState(client, jobId, state, version, "Queued");
        } else if (action === "manual-review") {
          assertTransition(state, "ManualReview");
          await updateJobState(client, jobId, state, version, "ManualReview");
          manualReview += 1;
        } else {
          await bumpVersion(client, jobId, version);
          if (state === "ManualReview") manualReview += 1;
        }
        const deleted = await client.query(
          `DELETE FROM public.job_leases
           WHERE job_id = $1::bigint AND fencing_token = $2::numeric
             AND expires_at <= statement_timestamp()`,
          [jobId, requireString(row, "fencing_token")],
        );
        if (deleted.rowCount !== 1)
          throw new StaleExecutionJobError(
            "Expired lease changed during recovery",
          );
        recovered += 1;
      }
      return { recovered, manualReview };
    });
  }

  async getById(jobId: string): Promise<PersistedExecutionJob | null> {
    if (!/^[1-9]\d*$/.test(jobId) || BigInt(jobId) > 9_223_372_036_854_775_807n)
      throw new Error(
        "Execution job ID must be a positive BIGINT decimal string",
      );
    return this.readOnly(async (client) => {
      const found = await client.query(
        "SELECT job_id::text AS job_id FROM public.execution_jobs WHERE job_id = $1::bigint",
        [jobId],
      );
      return found.rows[0] ? readJob(client, jobId) : null;
    });
  }

  async getByPayout(
    key: ExecutionJobKey,
  ): Promise<PersistedExecutionJob | null> {
    validateJobKey(key);
    return this.readOnly(async (client) => {
      const result = await client.query(
        `SELECT job_id::text AS job_id FROM public.execution_jobs
         WHERE network_id = $1 AND contract_id = $2 AND payout_id = $3::numeric`,
        [key.networkId, key.contractId, key.payoutId],
      );
      return result.rows[0]
        ? readJob(client, requireString(result.rows[0], "job_id"))
        : null;
    });
  }

  async get(key: ExecutionJobKey): Promise<ExecutionJobRecord | null> {
    return this.getByPayout(key);
  }

  private async transaction<T>(
    work: (client: PostgresJobClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN", []);
      const result = await work(client);
      await client.query("COMMIT", []);
      return result;
    } catch (error) {
      await client.query("ROLLBACK", []).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readOnly<T>(
    work: (client: PostgresJobClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", []);
      const result = await work(client);
      await client.query("COMMIT", []);
      return result;
    } catch (error) {
      await client.query("ROLLBACK", []).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function jobCreationIdempotencyKey(event: PayoutReservedEvent): string {
  return `disburse-job:v1:${createHash("sha256")
    .update(canonicalJson(event), "utf8")
    .digest("hex")}`;
}

export function hashExecutionJobPayload(
  key: ExecutionJobKey,
  payout: PayoutSnapshot,
): string {
  return createHash("sha256")
    .update(canonicalJson({ key, payout }), "utf8")
    .digest("hex");
}

export function hashPayoutSnapshot(payout: PayoutSnapshot): string {
  return createHash("sha256")
    .update(canonicalJson(payout), "utf8")
    .digest("hex");
}

export function hashJobCreationPayload(
  key: ExecutionJobKey,
  payout: PayoutSnapshot,
  event: PayoutReservedEvent,
): string {
  return createHash("sha256")
    .update(canonicalJson({ key, payout, event }), "utf8")
    .digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Snapshot contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value !== "object")
    throw new Error("Snapshot contains an unsupported value");
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

export function expiredLeaseRecoveryAction(
  state: JobState,
): "queue" | "manual-review" | "release-only" {
  if (state === "Leased") return "queue";
  if (
    state === "ManualReview" ||
    state === "Completed" ||
    state === "Abandoned"
  )
    return "release-only";
  return canTransition(state, "ManualReview")
    ? "manual-review"
    : "release-only";
}

export function validateExecutionJobCreation(
  creation: ExecutionJobCreation,
): void {
  const { event, payout, idempotencyKey } = creation;
  if (
    !isRecord(event) ||
    !isRecord(event.identity) ||
    !isPayoutSnapshot(payout) ||
    typeof idempotencyKey !== "string" ||
    typeof event.identity.networkId !== "string" ||
    typeof event.identity.contractId !== "string" ||
    typeof event.identity.transactionHash !== "string" ||
    typeof event.identity.blockHash !== "string" ||
    typeof event.identity.receiptId !== "string" ||
    typeof event.identity.blockHeight !== "string" ||
    typeof event.payoutId !== "string" ||
    typeof event.campaignId !== "string"
  )
    throw new Error("Execution-job creation payload is malformed");
  validatePayoutSnapshot(payout);
  validateJobKey({
    networkId: event.identity.networkId,
    contractId: event.identity.contractId,
    payoutId: payout.payoutId,
  });
  validateU64(event.campaignId, "Campaign ID");
  validateU64(event.identity.blockHeight, "Discovery block height");
  if (
    event.event !== "payout_reserved" ||
    event.contractStatus !== "Reserved" ||
    event.payoutId !== payout.payoutId ||
    event.campaignId !== payout.campaignId ||
    payout.contractStatus !== "Reserved"
  )
    throw new Error(
      "Only a matching Reserved payout observation can create a job",
    );
  validateText(
    event.identity.transactionHash,
    "Discovery transaction hash",
    512,
  );
  validateText(event.identity.blockHash, "Discovery block hash", 512);
  validateText(event.identity.receiptId, "Discovery receipt ID", 512);
  if (
    !Number.isSafeInteger(event.identity.eventIndex) ||
    event.identity.eventIndex < 0
  )
    throw new Error(
      "Discovery event index must be a non-negative safe integer",
    );
  validateU128(payout.inputAmount.atomicAmount, "Input amount");
  validateU128(payout.expectedOutput.atomicAmount, "Expected output amount");
  if (
    !payout.inputAmount.tokenId.trim() ||
    !payout.expectedOutput.tokenId.trim()
  )
    throw new Error("Payout token identifiers are required");
  validateText(idempotencyKey, "Job-creation idempotency key", 256);
}

function validateJobKey(key: ExecutionJobKey): void {
  validateText(key.networkId, "Payout network identity", 256);
  validateText(key.contractId, "Payout contract identity", 256);
  validateU64(key.payoutId, "Payout ID");
}

function validateText(
  value: string,
  label: string,
  maximumLength: number,
): void {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximumLength ||
    containsControlCharacters(value)
  )
    throw new Error(`${label} is invalid`);
}

function validateU64(value: string, label: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > maximumU64)
    throw new Error(
      `${label} must be a canonical unsigned 64-bit decimal string`,
    );
}

function validateU128(value: string, label: string): void {
  if (!/^[1-9]\d*$/.test(value) || BigInt(value) > maximumU128)
    throw new Error(
      `${label} must be a positive unsigned 128-bit decimal string`,
    );
}

function validateWorkerAndTtl(workerId: string, ttlMs: number): void {
  validateText(workerId, "Worker ID", 256);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > maximumIntervalMs)
    throw new Error(
      "Lease duration must be a positive supported millisecond value",
    );
}

function validateAttempt(attempt: ExecutionAttempt): void {
  if (
    !Number.isSafeInteger(attempt.sequence) ||
    attempt.sequence < 1 ||
    !Number.isSafeInteger(attempt.startedAtMs)
  )
    throw new Error("Execution attempt is malformed");
  validateText(attempt.attemptKey, "Execution attempt key", 256);
  validateText(
    attempt.idempotencyKey,
    "Execution attempt idempotency key",
    256,
  );
  if (
    ![
      "validate",
      "quote",
      "prepare",
      "submit",
      "confirm",
      "verify",
      "settle",
    ].includes(attempt.phase) ||
    ![
      "started",
      "accepted",
      "rejected",
      "unknown",
      "verified",
      "failed",
    ].includes(attempt.outcome)
  )
    throw new Error("Execution attempt phase or outcome is invalid");
}

function validateFailure(failure: ExecutionJobFailure): void {
  if (
    typeof failure.code !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(failure.code)
  )
    throw new Error("Failure code is invalid");
  if (
    typeof failure.description !== "string" ||
    !failure.description.trim() ||
    failure.description.length > 1000 ||
    containsControlCharacters(failure.description)
  )
    throw new Error("Failure description must be safe plain text");
}

async function lockJob(
  client: PostgresJobClient,
  key: ExecutionJobKey,
): Promise<PersistedExecutionJob | null> {
  validateJobKey(key);
  const found = await client.query(
    `SELECT job_id::text AS job_id FROM public.execution_jobs
     WHERE network_id = $1 AND contract_id = $2 AND payout_id = $3::numeric
     FOR UPDATE`,
    [key.networkId, key.contractId, key.payoutId],
  );
  return found.rows[0]
    ? readJob(client, requireString(found.rows[0], "job_id"))
    : null;
}

async function readJob(
  client: PostgresJobClient,
  jobId: string,
): Promise<PersistedExecutionJob> {
  const result = await client.query(
    `${jobSelect} WHERE j.job_id = $1::bigint`,
    [jobId],
  );
  if (!result.rows[0]) throw new Error("Persisted execution job disappeared");
  const row = result.rows[0];
  const payout = parsePayoutSnapshot(row.payout_snapshot);
  if (
    payout.payoutId !== requireString(row, "payout_id") ||
    payout.campaignId !== requireString(row, "campaign_id") ||
    payout.inputAmount.atomicAmount !==
      requireString(row, "input_atomic_amount") ||
    payout.expectedOutput.atomicAmount !==
      requireString(row, "expected_output_atomic_amount")
  )
    throw new Error(
      "Persisted execution-job snapshot does not match protected columns",
    );
  const attemptRows = await client.query(
    `SELECT attempt_key, sequence_number, phase, idempotency_key,
            started_at, outcome
     FROM public.execution_attempts
     WHERE job_id = $1::bigint
     ORDER BY sequence_number`,
    [jobId],
  );
  const attempts = attemptRows.rows.map(mapAttempt);
  const attemptCount = requireSafeInteger(row, "attempt_count");
  if (attempts.length !== attemptCount)
    throw new Error("Persisted execution-job attempt count is inconsistent");
  const lease =
    row.worker_id === null || row.worker_id === undefined
      ? null
      : mapLease(row, requireSafeInteger(row, "state_version"));
  const key: ExecutionJobKey = {
    networkId: requireString(row, "network_id"),
    contractId: requireString(row, "contract_id"),
    payoutId: requireString(row, "payout_id"),
  };
  const discoveryEvent: PayoutReservedEvent["identity"] = {
    networkId: key.networkId,
    contractId: key.contractId,
    transactionHash: requireString(row, "discovery_tx_hash"),
    blockHash: requireString(row, "discovery_block_hash"),
    receiptId: requireString(row, "discovery_receipt_id"),
    eventIndex: requireSafeInteger(row, "discovery_event_index"),
    blockHeight: requireString(row, "discovery_block_height"),
  };
  const event: PayoutReservedEvent = {
    event: "payout_reserved",
    payoutId: key.payoutId,
    campaignId: payout.campaignId,
    contractStatus: "Reserved",
    identity: discoveryEvent,
  };
  if (
    requireString(row, "snapshot_digest") !== hashPayoutSnapshot(payout) ||
    requireString(row, "payload_hash") !==
      hashJobCreationPayload(key, payout, event)
  )
    throw new Error("Persisted execution-job snapshot digest is inconsistent");
  const observedStatus = requireString(row, "observed_contract_status");
  if (observedStatus !== "Reserved")
    throw new Error(
      "Persisted job has an unsupported observed contract status",
    );
  return {
    jobId: requireString(row, "job_id"),
    idempotencyKey: requireString(row, "job_creation_idempotency_key"),
    snapshotDigest: requireString(row, "snapshot_digest"),
    fencingCounter: requireString(row, "fencing_counter"),
    attemptCount,
    nextEligibleAtMs: dateMs(row.next_eligible_at, "next_eligible_at"),
    failure:
      row.failure_code === null || row.failure_code === undefined
        ? null
        : {
            code: requireString(row, "failure_code"),
            description: requireString(row, "failure_description"),
          },
    key,
    payout,
    discoveryEvent,
    state: readJobState(row.state),
    version: requireSafeInteger(row, "state_version"),
    createdAtMs: dateMs(row.created_at, "created_at"),
    updatedAtMs: dateMs(row.updated_at, "updated_at"),
    lease,
    attempts,
  };
}

function parsePayoutSnapshot(value: unknown): PayoutSnapshot {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new Error("Persisted payout snapshot is malformed JSON");
    }
  }
  if (!isPayoutSnapshot(parsed))
    throw new Error("Persisted payout snapshot is not an object");
  validatePayoutSnapshot(parsed);
  return parsed;
}

function isPayoutSnapshot(value: unknown): value is PayoutSnapshot {
  if (!isRecord(value)) return false;
  const isAmount = (amount: unknown): boolean =>
    isRecord(amount) &&
    typeof amount.tokenId === "string" &&
    typeof amount.atomicAmount === "string" &&
    typeof amount.decimals === "number";
  return (
    typeof value.payoutId === "string" &&
    typeof value.campaignId === "string" &&
    isAmount(value.inputAmount) &&
    typeof value.destinationChainId === "string" &&
    typeof value.recipientAddress === "string" &&
    isAmount(value.expectedOutput) &&
    typeof value.contractStatus === "string" &&
    (value.executionReference === null ||
      typeof value.executionReference === "string") &&
    (value.settlementEvidenceReference === null ||
      typeof value.settlementEvidenceReference === "string")
  );
}

function mapAttempt(row: Readonly<Record<string, unknown>>): ExecutionAttempt {
  const phase = requireString(row, "phase");
  const outcome = requireString(row, "outcome");
  if (
    ![
      "validate",
      "quote",
      "prepare",
      "submit",
      "confirm",
      "verify",
      "settle",
    ].includes(phase) ||
    ![
      "started",
      "accepted",
      "rejected",
      "unknown",
      "verified",
      "failed",
    ].includes(outcome)
  )
    throw new Error(
      "Persisted execution attempt has an unsupported phase or outcome",
    );
  return {
    attemptKey: requireString(row, "attempt_key"),
    sequence: requireSafeInteger(row, "sequence_number"),
    phase: phase as ExecutionAttempt["phase"],
    idempotencyKey: requireString(row, "idempotency_key"),
    startedAtMs: dateMs(row.started_at, "attempt.started_at"),
    outcome: outcome as ExecutionAttempt["outcome"],
  };
}

function mapLease(
  row: Readonly<Record<string, unknown>>,
  stateVersion: number,
): Lease {
  return {
    workerId: requireString(row, "worker_id"),
    fencingToken: requireString(row, "lease_fencing_token"),
    stateVersion,
    expiresAtMs: dateMs(row.expires_at, "lease.expires_at"),
  };
}

async function hasValidLease(
  client: PostgresJobClient,
  job: PersistedExecutionJob,
  lease: Lease,
): Promise<boolean> {
  const result = await client.query(
    `SELECT worker_id, fencing_token::text AS fencing_token
     FROM public.job_leases
     WHERE job_id = $1::bigint AND worker_id = $2
       AND fencing_token = $3::numeric
       AND expires_at > statement_timestamp()
     FOR UPDATE`,
    [job.jobId, lease.workerId, lease.fencingToken],
  );
  return (
    result.rows.length === 1 &&
    job.version === lease.stateVersion &&
    requireString(result.rows[0]!, "fencing_token") === lease.fencingToken &&
    job.lease?.workerId === lease.workerId &&
    job.lease.fencingToken === lease.fencingToken &&
    job.fencingCounter === lease.fencingToken
  );
}

async function updateJobState(
  client: PostgresJobClient,
  jobId: string,
  from: JobState,
  version: number,
  next: JobState,
): Promise<void> {
  const updated = await client.query(
    `UPDATE public.execution_jobs
     SET state = $4, state_version = state_version + 1,
         updated_at = statement_timestamp()
     WHERE job_id = $1::bigint AND state = $2 AND state_version = $3`,
    [jobId, from, version, next],
  );
  if (updated.rowCount !== 1) throw new StaleExecutionJobError();
}

async function bumpVersion(
  client: PostgresJobClient,
  jobId: string,
  version: number,
): Promise<void> {
  const updated = await client.query(
    `UPDATE public.execution_jobs
     SET state_version = state_version + 1,
         updated_at = statement_timestamp()
     WHERE job_id = $1::bigint AND state_version = $2`,
    [jobId, version],
  );
  if (updated.rowCount !== 1) throw new StaleExecutionJobError();
}

async function advanceLeaseVersion(
  client: PostgresJobClient,
  jobId: string,
  lease: Lease,
): Promise<void> {
  const advanced = await client.query(
    `SELECT 1 FROM public.job_leases
     WHERE job_id = $1::bigint AND worker_id = $2
       AND fencing_token = $3::numeric
       AND expires_at > statement_timestamp()`,
    [jobId, lease.workerId, lease.fencingToken],
  );
  if (advanced.rowCount !== 1)
    throw new StaleExecutionJobError("Worker lease expired during update");
}

async function deleteCurrentLease(
  client: PostgresJobClient,
  jobId: string,
  lease: Lease,
): Promise<void> {
  const deleted = await client.query(
    `DELETE FROM public.job_leases
     WHERE job_id = $1::bigint AND worker_id = $2
       AND fencing_token = $3::numeric
       AND expires_at > statement_timestamp()`,
    [jobId, lease.workerId, lease.fencingToken],
  );
  if (deleted.rowCount !== 1)
    throw new StaleExecutionJobError("Worker lease expired during transition");
}

function requiresWorkerLease(state: JobState): boolean {
  return [
    "Leased",
    "Preparing",
    "SubmissionStarted",
    "SubmissionUnknown",
    "Submitted",
    "ConfirmationPending",
    "VerificationPending",
    "SettlementReady",
    "SettlementSubmitted",
    "RetryableFailure",
    "ManualReview",
  ].includes(state);
}

function readJobState(value: unknown): JobState {
  const states: readonly JobState[] = [
    "Discovered",
    "Queued",
    "Leased",
    "Preparing",
    "SubmissionStarted",
    "SubmissionUnknown",
    "Submitted",
    "ConfirmationPending",
    "VerificationPending",
    "SettlementReady",
    "SettlementSubmitted",
    "Completed",
    "RetryableFailure",
    "ManualReview",
    "Abandoned",
  ];
  if (typeof value !== "string" || !states.includes(value as JobState))
    throw new Error("Persisted execution job has an unknown state");
  return value as JobState;
}

function requireString(
  row: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = row[field];
  if (typeof value !== "string")
    throw new Error(`Persisted ${field} is not text`);
  return value;
}

function requireSafeInteger(
  row: Readonly<Record<string, unknown>>,
  field: string,
): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error(`Persisted ${field} is not a safe integer`);
  return value;
}

function dateMs(value: unknown, field: string): number {
  const date = value instanceof Date ? value : new Date(String(value));
  const time = date.getTime();
  if (!Number.isSafeInteger(time))
    throw new Error(`Persisted ${field} is invalid`);
  return time;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
