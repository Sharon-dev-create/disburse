import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProviderRefundDestination,
  bindRefundPolicy,
  fingerprintRefundPolicy,
  InMemoryRefundPolicyRepository,
  newRefundPolicyMemoryState,
  validateRefundPolicy,
  type RefundPolicy,
} from "../src/providers/refund.ts";
import { validateRecipient } from "../src/providers/recipient.ts";
import { SUPPORTED_NETWORKS } from "../src/providers/networks.ts";
import {
  authorizeExecution,
  fingerprintSigningPolicy,
  hashExecutionAuthorization,
  InMemoryAuthorizationRepository,
  newAuthorizationMemoryState,
  verifyExecutionAuthorization,
  type PayoutReservationSnapshot,
  type SigningPolicy,
  type SigningRequest,
} from "../src/providers/signing.ts";
import type { ExecutionOpportunity } from "../src/providers/quote.ts";

const now = Date.parse("2026-11-08T12:00:00.000Z");
const evmLower = "0x52908400098527886e0f7030069857d2e4169ee7";
const evmUpper = "0x52908400098527886E0F7030069857D2E4169EE7";
const evmMixedKnown = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

void test("network registry is explicit, canonical, and separates NEAR environments", () => {
  assert.deepEqual(Object.keys(SUPPORTED_NETWORKS).sort(), [
    "eip155:1",
    "eip155:8453",
    "near:mainnet",
    "near:testnet",
  ]);
  assert.equal(SUPPORTED_NETWORKS["eip155:1"]?.chainId, "1");
  assert.equal(SUPPORTED_NETWORKS["eip155:8453"]?.chainId, "8453");
  assert.equal(SUPPORTED_NETWORKS["near:mainnet"]?.environment, "mainnet");
  assert.equal(SUPPORTED_NETWORKS["near:testnet"]?.environment, "testnet");
  for (const [network, address] of [
    ["eip155:1", evmLower],
    ["eip155:8453", evmLower],
    ["near:mainnet", "alice.near"],
    ["near:testnet", "alice.testnet"],
  ] as const) {
    assert.equal(validateRecipient(network, address).valid, true);
  }
  for (const network of [
    "eth:mainnet",
    "base:mainnet",
    "eip155:0",
    "eip155:01",
    "near",
    "near:devnet",
    "eip155:1:8453",
  ]) {
    assert.equal(validateRecipient(network, evmLower).valid, false, network);
  }
  assert.equal(SUPPORTED_NETWORKS["eip155:1"]?.executionEnabled, false);
});

void test("EVM validation enforces shape, rejects zero and refuses unverifiable mixed-case checksums", () => {
  assert.equal(
    validateRecipient("eip155:1", evmLower).normalizedAddress,
    evmLower,
  );
  assert.equal(
    validateRecipient("eip155:1", evmUpper).normalizedAddress,
    evmLower,
  );
  assert.equal(validateRecipient("eip155:1", evmMixedKnown).valid, true);
  assert.equal(
    validateRecipient("eip155:1", "0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed")
      .valid,
    false,
  );
  for (const address of [
    "0x0000000000000000000000000000000000000000",
    "0x1234",
    evmLower.slice(2),
    `0x${"z".repeat(40)}`,
    `0x${"a".repeat(39)} `,
    `  ${evmLower}`,
    `${evmLower} `,
    `0x${"a".repeat(129)}`,
  ])
    assert.equal(validateRecipient("eip155:1", address).valid, false, address);
});

void test("NEAR validation follows named and implicit account ID grammar and boundaries", () => {
  for (const account of [
    "ab",
    "alice.near",
    "a-b",
    "a_b",
    "a.b",
    "a".repeat(64),
    "f".repeat(64),
  ]) {
    assert.equal(
      validateRecipient("near:mainnet", account).valid,
      true,
      account,
    );
  }
  for (const account of [
    "a",
    "AlicE.near",
    ".alice",
    "alice.",
    "alice..near",
    "alice--near",
    "alice_-near",
    "alice@near",
    "x".repeat(65),
    " ",
    " alice.near",
  ]) {
    assert.equal(
      validateRecipient("near:mainnet", account).valid,
      false,
      account,
    );
  }
});

