export type ContractPayoutStatus =
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

export type ExecutionJobState =
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

export type TokenIdentity =
  | { readonly Near: string }
  | { readonly External: string };

export interface CampaignAccounting {
  readonly campaignId: string;
  readonly budget: string;
  readonly funded: string;
  readonly reserved: string;
  readonly spent: string;
  readonly available: string;
  readonly tokenId: string;
  readonly tokenDecimals: number;
}

export interface ContractPayout {
  readonly id: string;
  readonly campaignId: string;
  readonly status: ContractPayoutStatus;
  readonly source: {
    readonly networkId: string;
    readonly token: TokenIdentity;
    readonly atomicAmount: string;
    readonly decimals: number;
  };
  readonly destination: {
    readonly networkId: string;
    readonly recipientAddress: string;
    readonly token: TokenIdentity;
    readonly expectedAtomicAmount: string;
    readonly decimals: number;
  };
  readonly createdAtNs: string;
  readonly executionReference: string | null;
  readonly settlementEvidenceReference: string | null;
}

export interface ExecutionAttempt {
  readonly sequence: number;
  readonly phase: string;
  readonly outcome: string;
  readonly startedAt: string;
}

export interface PersistedExecutionJob {
  readonly jobId: string;
  readonly payoutId: string;
  readonly campaignId: string;
  readonly state: ExecutionJobState;
  readonly observedContractStatus: ContractPayoutStatus;
  readonly source: {
    readonly tokenId: string;
    readonly atomicAmount: string;
    readonly decimals: number;
  };
  readonly destination: {
    readonly networkId: string;
    readonly recipientAddress: string;
    readonly tokenId: string;
    readonly expectedAtomicAmount: string;
    readonly decimals: number;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attemptCount: number;
  readonly attempts: readonly ExecutionAttempt[];
  readonly leaseExpiresAt: string | null;
  readonly failureCode: string | null;
}

export interface CampaignPayoutList {
  readonly campaignId: string;
  readonly jobs: readonly PersistedExecutionJob[];
  readonly truncated: boolean;
}

export type ExecutionApiErrorKind =
  | "configuration"
  | "invalid-request"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "unavailable"
  | "invalid-response";

export class ExecutionApiError extends Error {
  constructor(
    readonly kind: ExecutionApiErrorKind,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ExecutionApiError";
  }
}

export type ExecutionDataResult<T> =
  | { readonly kind: "success"; readonly data: T }
  | { readonly kind: "error"; readonly error: ExecutionApiError };

export const CONTRACT_PAYOUT_STATUSES: readonly ContractPayoutStatus[] = [
  "Created",
  "Authorized",
  "Reserved",
  "Executing",
  "PendingVerification",
  "Succeeded",
  "Failed",
  "RefundPending",
  "Refunded",
  "ManualReview",
  "ReservationReleased",
];

export const EXECUTION_JOB_STATES: readonly ExecutionJobState[] = [
  "Discovered",
  "Queued",
  "Leased",
  "Preparing",
  "SubmissionStarted",
  "SubmissionUnknown",
  "Submitted",
  "ConfirmationPending",
  "VerificationPending",
  "SettlementReady",
  "SettlementSubmitted",
  "Completed",
  "RetryableFailure",
  "ManualReview",
  "Abandoned",
];

const U128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);

export function formatAtomicAmount(atomicAmount: string, decimals: number): string {
  if (
    !/^(?:0|[1-9]\d{0,38})$/.test(atomicAmount) ||
    BigInt(atomicAmount) > U128_MAX ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new Error("Invalid token amount.");
  }
  const amount = BigInt(atomicAmount);
  if (decimals === 0) return groupInteger(amount.toString());
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = amount / scale;
  const fractional = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fractional
    ? `${groupInteger(whole.toString())}.${fractional}`
    : groupInteger(whole.toString());
}

export function formatTokenIdentity(token: TokenIdentity): string {
  return "Near" in token ? token.Near : token.External;
}

export function getContractStatusLabel(status: ContractPayoutStatus): string {
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function getExecutionStateLabel(state: ExecutionJobState): string {
  return state.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function groupInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
