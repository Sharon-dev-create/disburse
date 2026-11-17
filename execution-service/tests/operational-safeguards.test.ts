import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessExecution,
  validateSafeguards,
  type ExecutionSafeguards,
} from "../src/operations/safeguards.ts";
const policy: ExecutionSafeguards = {
  network: "near:testnet",
  contractId: "disburse-test-contract.testnet",
  tokenId: "usdc.tidepool-sandbox.testnet",
  maxPayout: "100000",
  maxCampaignExposure: "1000000",
  maxPending: 1,
  maxAttempts: 1,
  timeoutMs: 30000,
  emergencyStop: true,
};
const state = {
  amount: "100000",
  campaignExposure: "100000",
  pending: 0,
  operator: "op.testnet",
  approver: "approve.testnet",
  executor: "execute.testnet",
  recipientVerified: false,
  outcome: "new" as const,
};
void test("dormant policy preserves execution disablement and emergency stop", () => {
  const value = assessExecution(policy, state);
  assert.equal(value.executionEnabled, false);
  assert.ok(value.blockers.includes("Emergency stop active"));
});
void test("network, contract, token and retry isolation fail closed", () => {
  for (const change of [
    { network: "near:mainnet" },
    { contractId: "other.testnet" },
    { tokenId: "other.testnet" },
    { maxAttempts: 2 },
    { maxPayout: "100001" },
  ])
    assert.throws(() =>
      validateSafeguards({ ...policy, ...change } as ExecutionSafeguards),
    );
});
void test("exposure, pending, unknown outcome and role separation are independent blockers", () => {
  const value = assessExecution(policy, {
    ...state,
    amount: "100001",
    pending: 1,
    outcome: "unknown",
    approver: state.executor,
  });
  for (const message of [
    "Exposure limit exceeded",
    "Pending limit exceeded",
    "Unknown outcome locked; no automatic retry",
    "Independent roles required",
  ])
    assert.ok(value.blockers.includes(message));
  assert.equal(value.executionEnabled, false);
});
void test("even fully populated local prerequisites never authorize a payout", () => {
  assert.equal(
    assessExecution(
      { ...policy, emergencyStop: false },
      { ...state, recipientVerified: true },
    ).executionEnabled,
    false,
  );
});
