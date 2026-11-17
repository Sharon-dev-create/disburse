import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TestnetInspector,
  nativeRecipientPreflight,
  ownershipPrerequisite,
  TIDEPOOL,
  type InspectionRpc,
  type RecipientPreflightRequest,
} from "../src/near/recipient-preflight.ts";
import { NearRpcError } from "../src/near/errors.ts";
const hash = "7".repeat(44),
  block = "8".repeat(44);
const request: RecipientPreflightRequest = {
  network: "near:testnet",
  tokenId: TIDEPOOL,
  approvedTokenId: TIDEPOOL,
  assetId: `nep141:${TIDEPOOL}`,
  expectedTokenCodeHash: hash,
  recipientId: "recipient.testnet",
  approvedRecipientId: "recipient.testnet",
};
function fixture(
  options: {
    network?: string;
    storage?: unknown;
    metadata?: unknown;
    code?: string;
    failure?: boolean;
    unpinned?: boolean;
  } = {},
) {
  const rpc: InspectionRpc = {
    read: async (method, params) => {
      if (options.failure)
        throw new NearRpcError("unavailable", "Fixture outage");
      if (method === "status")
        return { chain_id: options.network ?? "testnet" };
      if (method === "block") return { header: { hash: block, height: 123 } };
      const p = params as Record<string, unknown>;
      const pinned = {
        block_hash: options.unpinned ? "wrong" : block,
        block_height: 123,
      };
      if (p.request_type === "view_account")
        return { ...pinned, code_hash: options.code ?? hash };
      const value =
        p.method_name === "ft_metadata"
          ? (options.metadata ?? {
              spec: "ft-1.0.0",
              name: "Test USDC",
              symbol: "USDC",
              decimals: 6,
            })
          : p.method_name === "storage_balance_bounds"
            ? { min: "1250000000000000000000", max: null }
            : options.storage === undefined
              ? { total: "1250000000000000000000", available: "0" }
              : options.storage;
      return {
        ...pinned,
        result: Array.from(Buffer.from(JSON.stringify(value))),
      };
    },
  };
  return new TestnetInspector("https://fixture.test", rpc);
}
void test("technical readiness never implies recipient ownership or execution approval", async () => {
  const inspector = fixture();
  const value = await nativeRecipientPreflight(inspector, request);
  assert.equal(value.technicalReady, true);
  assert.equal(value.ownership.status, "Unverified");
  assert.equal(value.executionReady, false);
  assert.equal(inspector.evidence.length, 7);
});
for (const [label, change] of [
  [
    "invalid account",
    { recipientId: "BAD ACCOUNT", approvedRecipientId: "BAD ACCOUNT" },
  ],
  ["wrong network", { network: "near:mainnet" }],
  ["wrong token", { tokenId: "other.testnet" }],
  ["changed approved recipient", { recipientId: "other.testnet" }],
  ["token code identity mismatch", { expectedTokenCodeHash: "6".repeat(44) }],
] as const) {
  void test(`recipient preflight rejects ${label}`, async () => {
    const value = await nativeRecipientPreflight(fixture(), {
      ...request,
      ...change,
    });
    assert.equal(value.technicalReady, false);
    assert.equal(value.executionReady, false);
  });
}
for (const [label, options] of [
  ["missing storage", { storage: null }],
  ["unexpected storage", { storage: { total: "1", available: "2" } }],
  [
    "inconsistent metadata",
    {
      metadata: {
        spec: "ft-1.0.0",
        symbol: "USDC",
        name: "Test",
        decimals: 18,
      },
    },
  ],
  ["unavailable RPC", { failure: true }],
  ["wrong RPC network", { network: "mainnet" }],
  ["unpinned view", { unpinned: true }],
] as const) {
  void test(`recipient preflight fails closed on ${label}`, async () => {
    const value = await nativeRecipientPreflight(fixture(options), request);
    assert.equal(value.technicalReady, false);
    assert.equal(value.executionReady, false);
  });
}
void test("expired, replayed and changed ownership claims never become verified", () => {
  const claim = {
    recipientId: request.recipientId,
    network: request.network,
    expiresAtMs: 2000,
    replayed: false,
  };
  assert.equal(
    ownershipPrerequisite(
      request.recipientId,
      { ...claim, expiresAtMs: 999 },
      1000,
    ).status,
    "VerificationExpired",
  );
  assert.equal(
    ownershipPrerequisite(
      request.recipientId,
      { ...claim, replayed: true },
      1000,
    ).status,
    "VerificationFailed",
  );
  assert.equal(
    ownershipPrerequisite("other.testnet", claim, 1000).status,
    "VerificationFailed",
  );
  assert.equal(
    ownershipPrerequisite(request.recipientId, claim, 1000).status,
    "VerificationPending",
  );
  assert.equal(
    ownershipPrerequisite(request.recipientId, claim, 1000).verified,
    false,
  );
});
