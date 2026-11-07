export type JobState =
  | "Discovered"
  | "Queued"
  | "Leased"
  | "Preparing"
  | "SubmissionStarted"
  | "SubmissionUnknown"
  | "Submitted"
  | "ConfirmationPending"
  | "VerificationPending"
  | "SettlementReady"
  | "SettlementSubmitted"
  | "Completed"
  | "RetryableFailure"
  | "ManualReview"
  | "Abandoned";

export interface TransitionEvidence {
  readonly contractPayoutStatus?:
    | "Reserved"
    | "Executing"
    | "PendingVerification"
    | "Succeeded"
    | "Failed"
    | "ManualReview"
    | "ReservationReleased";
  readonly providerOutcome?: "accepted" | "definitively-not-accepted" | "unknown";
  readonly retryPermitted?: boolean;
  readonly independentVerification?: "passed" | "failed" | "insufficient";
  readonly nearTransactionOutcome?: "succeeded" | "definitively-failed" | "unknown";
}

const transitions: Readonly<Record<JobState, readonly JobState[]>> = {
  Discovered: ["Queued"],
  Queued: ["Leased"],
  Leased: ["Preparing", "Queued"],
  Preparing: ["SubmissionStarted", "RetryableFailure", "ManualReview"],
  SubmissionStarted: ["Submitted", "SubmissionUnknown", "RetryableFailure", "ManualReview"],
  SubmissionUnknown: ["Submitted", "RetryableFailure", "ManualReview"],
  Submitted: ["ConfirmationPending", "ManualReview"],
  ConfirmationPending: ["VerificationPending", "RetryableFailure", "ManualReview"],
  VerificationPending: ["SettlementReady", "ManualReview"],
  SettlementReady: ["SettlementSubmitted", "ManualReview"],
  SettlementSubmitted: ["Completed", "SettlementReady", "ManualReview"],
  Completed: [],
  RetryableFailure: ["Queued", "ManualReview", "Abandoned"],
  ManualReview: ["VerificationPending", "Completed", "Abandoned"],
  Abandoned: []
};

export function canTransition(from: JobState, to: JobState): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(
  from: JobState,
  to: JobState,
  evidence: TransitionEvidence = {}
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid execution job transition: ${from} -> ${to}`);
  }

  if (to === "Queued" && from === "Discovered" && evidence.contractPayoutStatus !== "Reserved") {
    throw new Error("A job can be queued only after confirming the payout is Reserved on-chain");
  }
  if (to === "Submitted" && evidence.providerOutcome !== "accepted") {
    throw new Error("Provider acceptance must be reconciled before marking a job Submitted");
  }
  if (to === "SubmissionUnknown" && evidence.providerOutcome !== "unknown") {
    throw new Error("SubmissionUnknown requires an ambiguous provider outcome");
  }
  if (to === "RetryableFailure") {
    if (evidence.providerOutcome === "unknown" || evidence.providerOutcome === undefined) {
      throw new Error("An uncertain provider outcome cannot be classified as retryable failure");
    }
    if (from === "SubmissionUnknown" && evidence.providerOutcome !== "definitively-not-accepted") {
      throw new Error("Unknown submissions require definitive non-acceptance before retry");
    }
    if (evidence.retryPermitted !== true) {
      throw new Error("Retry requires an explicit safe-retry decision");
    }
  }
  if (to === "SettlementReady" && evidence.independentVerification !== "passed") {
    throw new Error("Provider success alone cannot make a job SettlementReady");
  }
  if (to === "SettlementReady" && from === "SettlementSubmitted") {
    if (
      evidence.nearTransactionOutcome !== "definitively-failed" ||
      evidence.contractPayoutStatus !== "PendingVerification"
    ) {
      throw new Error("Settlement retry requires a failed NEAR transaction and pending on-chain payout");
    }
  }
  if (to === "Completed" && evidence.contractPayoutStatus !== "Succeeded") {
    throw new Error("A job is Completed only after the contract reports Succeeded");
  }
  if (to === "Abandoned" && evidence.contractPayoutStatus !== "ReservationReleased") {
    throw new Error("A job is Abandoned only after on-chain reservation release");
  }
  if (from === "ManualReview" && to === "VerificationPending" && evidence.contractPayoutStatus !== "PendingVerification") {
    throw new Error("ManualReview recovery requires the contract to return to PendingVerification");
  }
}
