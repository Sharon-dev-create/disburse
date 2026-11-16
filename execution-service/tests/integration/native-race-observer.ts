/** Local fixture observer: start before a real callback, wait for finality, persist reads only. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { ReadOnlyEvidenceRpc, viewAt } from "../../src/reconciliation/rpc.ts";
import { observeAttempt } from "../../src/reconciliation/worker.ts";
import { NativeReconciliationRepository } from "../../src/reconciliation/postgres.ts";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import { createPostgresPool } from "../../src/persistence/postgres-pool.ts";
import {
  object,
  type AttemptIdentity,
  type TransactionLocator,
} from "../../src/reconciliation/evidence.ts";
import { nativeFixture } from "../support/native-reconciliation.ts";
const path = process.argv[2];
if (!path?.startsWith("/tmp/")) throw new Error("Local fixture input required");
const input = JSON.parse(await readFile(path, "utf8")) as {
  identity: AttemptIdentity;
  locator: TransactionLocator;
  optimisticBefore: unknown;
};
assert.equal(input.identity.chainId, "disburse-m5c-local");
const sources = [
  new ReadOnlyEvidenceRpc("race-a", "http://127.0.0.1:18545"),
  new ReadOnlyEvidenceRpc("race-b", "http://localhost:18545"),
];
const head = object(
  object(await sources[0]!.read("block", { finality: "final" })).header,
);
const before = object(
  await viewAt(
    sources[0]!,
    input.identity.contractId,
    "get_native_payout",
    { payout_id: input.identity.payoutId },
    String(head.hash),
  ),
);
assert.notEqual(
  before.status,
  "Succeeded",
  "Observer must begin before final callback settlement",
);
const pool = createPostgresPool(loadPostgresRuntimeConfig("test"));
const repo = new NativeReconciliationRepository(pool);
try {
  const key = await repo.enqueue(input.identity, input.locator);
  const c = await repo.claim("race-observer", 30000, key);
  assert.ok(c);
  const decision = await observeAttempt(
    input.identity,
    c,
    sources,
    nativeFixture().policy,
  );
  assert.equal(
    decision.classification,
    "ObservedSucceededSettled",
    decision.reason,
  );
  await repo.complete(c, decision);
  await assert.rejects(repo.complete(c, decision), /Stale/);
  const afterHead = object(
    object(await sources[0]!.read("block", { finality: "final" })).header,
  );
  const accounting = object(
    await viewAt(
      sources[0]!,
      input.identity.contractId,
      "get_campaign_payout_accounting",
      { campaign_id: input.identity.campaignId },
      String(afterHead.hash),
    ),
  );
  assert.equal(accounting.reserved, "0");
  assert.equal(accounting.spent, "100000");
  assert.equal(accounting.available, "900000");
  await writeFile(
    new URL(
      "../../../docs/evidence/milestone-5/m5d/callback-observer-race.json",
      import.meta.url,
    ),
    JSON.stringify(
      {
        result: "PASS",
        actual_receipts_executed: true,
        observerBeforeFinality: before.status,
        optimisticBefore: input.optimisticBefore,
        classification: decision.classification,
        identity: input.identity,
        locator: input.locator,
        transferReceiptId: decision.transferReceiptId,
        callbackReceiptId: decision.callbackReceiptId,
        accounting,
        limitation:
          "Only C callback mutates chain accounting. Observer begins before settlement and waits FINAL; no recovery mutation exists to race.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS callback/observer overlap; callback settled once; observer persisted only",
  );
} finally {
  await pool.end();
}
