import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createPostgresPool } from "../../src/persistence/postgres-pool.ts";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import { applyPostgresMigrations } from "../../src/persistence/postgres-migrations.ts";
import {
  NativeReconciliationRepository,
  type Decision,
} from "../../src/reconciliation/postgres.ts";
import { trust, object } from "../../src/reconciliation/evidence.ts";
import { nativeFixture } from "../support/native-reconciliation.ts";
const pool = createPostgresPool(loadPostgresRuntimeConfig("test"));
const repo = new NativeReconciliationRepository(pool);
before(async () => {
  await applyPostgresMigrations(pool);
});
after(async () => pool.end());
const decision: Decision = {
  classification: "ManualReview",
  reason: "Lease regression fixture",
  transferReceiptId: null,
  callbackReceiptId: null,
  semanticDigest: null,
  trust,
  conflicting: false,
  observations: [],
};
for (const [name, ttl, hold, accept] of [
  ["expired after row lock", 500, 900, false],
  ["valid after short row lock", 5000, 50, true],
] as const) {
  void test(name, async () => {
    const f = nativeFixture();
    const key = await repo.enqueue(
      { ...f.identity, chainId: randomUUID() },
      f.locator,
    );
    const claim = await repo.claim("A", ttl, key);
    assert.ok(claim);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    try {
      await blocker.query(
        "SELECT job_key FROM native_reconciliation_jobs WHERE job_key=$1 FOR UPDATE",
        [key],
      );
      const pid = (
        await blocker.query(
          "SELECT pg_backend_pid() AS pid,clock_timestamp() AS started",
        )
      ).rows[0];
      const completion = repo.complete(claim, decision).then(
        () => true,
        () => false,
      );
      // Synchronize on PostgreSQL's actual blocking relationship, not a guessed launch delay.
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline) {
        const r = await pool.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
          [pid.pid],
        );
        if (r.rows[0].blocked) {
          blocked = true;
          break;
        }
        await pool.query("SELECT pg_sleep(0.01)");
      }
      assert.ok(blocked, "completion must actually wait on the held row");
      await pool.query("SELECT pg_sleep($1)", [hold / 1000]);
      await blocker.query("COMMIT");
      assert.equal(await completion, accept);
      const history = object(await repo.history(key));
      assert.equal((history.decisions as unknown[]).length, accept ? 1 : 0);
      assert.equal((history.observations as unknown[]).length, 0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
}
void test("wrong owner and fence reject without changing current owner's ability to complete", async () => {
  const f = nativeFixture();
  const key = await repo.enqueue(
    { ...f.identity, chainId: randomUUID() },
    f.locator,
  );
  const c = await repo.claim("B", 5000, key);
  assert.ok(c);
  await assert.rejects(
    repo.complete({ ...c, workerId: "A" }, decision),
    /Stale/,
  );
  await assert.rejects(
    repo.complete({ ...c, fence: String(BigInt(c.fence) - 1n) }, decision),
    /Stale/,
  );
  await repo.complete(c, decision);
  await assert.rejects(repo.complete(c, decision), /Stale/);
});
void test("database fixture renewal preserves owner and generation; no renewal API is invented", async () => {
  const f = nativeFixture();
  const key = await repo.enqueue(
    { ...f.identity, chainId: randomUUID() },
    f.locator,
  );
  const c = await repo.claim("renewal-fixture", 500, key);
  assert.ok(c);
  // Native repository exposes no renew method. Model an authorized extension under its row lock.
  await pool.query(
    "UPDATE native_reconciliation_jobs SET lease_until=clock_timestamp()+interval '5 seconds' WHERE job_key=$1 AND worker_id=$2 AND fence=$3::bigint AND lease_until>clock_timestamp()",
    [key, c.workerId, c.fence],
  );
  await pool.query("SELECT pg_sleep(0.6)");
  await repo.complete(c, decision);
});
void test("expiry during evidence-claim lock wait rolls back observations and decision", async () => {
  const f = nativeFixture();
  const identity = { ...f.identity, chainId: randomUUID() };
  const key = await repo.enqueue(identity, f.locator);
  const c = await repo.claim("write-boundary", 500, key);
  assert.ok(c);
  const receipt = randomUUID();
  const b = await pool.connect();
  await b.query("BEGIN");
  try {
    await b.query(
      "INSERT INTO native_reconciliation_receipt_claims(chain_id,contract_id,receipt_id,job_key) VALUES($1,$2,$3,$4)",
      [identity.chainId, identity.contractId, receipt, key],
    );
    const pid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const d: Decision = {
      ...decision,
      classification: "ObservedTransferFailed",
      transferReceiptId: receipt,
      semanticDigest: "a".repeat(64),
      observations: [
        {
          sourceId: "fixture",
          endpoint: "http://127.0.0.1:1",
          bundle: null,
          verificationPolicy: f.policy,
          verification: decision,
        },
      ],
    };
    const completion = repo.complete(c, d).then(
      () => true,
      () => false,
    );
    let blocked = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const r = await pool.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
        [pid],
      );
      if (r.rows[0].blocked) {
        blocked = true;
        break;
      }
      await pool.query("SELECT pg_sleep(0.01)");
    }
    assert.ok(blocked);
    await pool.query("SELECT pg_sleep(0.9)");
    await b.query("COMMIT");
    assert.equal(await completion, false);
    const h = object(await repo.history(key));
    assert.equal((h.observations as unknown[]).length, 0);
    assert.equal((h.decisions as unknown[]).length, 0);
  } finally {
    await b.query("ROLLBACK");
    b.release();
  }
});
