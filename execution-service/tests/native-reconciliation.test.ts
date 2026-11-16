import assert from "node:assert/strict";
import test from "node:test";
import {
  bindingDigest,
  canonical,
  digest,
  exactJson,
  object,
} from "../src/reconciliation/evidence.ts";
import {
  verifyBundle,
  type EvidenceBundle,
} from "../src/reconciliation/verifier.ts";
import { observeAttempt } from "../src/reconciliation/worker.ts";
import {
  ReadOnlyEvidenceRpc,
  type EvidenceRpc,
} from "../src/reconciliation/rpc.ts";
import { nativeFixture } from "./support/native-reconciliation.ts";

for (const [name, expected] of [
  ["successful-transfer", "ObservedSucceededSettled"],
  ["panic-callback", "ObservedSucceededSettlementPending"],
  ["oog-callback", "ObservedSucceededSettlementPending"],
  ["definitive-token-failure", "ObservedTransferFailed"],
  ["insufficient-token-balance", "ObservedTransferFailed"],
  ["delivered-but-unexpected-result", "ManualReview"],
] as const) {
  void test(`receipt fixture ${name}: ${expected}`, () => {
    const f = nativeFixture(name);
    assert.equal(
      verifyBundle(f.identity, f.bundle, f.policy).classification,
      expected,
    );
  });
}
void test("exact integer parsing preserves u64/u128 and does not rewrite string contents", () => {
  const x = object(
    exactJson(
      '{"id":18446744073709551615,"amount":340282366920938463463374607431768211455,"s":"18446744073709551615","v":1}',
    ),
  );
  assert.equal(x.id, "18446744073709551615");
  assert.equal(x.amount, "340282366920938463463374607431768211455");
  assert.equal(x.v, 1);
  assert.equal(x.s, "18446744073709551615");
  assert.throws(
    () => canonical({ n: Number.MAX_SAFE_INTEGER + 1 }),
    /Expected/,
  );
  const f = nativeFixture();
  assert.equal(
    bindingDigest(object(object(f.bundle.native).binding)),
    f.identity.bindingHash,
  );
});
for (const field of [
  "tokenId",
  "recipientId",
  "amount",
  "attemptId",
  "campaignId",
  "payoutId",
  "bindingHash",
  "executorId",
  "chainId",
] as const) {
  void test(`forged ${field} cannot verify`, () => {
    const f = nativeFixture();
    const forged = {
      ...f.identity,
      [field]: field.endsWith("Id")
        ? "other.testnet"
        : field === "bindingHash"
          ? "f".repeat(64)
          : "99999",
    };
    assert.equal(
      verifyBundle(forged, f.bundle, f.policy).classification,
      "ManualReview",
    );
  });
}
void test("missing, duplicated, disconnected and stale-finality receipt evidence stays unknown", () => {
  const f = nativeFixture();
  for (const mutate of [
    (b: EvidenceBundle) =>
      (object(b.transaction).final_execution_status = "EXECUTED_OPTIMISTIC"),
    (b: EvidenceBundle) => (b.receipts as unknown[]).pop(),
    (b: EvidenceBundle) => (b.receipts as unknown[]).push(b.receipts[0]),
    (b: EvidenceBundle) =>
      (object(b.blocks[0]!.canonicalHeader).hash = "other-fork"),
    (b: EvidenceBundle) => (object(b.head).height = 0),
    (b: EvidenceBundle) => (object(b.payout).status = "Reserved"),
    (b: EvidenceBundle) => (object(b.native).current_attempt_id = 2),
    (b: EvidenceBundle) =>
      (object(b.accounting).reserved =
        "340282366920938463463374607431768211455"),
    (b: EvidenceBundle) => (object(b.locator).transactionHash = "forged-hash"),
  ]) {
    const bundle = structuredClone(f.bundle);
    mutate(bundle);
    assert.equal(
      verifyBundle(f.identity, bundle, f.policy).classification,
      "ManualReview",
    );
  }
  assert.equal(
    verifyBundle(f.identity, f.bundle, {
      ...f.policy,
      atomicTokenCodeHashes: [],
    }).classification,
    "ManualReview",
  );
});
void test("RPC facade rejects all broadcasts and unpinned/arbitrary views before fetching", async () => {
  const r = new ReadOnlyEvidenceRpc("a", "http://127.0.0.1:1", () => {
    throw new Error("MUST NOT FETCH");
  });
  for (const method of [
    "send_tx",
    "broadcast_tx_commit",
    "broadcast_tx_async",
    "EXPERIMENTAL_tx_status",
  ])
    await assert.rejects(r.read(method, {}), /forbidden/);
  await assert.rejects(
    r.read("query", {
      request_type: "call_function",
      method_name: "ft_transfer",
      block_id: "hash",
    }),
    /supported/,
  );
  await assert.rejects(
    r.read("query", {
      request_type: "call_function",
      method_name: "get_native_payout",
    }),
    /supported/,
  );
});
void test("two unavailable sources produce ManualReview, never transfer failure", async () => {
  const f = nativeFixture();
  const sources: EvidenceRpc[] = ["a", "b"].map((id) => ({
    sourceId: id,
    endpoint: `http://${id}.invalid`,
    read: async () => {
      throw new Error("RPC timeout");
    },
  }));
  const d = await observeAttempt(
    f.identity,
    { locator: f.locator },
    sources,
    f.policy,
  );
  assert.equal(d.classification, "ManualReview");
  assert.equal(d.transferReceiptId, null);
  assert.equal(d.observations.length, 2);
  await assert.rejects(
    observeAttempt(
      f.identity,
      { locator: f.locator },
      [sources[0]!, sources[0]!],
      f.policy,
    ),
    /distinct/,
  );
});
void test("canonical evidence digests are stable across JSON object key order", () => {
  assert.equal(
    digest({ a: 1, b: { d: 4, c: 3 } }),
    digest({ b: { c: 3, d: 4 }, a: 1 }),
  );
});
void test("transfer substitution, dependency spoofing and forged outcome/code are rejected", () => {
  const f = nativeFixture();
  for (const mutate of [
    (r: Record<string, unknown>, a: Record<string, unknown>) => {
      a.deposit = "0";
    },
    (r: Record<string, unknown>, a: Record<string, unknown>) => {
      a.args = Buffer.from(
        JSON.stringify({
          receiver_id: "attacker.testnet",
          amount: f.identity.amount,
          memo: `disburse:native:v1:${f.identity.payoutId}:${f.identity.attemptId}`,
        }),
      ).toString("base64");
    },
    (r: Record<string, unknown>) => {
      r.predecessor_id = "attacker.testnet";
    },
    (r: Record<string, unknown>, a: Record<string, unknown>) => {
      a.method_name = "ft_transfer_call";
    },
  ]) {
    const b = structuredClone(f.bundle);
    const receipt = object(
      b.receipts.find(
        (v) =>
          object(v).receiver_id === f.identity.tokenId &&
          (object(object(object(v).receipt).Action).actions as unknown[]).some(
            (x) =>
              object(object(x).FunctionCall ?? {}).method_name ===
              "ft_transfer",
          ),
      ),
    );
    const a = object(
      object((object(object(receipt.receipt).Action).actions as unknown[])[0])
        .FunctionCall,
    );
    mutate(receipt, a);
    assert.equal(
      verifyBundle(f.identity, b, f.policy).classification,
      "ManualReview",
    );
  }
  const b = structuredClone(f.bundle);
  const cb = object(
    b.receipts.find((v) => {
      try {
        return (
          object(object(object(v).receipt).Action).actions as unknown[]
        ).some(
          (a) =>
            object(object(a).FunctionCall ?? {}).method_name ===
            "on_native_transfer_result",
        );
      } catch {
        return false;
      }
    }),
  );
  object(object(cb.receipt).Action).input_data_ids = ["forged-promise-data"];
  assert.equal(
    verifyBundle(f.identity, b, f.policy).classification,
    "ManualReview",
  );
});
function replaySource(bundle: EvidenceBundle, sourceId: string): EvidenceRpc {
  return {
    sourceId,
    endpoint: `http://${sourceId}.invalid`,
    read: async (method, params) => {
      const p = Array.isArray(params)
        ? {}
        : (params as Record<string, unknown>);
      if (method === "status") return { chain_id: bundle.chainId };
      if (method === "tx_status") return bundle.transaction;
      if (method === "EXPERIMENTAL_receipt") {
        const receipt = bundle.receipts.find(
          (r) => object(r).receipt_id === p.receipt_id,
        );
        if (!receipt) throw new Error("Missing receipt");
        return receipt;
      }
      if (method === "block") {
        if (p.finality === "final") return { header: bundle.head };
        const pair = bundle.blocks.find(
          (b) =>
            object(b.header).hash === p.block_id ||
            String(object(b.header).height) === String(p.block_id),
        );
        if (!pair) throw new Error("Missing block");
        return {
          header:
            typeof p.block_id === "number" ? pair.canonicalHeader : pair.header,
        };
      }
      if (method === "query") {
        const data: Record<string, unknown> = {
          get_native_payout: bundle.native,
          get_native_attempt: bundle.attempt,
          get_native_authorization: bundle.authorization,
          get_payout: bundle.payout,
          get_campaign_payout_accounting: bundle.accounting,
          get_native_execution_outcome: bundle.execution,
        };
        return {
          block_hash: object(bundle.head).hash,
          result: [...Buffer.from(canonical(data[String(p.method_name)]))],
        };
      }
      throw new Error("Unexpected mock read");
    },
  };
}
void test("individually valid but conflicting RPC receipt graphs block reconciliation", async () => {
  const f = nativeFixture();
  const first = verifyBundle(f.identity, f.bundle, f.policy);
  assert.ok(first.transferReceiptId);
  const forged = JSON.parse(
    JSON.stringify(f.bundle)
      .split(first.transferReceiptId)
      .join("2".repeat(44)),
  ) as EvidenceBundle;
  assert.notEqual(
    verifyBundle(f.identity, forged, f.policy).classification,
    "ManualReview",
  );
  const d = await observeAttempt(
    f.identity,
    { locator: f.locator },
    [replaySource(f.bundle, "a"), replaySource(forged, "b")],
    f.policy,
  );
  assert.equal(d.classification, "ManualReview");
  assert.equal(d.conflicting, true);
});
void test("replayed real receipt data agrees across two mocked RPCs without asserting trustless proof", async () => {
  const f = nativeFixture();
  const d = await observeAttempt(
    f.identity,
    { locator: f.locator },
    [replaySource(f.bundle, "a"), replaySource(f.bundle, "b")],
    f.policy,
  );
  assert.equal(d.classification, "ObservedSucceededSettled");
  assert.equal(d.trust, "TRUSTED_RPC_OBSERVATION_NOT_ON_CHAIN_PROOF");
});
void test("discovery uses actual ABI and bounded exact-u64 ranges without a count endpoint", async () => {
  const { discoverNativeAttempts } =
    await import("../src/reconciliation/discovery.ts");
  const ids: string[] = [];
  const rpc: EvidenceRpc = {
    sourceId: "range-test",
    endpoint: "http://fixture.invalid",
    read: async (method, params) => {
      if (method === "status") return { chain_id: "disburse-m5c-local" };
      if (method === "block") return { header: { hash: "pinned" } };
      const p = object(params);
      assert.equal(p.method_name, "get_native_payout");
      assert.equal(p.block_id, "pinned");
      ids.push(
        String(
          object(
            exactJson(Buffer.from(String(p.args_base64), "base64").toString()),
          ).payout_id,
        ),
      );
      return { block_hash: "pinned", result: [...Buffer.from("null")] };
    },
  };
  const page = await discoverNativeAttempts(
    rpc,
    "disburse-m5c-local",
    "disburse-test-contract.testnet",
    "18446744073709551614",
    2,
  );
  assert.equal(page.nextPayoutId, null);
  assert.equal(page.scanned, 2);
  assert.deepEqual(ids, ["18446744073709551614", "18446744073709551615"]);
  await assert.rejects(
    discoverNativeAttempts(
      rpc,
      "wrong-network",
      "disburse-test-contract.testnet",
    ),
    /network/,
  );
  await assert.rejects(
    discoverNativeAttempts(
      rpc,
      "disburse-m5c-local",
      "disburse-test-contract.testnet",
      "0",
      101,
    ),
    /bound/,
  );
});
