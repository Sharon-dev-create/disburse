import type { PayoutId, TokenAmount } from "../domain/payout.ts";

export type NearPayoutStatus =
  | "Created"
  | "Authorized"
  | "Reserved"
  | "Executing"
  | "PendingVerification"
  | "Succeeded"
  | "Failed"
  | "RefundPending"
  | "Refunded"
  | "ManualReview"
  | "ReservationReleased";

export interface NearTokenAmountView {
  readonly tokenId: { readonly Near: string } | { readonly External: string };
  readonly atomicAmount: string;
  readonly decimals: number;
}

export interface NearPayoutView {
  readonly id: PayoutId;
  readonly campaignId: string;
  readonly recipientNearAccountId: string | null;
  readonly inputAmount: NearTokenAmountView;
  readonly destination: {
    readonly chainId: string;
    readonly recipientAddress: string;
  };
  readonly expectedOutputAmount: NearTokenAmountView;
  readonly status: NearPayoutStatus;
  readonly createdAtNs: string;
  readonly executionReference: string | null;
  readonly settlementEvidenceReference: string | null;
  readonly lifecycleReason: string | null;
  readonly failureEvidence: unknown | null;
  readonly settlementEvidence: unknown | null;
  readonly resolutionEvidence: readonly unknown[];
}

export interface CampaignAccountingSnapshot {
  readonly campaignId: string;
  readonly budget: string;
  readonly funded: string;
  readonly reserved: string;
  readonly spent: string;
  readonly available: string;
  readonly tokenId: string;
  readonly tokenDecimals: number;
}

export interface NearTransactionResult {
  readonly kind: "confirmed" | "outcome-unknown" | "definitively-failed";
  readonly transactionHash: string | null;
}

/** Read-only contract calls. JSON decoding must preserve uint64 IDs exactly. */
export interface ContractReader {
  getPayout(payoutId: PayoutId): Promise<NearPayoutView | null>;
  getCampaignPayout(
    campaignId: string,
    payoutId: PayoutId,
  ): Promise<NearPayoutView | null>;
  getPayoutByIdempotency(
    campaignId: string,
    idempotencyKey: string,
  ): Promise<NearPayoutView | null>;
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