void test("refund policy binds every field, fingerprints canonically, and cannot be replaced", async () => {
  const policy = refundPolicy();
  const repoState = newRefundPolicyMemoryState();
  const repository = new InMemoryRefundPolicyRepository(repoState);
  const approved = await repository.approve(policy);
  assert.equal(Object.isFrozen(approved), true);
  assert.match(approved.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(bindRefundPolicy(policy, approved), approved);
  assertProviderRefundDestination(approved, "treasury.near");
  assert.throws(
    () => assertProviderRefundDestination(approved, "mallory.near"),
    /differs/,
  );
  for (const changed of [
    { campaignId: "43" },
    { payoutId: "100" },
    { sourceNetworkId: "near:testnet" },
    { sourceTokenId: "token:other" },
    { refundAddress: "other.near" },
    { policyVersion: "v2" },
    { approvedAt: "2026-11-08T12:00:01.000Z" },
  ]) {
    assert.throws(
      () => bindRefundPolicy({ ...policy, ...changed }, approved),
      /mismatch|integrity/,
    );
    if (!("campaignId" in changed) && !("payoutId" in changed)) {
      await assert.rejects(
        repository.approve({ ...policy, ...changed }),
        /already approved/,
      );
    }
  }
  const mutated = {
    ...approved,
    refundAddress: "mallory.near",
  } as typeof approved;
  assert.throws(() => bindRefundPolicy(mutated, approved), /integrity/);
  assert.equal(fingerprintRefundPolicy(policy), approved.fingerprint);
  assert.equal(
    (await repository.get("42", "99"))?.fingerprint,
    approved.fingerprint,
  );
});

void test("refund policy rejects malformed timestamps, invalid address, network and payout IDs", () => {
  const base = refundPolicy();
  for (const policy of [
    { ...base, campaignId: "01" },
    { ...base, payoutId: "-1" },
    { ...base, sourceNetworkId: "near" },
    { ...base, sourceTokenId: " token" },
    { ...base, refundAddress: "alice..near" },
    { ...base, approvedAt: "November 8, 2026" },
    { ...base, approvedAt: "2026-02-30T12:00:00.000Z" },
  ])
    assert.equal(validateRefundPolicy(policy).valid, false);
});

void test("signing policy fingerprint covers all policy fields and sorts allowlists", () => {
  const policy = signingPolicy();
  assert.equal(
    fingerprintSigningPolicy(policy),
    fingerprintSigningPolicy({
      ...policy,
      allowedSourceTokens: [...policy.allowedSourceTokens].reverse(),
    }),
  );
  const mutations = [
    { maxInputAtomicAmount: "5001" },
    { allowedSourceNetworks: ["near:testnet"] },
    { allowedSourceTokens: ["token:other"] },
    { allowedDestinationNetworks: ["eip155:8453"] },
    { allowedDestinationTokens: ["token:other"] },
    { approvedRecipient: "0x0000000000000000000000000000000000000001" },
    { approvedRefundAddress: "other.near" },
    { approvedRefundPolicyFingerprint: "b".repeat(64) },
    { requireFreshQuote: false, maxQuoteAgeMs: null },
    { maxQuoteAgeMs: 20_000 },
    { policyVersion: "v2" },
  ];
  for (const mutation of mutations)
    assert.notEqual(
      fingerprintSigningPolicy({ ...policy, ...mutation }),
      fingerprintSigningPolicy(policy),
    );
});

void test("authorization binds exact payout reservation, quote, attempt, route, spending and policy", () => {
  const request = signingRequest();
  const policy = signingPolicy();
  const reservation = reservationSnapshot();
  const quote = opportunity();
  const result = authorizeExecution(request, policy, reservation, quote, now);
  assert.equal(result.approved, true, result.reason ?? "");
  const auth = result.authorization!;
  assert.equal(auth.lifecycle, "Approved");
  assert.equal(auth.quoteRequiredInputAtomicAmount, "4000");
  assert.equal(
    auth.reservationIdentity,
    JSON.stringify([
      "near-payout-reservation-v1",
      "near:mainnet",
      "disburse.near",
      "42",
      "99",
      "token:near-usdc",
      "4000",
    ]),
  );
  verifyExecutionAuthorization(auth, request, policy, reservation, quote, now);

  assert.equal(
    authorizeExecution(
      { ...request, destinationNetworkId: "eip155:8453" },
      policy,
      reservation,
      quote,
      now,
    ).approved,
    true,
  );
  assert.equal(
    authorizeExecution(
      { ...request, refundAddress: "mallory.near" },
      policy,
      reservation,
      quote,
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      { ...request, maximumInputAtomicAmount: "4001" },
      policy,
      reservation,
      quote,
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      { ...request, expectedOutputAtomicAmount: "299" },
      policy,
      reservation,
      quote,
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      { ...request, executionAttemptId: "attempt-other" },
      policy,
      reservation,
      quote,
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      policy,
      { ...reservation, status: "ReservationReleased" },
      quote,
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      policy,
      { ...reservation, campaignId: "43" },
      quote,
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      policy,
      { ...reservation, networkId: "near:testnet" },
      quote,
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      policy,
      { ...reservation, inputAtomicAmount: "3999" },
      quote,
      now,
    ).approved,
    false,
  );
});

void test("authorization rejects quote expiry, stale quote, wrong attempt, and quote-required input over caps", () => {
  const request = signingRequest();
  const policy = signingPolicy();
  const reservation = reservationSnapshot();
  assert.equal(
    authorizeExecution(
      request,
      policy,
      reservation,
      { ...opportunity(), expiresAt: null },
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      policy,
      reservation,
      { ...opportunity(), expiresAt: new Date(now).toISOString() },
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      policy,
      reservation,
      {
        ...opportunity(),
        providerMetadata: {
          ...opportunity().providerMetadata,
          responseTimestamp: new Date(now - 40_000).toISOString(),
        },
      },
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      policy,
      reservation,
      {
        ...opportunity(),
        providerMetadata: {
          ...opportunity().providerMetadata,
          executionAttemptId: "attempt-other",
        },
      },
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      policy,
      reservation,
      { ...opportunity(), quotedInputAtomicAmount: "4001" },
      now,
    ).approved,
    false,
  );
  assert.equal(
    authorizeExecution(
      request,
      { ...policy, requireFreshQuote: false, maxQuoteAgeMs: null },
      reservation,
      { ...opportunity(), expiresAt: null },
      now,
    ).approved,
    true,
  );
});

void test("authorization hash tampering, policy mutation and cross-payout reuse fail verification", () => {
  const request = signingRequest();
  const policy = signingPolicy();
  const reservation = reservationSnapshot();
  const quote = opportunity();
  const auth = authorizeExecution(
    request,
    policy,
    reservation,
    quote,
    now,
  ).authorization!;
  const changed = {
    ...auth,
    recipientAddress: "0x0000000000000000000000000000000000000001",
  };
  assert.notEqual(hashExecutionAuthorization(changed), auth.authorizationHash);
  assert.throws(
    () =>
      verifyExecutionAuthorization(
        changed,
        request,
        policy,
        reservation,
        quote,
        now,
      ),
    /integrity/,
  );
  assert.throws(
    () =>
      verifyExecutionAuthorization(
        auth,
        request,
        { ...policy, maxInputAtomicAmount: "4999" },
        reservation,
        quote,
        now,
      ),
    /fingerprint/,
  );
  assert.throws(
    () =>
      verifyExecutionAuthorization(
        auth,
        request,
        { ...policy, approvedRefundAddress: "other.near" },
        reservation,
        quote,
        now,
      ),
    /fingerprint/,
  );
  assert.throws(
    () =>
      verifyExecutionAuthorization(
        auth,
        request,
        { ...policy, allowedDestinationNetworks: ["eip155:8453"] },
        reservation,
        quote,
        now,
      ),
    /fingerprint/,
  );
  assert.throws(
    () =>
      verifyExecutionAuthorization(
        auth,
        request,
        { ...policy, policyVersion: "v2" },
        reservation,
        quote,
        now,
      ),
    /fingerprint/,
  );
  assert.throws(
    () =>
      verifyExecutionAuthorization(
        auth,
        request,
        policy,
        { ...reservation, payoutId: "100" },
        quote,
        now,
      ),
    /integrity|another campaign or payout/,
  );
});

void test("authorization consumption is single-use, atomic in-process, revocable, and shared-state restart testable", async () => {
  const state = newAuthorizationMemoryState();
  const repo1 = new InMemoryAuthorizationRepository(state);
  const request = signingRequest();
  const policy = signingPolicy();
  const reservation = reservationSnapshot();
  const quote = opportunity();
  const auth = authorizeExecution(
    request,
    policy,
    reservation,
    quote,
    now,
  ).authorization!;
  assert.deepEqual(await repo1.createApproved(auth), auth);
  await assert.rejects(
    repo1.createApproved({ ...auth, recipientAddress: "attacker" }),
    /integrity/,
  );
  const repoAfterRestart = new InMemoryAuthorizationRepository(state);
  assert.equal(
    (await repoAfterRestart.get(auth.authorizationId))?.lifecycle,
    "Approved",
  );
  const concurrent = await Promise.allSettled([
    repo1.consume(
      auth.authorizationId,
      request,
      policy,
      reservation,
      quote,
      now,
    ),
    repoAfterRestart.consume(
      auth.authorizationId,
      request,
      policy,
      reservation,
      quote,
      now,
    ),
  ]);
  assert.equal(
    concurrent.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    concurrent.filter((result) => result.status === "rejected").length,
    1,
  );
  await assert.rejects(
    repo1.consume(
      auth.authorizationId,
      request,
      policy,
      reservation,
      quote,
      now,
    ),
    /Consumed/,
  );

  const revokeAuth = authorizeExecution(
    { ...request, executionAttemptId: "attempt-2" },
    policy,
    reservation,
    {
      ...quote,
      providerMetadata: {
        ...quote.providerMetadata,
        executionAttemptId: "attempt-2",
      },
    },
    now,
  ).authorization!;
  await repo1.createApproved(revokeAuth);
  await repo1.revoke(revokeAuth.authorizationId);
  await assert.rejects(
    repo1.consume(
      revokeAuth.authorizationId,
      { ...request, executionAttemptId: "attempt-2" },
      policy,
      reservation,
      {
        ...quote,
        providerMetadata: {
          ...quote.providerMetadata,
          executionAttemptId: "attempt-2",
        },
      },
      now,
    ),
    /Revoked/,
  );
});

void test("large atomic amounts remain exact and invalid authorization does not mutate contract accounting", () => {
  const large = "340282366920938463463374607431768211455";
  const request = { ...signingRequest(), maximumInputAtomicAmount: large };
  const policy = { ...signingPolicy(), maxInputAtomicAmount: large };
  const reservation = {
    ...reservationSnapshot(),
    inputAtomicAmount: large,
    campaignReservedAtomicAmount: large,
  };
  const quote = { ...opportunity(), quotedInputAtomicAmount: large };
  const before = { ...reservation };
  const rejected = authorizeExecution(
    {
      ...request,
      maximumInputAtomicAmount: "340282366920938463463374607431768211456",
    },
    policy,
    reservation,
    quote,
    now,
  );
  assert.equal(rejected.approved, false);
  assert.deepEqual(reservation, before);
});

function refundPolicy(): RefundPolicy {
  return {
    campaignId: "42",
    payoutId: "99",
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    refundAddress: "treasury.near",
    policyVersion: "refund-v1",
    approvedAt: "2026-11-08T12:00:00.000Z",
  };
}

function signingPolicy(): SigningPolicy {
  return {
    policyVersion: "sign-v1",
    requireFreshQuote: true,
    maxQuoteAgeMs: 30_000,
    maxInputAtomicAmount: "5000",
    allowedSourceNetworks: ["near:mainnet"],
    allowedSourceTokens: ["token:near-usdc"],
    allowedDestinationNetworks: ["eip155:1"],
    allowedDestinationTokens: ["token:eth-usdc"],
    approvedRecipient: evmLower,
    approvedRefundAddress: "treasury.near",
    approvedRefundPolicyFingerprint: fingerprintRefundPolicy(refundPolicy()),
  };
}

function signingRequest(): SigningRequest {
  return {
    nearNetworkId: "near:mainnet",
    contractId: "disburse.near",
    campaignId: "42",
    payoutId: "99",
    executionAttemptId: "attempt-1",
    providerId: "near-intents-1click",
    quoteReference: "quote-1",
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    destinationNetworkId: "eip155:1",
    destinationTokenId: "token:eth-usdc",
    recipientAddress: evmLower,
    refundAddress: "treasury.near",
    refundPolicyFingerprint: fingerprintRefundPolicy(refundPolicy()),
    maximumInputAtomicAmount: "4000",
    expectedOutputAtomicAmount: "300",
  };
}

function reservationSnapshot(): PayoutReservationSnapshot {
  return {
    networkId: "near:mainnet",
    contractId: "disburse.near",
    observedAtBlock: "1234",
    campaignId: "42",
    payoutId: "99",
    status: "Reserved",
    inputTokenId: "token:near-usdc",
    inputAtomicAmount: "4000",
    campaignReservedAtomicAmount: "4000",
    expectedOutputTokenId: "token:eth-usdc",
    expectedOutputAtomicAmount: "300",
    destinationNetworkId: "eip155:1",
    recipientAddress: evmLower,
  };
}

function opportunity(): ExecutionOpportunity {
  return {
    providerId: "near-intents-1click",
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    quotedInputAtomicAmount: "4000",
    maximumInputAtomicAmount: null,
    destinationNetworkId: "eip155:1",
    destinationTokenId: "token:eth-usdc",
    recipientAddress: evmLower,
    expectedOutputAtomicAmount: "300",
    minimumOutputAtomicAmount: "300",
    quoteReference: "quote-1",
    expiresAt: new Date(now + 60_000).toISOString(),
    freshUntil: new Date(now + 30_000).toISOString(),
    fees: [],
    estimatedExecutionSeconds: 60,
    providerMetadata: {
      responseTimestamp: new Date(now - 5_000).toISOString(),
      executionAttemptId: "attempt-1",
    },
  };
}
