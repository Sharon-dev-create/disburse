import type {
  PayoutId,
  PayoutSnapshot,
  TokenAmount,
} from "../domain/payout.ts";

export interface CampaignAccountingSnapshot {
  readonly campaignId: string;
  readonly budget: string;
  readonly funded: string;
  readonly reserved: string;
  readonly spent: string;
  readonly available: string;
}

export interface NearTransactionResult {
  readonly kind: "confirmed" | "outcome-unknown" | "definitively-failed";
  readonly transactionHash: string | null;
}

/** Read-only contract calls. JSON decoding must preserve uint64 IDs exactly. */
export interface ContractReader {
  getPayout(payoutId: PayoutId): Promise<PayoutSnapshot | null>;
  getCampaignPayout(
    campaignId: string,
    payoutId: PayoutId,
  ): Promise<PayoutSnapshot | null>;
  getCampaignPayoutAccounting(
    campaignId: string,
  ): Promise<CampaignAccountingSnapshot | null>;
  isPaused(): Promise<boolean>;
  hasRole(
    accountId: string,
    role: "Operator" | "Administrator" | "Verifier",
  ): Promise<boolean>;
}

export interface SettlementEvidenceInput {
  readonly payout_id: PayoutId;
  readonly provider_id: string;
  readonly destination_chain_id: string;
  readonly destination_transaction_reference: string;
  readonly transaction_event_identifier: string | null;
  readonly recipient_address: string;
  readonly output_amount: TokenAmount;
  readonly verifier_id: string;
  readonly verification_method: string;
  readonly verified_at_ns: string;
  readonly evidence_reference: string;
  readonly content_hash: string;
}

export interface ResolutionEvidenceInput {
  readonly payout_id: PayoutId;
  readonly verifier_id: string;
  readonly outcome: "ExecutionConfirmed" | "NonSettlementConfirmed";
  readonly verification_method: string;
  readonly verified_at_ns: string;
  readonly evidence_reference: string;
  readonly content_hash: string;
  readonly reason: string;
  readonly external_execution: {
    readonly provider_id: string;
    readonly destination_chain_id: string;
    readonly execution_reference: string;
    readonly transaction_event_identifier: string | null;
  } | null;
}

export interface FailureEvidenceInput {
  readonly kind: "RejectedBeforeSubmission" | "TransactionReverted";
  readonly evidence_reference: string;
  readonly reason: string;
}

/** Operator/Admin signing capability only; deliberately has no settlement methods. */
export interface OperatorContractWriter {
  startPayoutExecution(
    payoutId: PayoutId,
    executionReference: string,
  ): Promise<NearTransactionResult>;
  markPayoutPendingVerification(
    payoutId: PayoutId,
  ): Promise<NearTransactionResult>;
  markPayoutFailed(
    payoutId: PayoutId,
    evidence: FailureEvidenceInput,
  ): Promise<NearTransactionResult>;
  movePayoutToManualReview(
    payoutId: PayoutId,
    reason: string,
  ): Promise<NearTransactionResult>;
}

/** Explicit Verifier signing capability; never provided by the Operator client. */
export interface VerifierContractWriter {
  settlePayout(
    payoutId: PayoutId,
    evidence: SettlementEvidenceInput,
  ): Promise<NearTransactionResult>;
  releaseFailedPayoutReservation(
    payoutId: PayoutId,
    evidence: ResolutionEvidenceInput,
  ): Promise<NearTransactionResult>;
  confirmManualReviewExecution(
    payoutId: PayoutId,
    evidence: ResolutionEvidenceInput,
  ): Promise<NearTransactionResult>;
  releaseManualReviewReservation(
    payoutId: PayoutId,
    evidence: ResolutionEvidenceInput,
  ): Promise<NearTransactionResult>;
}
