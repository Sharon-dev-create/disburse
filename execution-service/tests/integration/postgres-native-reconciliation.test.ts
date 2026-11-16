import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createPostgresPool } from "../../src/persistence/postgres-pool.ts";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import { applyPostgresMigrations } from "../../src/persistence/postgres-migrations.ts";
import {
  NativeReconciliationRepository,
  type Decision,
  type Claim,
} from "../../src/reconciliation/postgres.ts";
import { trust, digest, object } from "../../src/reconciliation/evidence.ts";
import { nativeFixture } from "../support/native-reconciliation.ts";
const pool = createPostgresPool(loadPostgresRuntimeConfig("test"));
const repo = new NativeReconciliationRepository(pool);
before(async () => {
  await applyPostgresMigrations(pool);
});
after(async () => pool.end());
function fixture() {
  const f = nativeFixture();
  return {
    ...f,
    identity: { ...f.identity, chainId: `repository-fixture-${randomUUID()}` },
  };
}
function unknown(): Decision {
  return {
    classification: "ManualReview",
    reason: "Explicit repository-only fixture, not verified delivery",
    transferReceiptId: null,
    callbackReceiptId: null,
    semanticDigest: null,
    trust,
    conflicting: false,
    observations: [
      {
        sourceId: "fixture",
        endpoint: "http://127.0.0.1:1",
        bundle: null,
        verificationPolicy: nativeFixture().policy,
        verification: {
          classification: "ManualReview",
          reason: "No evidence",
          transferReceiptId: null,
          callbackReceiptId: null,
          semanticDigest: null,
          trust,
        },
      },
    ],
  };
}
async function claimed() {
  const f = fixture(),
    key = await repo.enqueue(f.identity, f.locator);
  const c = await repo.claim("test-worker", 5000, key);
  assert.ok(c);
  return { f, key, c };
}
void test("M5-D migrations are checksum-protected and idempotent", async () => {
  assert.deepEqual((await applyPostgresMigrations(pool)).applied, []);
  assert.equal((await applyPostgresMigrations(pool)).currentVersion, "0004");
});
void test("concurrent enqueue/claims have one immutable attempt and one lease", async () => {
  const f = fixture();
  const keys = await Promise.all(
    Array.from({ length: 8 }, () => repo.enqueue(f.identity, f.locator)),
  );
  assert.equal(new Set(keys).size, 1);
  const claims = await Promise.all([
    repo.claim("a", 5000, keys[0]),
    repo.claim("b", 5000, keys[0]),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  await assert.rejects(
    repo.enqueue({ ...f.identity, amount: "999" }, f.locator),
    /Conflicting/,
  );
  await assert.rejects(
    repo.enqueue(f.identity, { ...f.locator, transactionHash: "different" }),
    /Conflicting/,
  );
});
void test("duplicate observations are idempotent; historical evidence cannot update/delete", async () => {
  const { key, c } = await claimed(),
    d = unknown();
  await repo.complete(c, d);
  await repo.recheck(key);
  const second = await repo.claim("again", 5000, key);
  assert.ok(second);
  await repo.complete(second, d);
  const h = object(await repo.history(key));
  assert.equal((h.observations as unknown[]).length, 1);
  assert.equal((h.decisions as unknown[]).length, 2);
  for (const table of [
    "native_receipt_observations",
    "native_reconciliation_decisions",
  ]) {
    await assert.rejects(
      pool.query(`DELETE FROM public.${table} WHERE job_key=$1`, [key]),
      /immutable/,
    );
  }
  await assert.rejects(
    pool.query(
      "UPDATE public.native_receipt_observations SET payload='{}' WHERE job_key=$1",
      [key],
    ),
    /immutable/,
  );
});
void test("expired fences cannot persist; transaction rollback leaves no partial observation", async () => {
  const f = fixture(),
    key = await repo.enqueue(f.identity, f.locator);
  const old = await repo.claim("old", 50, key);
  assert.ok(old);
  await delay(100);
  const fresh = await repo.claim("new", 5000, key);
  assert.ok(fresh);
  assert.ok(BigInt(fresh.fence) > BigInt(old.fence));
  await assert.rejects(repo.complete(old, unknown()), /Stale/);
  assert.equal(
    (object(await repo.history(key)).observations as unknown[]).length,
    0,
  );
  const bad = {
    ...unknown(),
    observations: [{ ...unknown().observations[0]!, sourceId: "" }],
  };
  await assert.rejects(repo.complete(fresh, bad), /Invalid evidence/);
  assert.equal(
    (object(await repo.history(key)).observations as unknown[]).length,
    0,
  );
  await repo.complete(fresh, unknown());
  await assert.rejects(repo.complete(fresh, unknown()), /Stale/);
});
void test("reused receipt or transaction and conflicting finalized evidence become sticky ManualReview", async () => {
  const { key, c, f } = await claimed();
  const first: Decision = {
    ...unknown(),
    classification: "ObservedTransferFailed",
    transferReceiptId: "repository-only-receipt",
    semanticDigest: digest("fixture-evidence-a"),
  };
  await repo.complete(c, first);
  await repo.recheck(key);
  const c2 = await repo.claim("again", 5000, key);
  assert.ok(c2);
  assert.equal(
    (
      await repo.complete(c2, {
        ...first,
        semanticDigest: digest("fixture-evidence-b"),
      })
    ).classification,
    "ManualReview",
  );
  await repo.recheck(key);
  const c3 = await repo.claim("third", 5000, key);
  assert.ok(c3);
  assert.equal((await repo.complete(c3, first)).classification, "ManualReview");
  const other = {
    ...f.identity,
    payoutId: String(BigInt(f.identity.payoutId) + 10000n),
  };
  const otherKey = await repo.enqueue(other, f.locator);
  const oc = await repo.claim("other", 5000, otherKey);
  assert.ok(oc);
  assert.equal((await repo.complete(oc, first)).classification, "ManualReview");
});
void test("real SIGKILL and fresh worker process recover same PostgreSQL job and evidence", async () => {
  const { key, c } = await claimed();
  await repo.complete(c, unknown());
  await repo.recheck(key);
  const childPath = fileURLToPath(
    new URL("./native-restart-child.ts", import.meta.url),
  );
  const spawn = (mode: string) =>
    fork(childPath, [mode, key], {
      execArgv: ["--experimental-strip-types"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
  const child = spawn("crash");
  const message = await Promise.race([
    once(child, "message"),
    delay(5000).then(() => {
      throw new Error("Crash child did not claim");
    }),
  ]);
  const old = object(message[0]).claim as Claim;
  const stopped = once(child, "exit");
  child.kill("SIGKILL");
  await stopped;
  await delay(200);
  const restarted = spawn("resume");
  const completed = await Promise.race([
    once(restarted, "message"),
    delay(5000).then(() => {
      throw new Error("Restart did not complete");
    }),
  ]);
  const exited = once(restarted, "exit");
  await exited;
  const msg = object(completed[0]);
  assert.equal(object(msg.result).classification, "ManualReview");
  const h = object(await repo.history(key));
  assert.equal((h.observations as unknown[]).length, 1);
  assert.equal((h.decisions as unknown[]).length, 2);
  await assert.rejects(repo.complete(old, unknown()), /Stale/);
});
