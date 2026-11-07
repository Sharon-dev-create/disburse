import assert from "node:assert/strict";
import test from "node:test";

import { restartAction } from "../src/providers/adapter.ts";
import { assertTransition } from "../src/state-machine/state.ts";
import {
  MockExecutionProvider,
  MockSettlementVerifier,
} from "./support/mock-adapters.ts";

void test("valid operational path requires separately verified evidence and on-chain settlement", () => {
  assertTransition("Discovered", "Queued", {
    contractPayoutStatus: "Reserved",
  });
  assertTransition("Queued", "Leased");
  assertTransition("Leased", "Preparing");
  assertTransition("Preparing", "SubmissionStarted");
  assertTransition("SubmissionStarted", "Submitted", {
    providerOutcome: "accepted",
  });
  assertTransition("Submitted", "ConfirmationPending");
  assertTransition("ConfirmationPending", "VerificationPending");
  assert.throws(
    () => assertTransition("VerificationPending", "SettlementReady"),
    /Provider success alone/,
  );
  assertTransition("VerificationPending", "SettlementReady", {
    independentVerification: "passed",
  });
  assertTransition("SettlementReady", "SettlementSubmitted");
  assert.throws(
    () => assertTransition("SettlementSubmitted", "Completed"),
    /contract reports/,
  );
  assertTransition("SettlementSubmitted", "Completed", {
    contractPayoutStatus: "Succeeded",
  });
});

void test("invalid state transitions and provider-only success cannot authorize settlement", async () => {
  assert.throws(
    () => assertTransition("Completed", "Queued"),
    /Invalid execution/,
  );

  const provider = new MockExecutionProvider();
  provider.status = {
    kind: "succeeded",
    reference: provider.evidence.reference,
  };
  const claims = await provider.getEvidence("execution-1");
  const verifier = new MockSettlementVerifier();
  const result = await verifier.verify(payoutSnapshot, claims);

  assert.equal(provider.status.kind, "succeeded");
  assert.equal(result.kind, "insufficient");
  assert.throws(
    () =>
      assertTransition("VerificationPending", "SettlementReady", {
        independentVerification: "insufficient",
      }),
    /Provider success alone/,
  );
});

void test("ambiguous submission cannot be retried; reconcile or escalate", () => {
  assertTransition("SubmissionStarted", "SubmissionUnknown", {
    providerOutcome: "unknown",
  });
  assert.throws(
    () =>
      assertTransition("SubmissionUnknown", "RetryableFailure", {
        providerOutcome: "unknown",
        retryPermitted: true,
      }),
    /uncertain provider outcome/,
  );
  assert.equal(
    restartAction("SubmissionUnknown", {
      idempotency: "unknown",
      lookupByExecutionReference: true,
    }),
    "reconcile-only",
  );
  assert.equal(
    restartAction("SubmissionUnknown", {
      idempotency: "unsupported",
      lookupByExecutionReference: false,
    }),
    "manual-review",
  );
  assertTransition("SubmissionUnknown", "RetryableFailure", {
    providerOutcome: "definitively-not-accepted",
    retryPermitted: true,
  });
});

void test("manual-review exit and settlement uncertainty require authoritative chain state", () => {
  assert.throws(
    () => assertTransition("ManualReview", "VerificationPending"),
    /return to PendingVerification/,
  );
  assertTransition("ManualReview", "VerificationPending", {
    contractPayoutStatus: "PendingVerification",
  });
  assert.throws(
    () =>
      assertTransition("ManualReview", "Abandoned", {
        contractPayoutStatus: "ManualReview",
      }),
    /reservation release/,
  );
  assert.throws(
    () =>
      assertTransition("SettlementSubmitted", "SettlementReady", {
        nearTransactionOutcome: "unknown",
        contractPayoutStatus: "PendingVerification",
        independentVerification: "passed",
      }),
    /failed NEAR transaction/,
  );
});

const payoutSnapshot = {
  payoutId: "42",
  campaignId: "7",
  inputAmount: { tokenId: "token:near", atomicAmount: "100", decimals: 6 },
  destinationChainId: "chain:test",
  recipientAddress: "recipient:test",
  expectedOutput: {
    tokenId: "token:external",
    atomicAmount: "100",
    decimals: 6,
  },
  contractStatus: "Reserved" as const,
  executionReference: null,
  settlementEvidenceReference: null,
};
