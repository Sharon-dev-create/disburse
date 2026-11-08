import assert from "node:assert/strict";
import test from "node:test";

import {
  bindRefundPolicy,
  sameRefundPolicy,
  validateRefundPolicy,
} from "../src/providers/refund.ts";
import { validateRecipient } from "../src/providers/recipient.ts";
import {
  authorizeExecution,
  createExecutionAuthorization,
  type SigningPolicy,
  type SigningRequest,
} from "../src/providers/signing.ts";

void test("refund policy validation rejects empty or mismatched policy data", () => {
  const valid = {
    campaignId: "42",
    payoutId: "99",
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    refundAddress: "treasury.near",
    policyVersion: "v1",
    approvedAt: "2026-11-07T12:00:00.000Z",
  };
  assert.equal(validateRefundPolicy(valid).valid, true);
  assert.equal(sameRefundPolicy(valid, valid), true);
  assert.throws(() => bindRefundPolicy(valid, { ...valid, refundAddress: "other.near" }), /must match/);
  const invalid = { ...valid, refundAddress: "" };
  assert.equal(validateRefundPolicy(invalid).valid, false);
});

void test("recipient validation fails closed on malformed or unsupported destinations", () => {
  assert.equal(validateRecipient("near:mainnet", "alice.near").valid, true);
  assert.equal(validateRecipient("near:mainnet", "").valid, false);
  assert.equal(validateRecipient("eth:mainnet", "0x0000000000000000000000000000000000000000").valid, false);
  assert.equal(validateRecipient("eth:mainnet", "0x1234").valid, false);
  assert.equal(validateRecipient("chain:other", "0x1234").valid, false);
  assert.equal(validateRecipient("eth:mainnet", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed").valid, true);
});

void test("execution signing enforces spending limits and payout binding", () => {
  const policy: SigningPolicy = {
    policyVersion: "v1",
    requireFreshQuote: true,
    maxInputAtomicAmount: "5000",
    allowedSourceTokens: ["token:near-usdc"],
    allowedDestinationNetworks: ["eth:mainnet"],
    allowedDestinationTokens: ["token:eth-usdc"],
    approvedRecipient: "alice.destination",
    approvedRefundAddress: "treasury.near",
  };

  const request: SigningRequest = {
    campaignId: "42",
    payoutId: "99",
    executionAttemptId: "attempt-1",
    providerId: "near-intents-1click",
    quoteReference: "quote-1",
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    destinationNetworkId: "eth:mainnet",
    destinationTokenId: "token:eth-usdc",
    recipientAddress: "alice.destination",
    refundAddress: "treasury.near",
    maximumInputAtomicAmount: "4000",
    expectedOutputAtomicAmount: "300",
    quoteExpiresAt: "2030-01-01T00:00:00.000Z",
  };

  const decision = authorizeExecution(request, policy, Date.parse("2026-11-07T12:00:00.000Z"));
  assert.equal(decision.approved, true);
  assert.notEqual(decision.authorization, null);
  const auth = decision.authorization!;
  assert.equal(auth.authorizationHash, createExecutionAuthorization(request, policy, Date.parse("2026-11-07T12:00:00.000Z")).authorizationHash);

  const bad = { ...request, recipientAddress: "mallory.destination" };
  assert.equal(authorizeExecution(bad, policy, Date.parse("2026-11-07T12:00:00.000Z")).approved, false);
  assert.equal(authorizeExecution({ ...request, maximumInputAtomicAmount: "6000" }, policy, Date.parse("2026-11-07T12:00:00.000Z")).approved, false);
});
