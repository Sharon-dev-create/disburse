/** Explicit loopback-only read test, outside normal host and test:postgres glob. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createPostgresPool } from "../../src/persistence/postgres-pool.ts";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import { NativeReconciliationRepository } from "../../src/reconciliation/postgres.ts";
import {
  ReadOnlyEvidenceRpc,
  viewAt,
  type EvidenceRpc,
} from "../../src/reconciliation/rpc.ts";
import { observeAttempt } from "../../src/reconciliation/worker.ts";
import { discoverNativeAttempts } from "../../src/reconciliation/discovery.ts";
import {
  object,
  canonical,
  digest,
} from "../../src/reconciliation/evidence.ts";
import { nativeFixture } from "../support/native-reconciliation.ts";
const pool = createPostgresPool(loadPostgresRuntimeConfig("test")),
  repo = new NativeReconciliationRepository(pool);
// Deliberately two aliases of ONE synthetic validator, not independent production providers.
const sources = [
  new ReadOnlyEvidenceRpc("local-a", "http://127.0.0.1:18545"),
  new ReadOnlyEvidenceRpc("local-b", "http://localhost:18545"),
];
const records: unknown[] = [];
const out = new URL("../../../docs/evidence/milestone-5/m5d/", import.meta.url);
before(async () => {
  for (const r of sources)
    assert.equal(
      object(await r.read("status", [])).chain_id,
      "disburse-m5c-local",
    );
});
after(async () => {
  await pool.end();
  await mkdir(out, { recursive: true });
  await writeFile(
    new URL("live-reconciliation-tests.json", out),
    JSON.stringify(
      {
        scope:
          "Read-only RPC against real synthetic receipts; two aliases of same node, not independent operators",
        records,
      },
      null,
      2,
    ) + "\n",
  );
});
async function accounting(i: { contractId: string; campaignId: string }) {
  const head = object(
    object(await sources[0]!.read("block", { finality: "final" })).header,
  );
  return viewAt(
    sources[0]!,
    i.contractId,
    "get_campaign_payout_accounting",
    { campaign_id: i.campaignId },
    String(head.hash),
  );
}
for (const [name, expected] of [
  ["successful-transfer", "ObservedSucceededSettled"],
  ["panic-callback", "ObservedSucceededSettlementPending"],
  ["oog-callback", "ObservedSucceededSettlementPending"],
  ["definitive-token-failure", "ObservedTransferFailed"],
  ["insufficient-token-balance", "ObservedTransferFailed"],
  ["delivered-but-unexpected-result", "ManualReview"],
] as const) {
  void test(`live finalized RPC + PostgreSQL: ${name}`, async () => {
    const f = nativeFixture(name);
    const before = await accounting(f.identity);
    const key = await repo.enqueue(f.identity, f.locator);
    await repo.recheck(key);
    const claim = await repo.claim("live-reader", 30000, key);
    assert.ok(claim);
    const decision = await observeAttempt(f.identity, claim, sources, f.policy);
    assert.equal(decision.classification, expected, decision.reason);
    const completions = await Promise.allSettled([
      repo.complete(claim, decision),
      repo.complete(claim, decision),
    ]);
    assert.equal(completions.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(canonical(await accounting(f.identity)), canonical(before));
    const h = object(await repo.history(key));
    assert.ok((h.observations as unknown[]).length >= 2);
    records.push({
      name,
      result: "PASS",
      classification: decision.classification,
      transferReceiptId: decision.transferReceiptId,
      callbackReceiptId: decision.callbackReceiptId,
      unchangedAccounting: before,
      jobKey: key,
      evidenceDigest: digest(decision),
      newBlockchainTransactions: 0,
    });
  });
}
void test("bounded finalized discovery exposes unresolved attempts without inventing transaction hashes", async () => {
  const page = await discoverNativeAttempts(
    sources[0]!,
    "disburse-m5c-local",
    "disburse-test-contract.testnet",
    "0",
    100,
  );
  assert.ok(page.attempts.some((a) => a.status === "TransferPending"));
  assert.ok(page.attempts.every((a) => a.locatorRequired));
  assert.equal(page.nextPayoutId, "100");
  assert.equal(page.scanned, 100);
  records.push({ name: "finalized-discovery", result: "PASS", ...page });
});
void test("real receipt unavailable is ManualReview, no accounting mutation", async () => {
  const f = nativeFixture("panic-callback");
  const before = await accounting(f.identity);
  const missing: EvidenceRpc[] = sources.map((s) => ({
    sourceId: s.sourceId,
    endpoint: s.endpoint,
    read: async (m, p) => {
      if (m === "EXPERIMENTAL_receipt")
        throw new Error("Injected missing receipt over otherwise real RPC");
      return s.read(m, p);
    },
  }));
  const d = await observeAttempt(
    f.identity,
    { locator: f.locator },
    missing,
    f.policy,
  );
  assert.equal(d.classification, "ManualReview");
  assert.equal(d.transferReceiptId, null);
  assert.equal(canonical(await accounting(f.identity)), canonical(before));
  records.push({
    name: "missing-receipt",
    result: "PASS",
    injection:
      "Missing receipt response over live local RPC; no real receipt deleted",
    classification: d.classification,
  });
});
