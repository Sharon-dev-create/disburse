import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  expiredLeaseRecoveryAction,
  hashExecutionJobPayload,
  jobCreationIdempotencyKey,
  validateExecutionJobCreation,
} from "../src/persistence/postgres-job-repository.ts";
import type { ExecutionJobCreation } from "../src/persistence/repository.ts";
import type {
  ExecutionJobKey,
  PayoutReservedEvent,
  PayoutSnapshot,
} from "../src/domain/payout.ts";

void test("canonical payout snapshot hashing ignores object property order", () => {
  const first = hashExecutionJobPayload(jobKey, payout);
  const reordered = {
    settlementEvidenceReference: null,
    executionReference: null,
    contractStatus: "Reserved",
    expectedOutput: {
      decimals: 18,
      atomicAmount: "340282366920938463463374607431768211455",
      tokenId: "wrap.near",
    },
    recipientAddress: "recipient.near",
    destinationChainId: "near:testnet",
    inputAmount: {
      decimals: 24,
      atomicAmount: "900719925474099312345",
      tokenId: "near",
    },
    campaignId: "7",
    payoutId: "42",
  } satisfies PayoutSnapshot;
  assert.equal(first, hashExecutionJobPayload(jobKey, reordered));
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, x: null } }),
    '{"a":{"x":null,"y":true},"z":1}',
  );
});

void test("job-creation key is deterministic and creation validates reserved identity and exact amounts", () => {
  assert.equal(
    jobCreationIdempotencyKey(event),
    jobCreationIdempotencyKey(event),
  );
  const creation: ExecutionJobCreation = {
    event,
    payout,
    idempotencyKey: "job-create-test",
  };
  assert.doesNotThrow(() => validateExecutionJobCreation(creation));
  assert.throws(
    () =>
      validateExecutionJobCreation({
        ...creation,
        payout: { ...payout, contractStatus: "Executing" },
      }),
    /Only an on-chain Reserved payout/,
  );
  assert.throws(
    () =>
      validateExecutionJobCreation({
        ...creation,
        payout: {
          ...payout,
          expectedOutput: {
            ...payout.expectedOutput,
            atomicAmount: "340282366920938463463374607431768211456",
          },
        },
      }),
    /unsigned 128-bit/,
  );
});

void test("expired lease recovery is conservative across execution states", () => {
  assert.equal(expiredLeaseRecoveryAction("Leased"), "queue");
  assert.equal(expiredLeaseRecoveryAction("Preparing"), "manual-review");
  assert.equal(
    expiredLeaseRecoveryAction("SubmissionUnknown"),
    "manual-review",
  );
  assert.equal(expiredLeaseRecoveryAction("Submitted"), "manual-review");
  assert.equal(
    expiredLeaseRecoveryAction("SettlementSubmitted"),
    "manual-review",
  );
  assert.equal(expiredLeaseRecoveryAction("ManualReview"), "release-only");
  assert.equal(expiredLeaseRecoveryAction("Completed"), "release-only");
  assert.equal(expiredLeaseRecoveryAction("Abandoned"), "release-only");
});

const jobKey: ExecutionJobKey = {
  networkId: "near:testnet",
  contractId: "disburse.testnet",
  payoutId: "42",
};

const payout: PayoutSnapshot = {
  payoutId: "42",
  campaignId: "7",
  inputAmount: {
    tokenId: "near",
    atomicAmount: "900719925474099312345",
    decimals: 24,
  },
  destinationChainId: "near:testnet",
  recipientAddress: "recipient.near",
  expectedOutput: {
    tokenId: "wrap.near",
    atomicAmount: "340282366920938463463374607431768211455",
    decimals: 18,
  },
  contractStatus: "Reserved",
  executionReference: null,
  settlementEvidenceReference: null,
};

const event: PayoutReservedEvent = {
  event: "payout_reserved",
  payoutId: "42",
  campaignId: "7",
  contractStatus: "Reserved",
  identity: {
    networkId: "near:testnet",
    contractId: "disburse.testnet",
    transactionHash: "transaction-hash",
    blockHash: "block-hash",
    receiptId: "receipt-id",
    eventIndex: 0,
    blockHeight: "123",
  },
};
