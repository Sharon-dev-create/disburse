import {
  demoCampaigns,
  getDemoCampaign,
  type Campaign,
} from "./campaign-demo-data";
import {
  getRecipientById,
  type Recipient,
} from "./recipient-demo-data";

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

export type PayoutActivity = {
  id: string;
  occurredAt: string;
  source: "contract" | "execution-service";
  title: string;
  description: string;
};

export type Payout = {
  id: string;
  contractPayoutId: string | null;
  campaignId: string;
  recipientId: string;
  sourceNetwork: string;
  sourceToken: string;
  destinationNetwork: string;
  destinationToken: string;
  inputAmount: string;
  reservedAmount: string;
  expectedOutputAmount: string | null;
  actualVerifiedOutputAmount: string | null;
  quoteId: string | null;
  executionAuthorizationId: string | null;
  sourceTransactionHash: string | null;
  destinationTransactionHash: string | null;
  refundTransactionHash: string | null;
  status: ContractPayoutStatus;
  executionState: ExecutionJobState | null;
  idempotencyKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  failureReason: string | null;
  refundAmount: string | null;
  retryInformation: {
    available: boolean;
    reason: string;
  };
  settlementVerification: {
    verified: boolean;
    evidenceSource: string | null;
    verifiedOutputAmount: string | null;
  };
  activity: readonly PayoutActivity[];
  dataSource: "illustrative";
};

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

export const payoutStatusLabels: Record<ContractPayoutStatus, string> = {
  Created: "Created",
  Authorized: "Authorized",
  Reserved: "Reserved",
  Executing: "Executing",
  PendingVerification: "Pending verification",
  Succeeded: "Succeeded",
  Failed: "Failed",
  RefundPending: "Refund pending",
  Refunded: "Refunded",
  ManualReview: "Manual review",
  ReservationReleased: "Reservation released",
};

export const demoPayouts: readonly Payout[] = [
  {
    id: "DEMO-PAYOUT-001",
    contractPayoutId: null,
    campaignId: "CAM-042",
    recipientId: "REC-101",
    sourceNetwork: "NEAR",
    sourceToken: "USDC",
    destinationNetwork: "NEAR",
    destinationToken: "USDC",
    inputAmount: "600",
    reservedAmount: "600",
    expectedOutputAmount: null,
    actualVerifiedOutputAmount: null,
    quoteId: null,
    executionAuthorizationId: null,
    sourceTransactionHash: null,
    destinationTransactionHash: null,
    refundTransactionHash: null,
    status: "Reserved",
    executionState: null,
    idempotencyKey: null,
    createdAt: null,
    updatedAt: null,
    failureReason: null,
    refundAmount: null,
    retryInformation: {
      available: false,
      reason: "Retry is not connected to an execution service.",
    },
    settlementVerification: {
      verified: false,
      evidenceSource: null,
      verifiedOutputAmount: null,
    },
    activity: [],
    dataSource: "illustrative",
  },
  {
    id: "DEMO-PAYOUT-002",
    contractPayoutId: null,
    campaignId: "CAM-042",
    recipientId: "REC-106",
    sourceNetwork: "NEAR",
    sourceToken: "USDC",
    destinationNetwork: "Base",
    destinationToken: "USDC",
    inputAmount: "1000",
    reservedAmount: "1000",
    expectedOutputAmount: null,
    actualVerifiedOutputAmount: null,
    quoteId: null,
    executionAuthorizationId: null,
    sourceTransactionHash: null,
    destinationTransactionHash: null,
    refundTransactionHash: null,
    status: "PendingVerification",
    executionState: null,
    idempotencyKey: null,
    createdAt: null,
    updatedAt: null,
    failureReason: null,
    refundAmount: null,
    retryInformation: {
      available: false,
      reason: "Retry eligibility cannot be determined without execution state.",
    },
    settlementVerification: {
      verified: false,
      evidenceSource: null,
      verifiedOutputAmount: null,
    },
    activity: [],
    dataSource: "illustrative",
  },
  {
    id: "DEMO-PAYOUT-003",
    contractPayoutId: null,
    campaignId: "CAM-042",
    recipientId: "REC-101",
    sourceNetwork: "NEAR",
    sourceToken: "USDC",
    destinationNetwork: "NEAR",
    destinationToken: "USDC",
    inputAmount: "1000",
    reservedAmount: "1000",
    expectedOutputAmount: null,
    actualVerifiedOutputAmount: null,
    quoteId: null,
    executionAuthorizationId: null,
    sourceTransactionHash: null,
    destinationTransactionHash: null,
    refundTransactionHash: null,
    status: "Failed",
    executionState: null,
    idempotencyKey: null,
    createdAt: null,
    updatedAt: null,
    failureReason: null,
    refundAmount: null,
    retryInformation: {
      available: false,
      reason: "A failed payout may still hold its reservation; verifier recovery is not available here.",
    },
    settlementVerification: {
      verified: false,
      evidenceSource: null,
      verifiedOutputAmount: null,
    },
    activity: [],
    dataSource: "illustrative",
  },
  {
    id: "DEMO-PAYOUT-004",
    contractPayoutId: null,
    campaignId: "CAM-041",
    recipientId: "REC-102",
    sourceNetwork: "NEAR",
    sourceToken: "USDC",
    destinationNetwork: "Ethereum",
    destinationToken: "USDC",
    inputAmount: "1200",
    reservedAmount: "1200",
    expectedOutputAmount: null,
    actualVerifiedOutputAmount: null,
    quoteId: null,
    executionAuthorizationId: null,
    sourceTransactionHash: null,
    destinationTransactionHash: null,
    refundTransactionHash: null,
    status: "Reserved",
    executionState: null,
    idempotencyKey: null,
    createdAt: null,
    updatedAt: null,
    failureReason: null,
    refundAmount: null,
    retryInformation: {
      available: false,
      reason: "Retry is not connected to an execution service.",
    },
    settlementVerification: {
      verified: false,
      evidenceSource: null,
      verifiedOutputAmount: null,
    },
    activity: [],
    dataSource: "illustrative",
  },
  {
    id: "DEMO-PAYOUT-005",
    contractPayoutId: null,
    campaignId: "CAM-041",
    recipientId: "REC-106",
    sourceNetwork: "NEAR",
    sourceToken: "USDC",
    destinationNetwork: "Base",
    destinationToken: "USDC",
    inputAmount: "1500",
    reservedAmount: "1500",
    expectedOutputAmount: null,
    actualVerifiedOutputAmount: null,
    quoteId: null,
    executionAuthorizationId: null,
    sourceTransactionHash: null,
    destinationTransactionHash: null,
    refundTransactionHash: null,
    status: "ManualReview",
    executionState: null,
    idempotencyKey: null,
    createdAt: null,
    updatedAt: null,
    failureReason: null,
    refundAmount: null,
    retryInformation: {
      available: false,
      reason: "Manual review state cannot be changed by this frontend.",
    },
    settlementVerification: {
      verified: false,
      evidenceSource: null,
      verifiedOutputAmount: null,
    },
    activity: [],
    dataSource: "illustrative",
  },
  {
    id: "DEMO-PAYOUT-006",
    contractPayoutId: null,
    campaignId: "CAM-039",
    recipientId: "REC-105",
    sourceNetwork: "NEAR",
    sourceToken: "USDC",
    destinationNetwork: "NEAR",
    destinationToken: "USDC",
    inputAmount: "1120",
    reservedAmount: "1120",
    expectedOutputAmount: null,
    actualVerifiedOutputAmount: null,
    quoteId: null,
    executionAuthorizationId: null,
    sourceTransactionHash: null,
    destinationTransactionHash: null,
    refundTransactionHash: null,
    status: "ManualReview",
    executionState: null,
    idempotencyKey: null,
    createdAt: null,
    updatedAt: null,
    failureReason: null,
    refundAmount: null,
    retryInformation: {
      available: false,
      reason: "Manual review state cannot be changed by this frontend.",
    },
    settlementVerification: {
      verified: false,
      evidenceSource: null,
      verifiedOutputAmount: null,
    },
    activity: [],
    dataSource: "illustrative",
  },
];

export function assertDemoPayoutAccounting(): void {
  for (const payout of demoPayouts) {
    const campaign = getDemoCampaign(payout.campaignId);
    const recipient = getRecipientById(payout.recipientId);
    const inputAmount = parseTokenAmount(payout.inputAmount);
    const reservedAmount = parseTokenAmount(payout.reservedAmount);

    if (!campaign || !recipient || inputAmount === null || reservedAmount === null) {
      throw new Error(`Demo payout ${payout.id} references invalid data.`);
    }
    if (
      payout.sourceNetwork !== campaign.sourceNetwork ||
      payout.sourceToken !== campaign.acceptedToken ||
      payout.destinationNetwork !== recipient.destinationNetwork ||
      payout.destinationToken !== recipient.preferredToken
    ) {
      throw new Error(`Demo payout ${payout.id} has mismatched campaign or recipient assets.`);
    }
    if (reservedAmount > inputAmount) {
      throw new Error(`Demo payout ${payout.id} reserves more than its source input.`);
    }
    if (
      payout.status === "Succeeded" &&
      (!payout.settlementVerification.verified || !payout.actualVerifiedOutputAmount)
    ) {
      throw new Error(`Demo payout ${payout.id} cannot be succeeded without verified output.`);
    }
  }

  for (const campaign of demoCampaigns) {
    const sampleReservations = demoPayouts
      .filter((payout) => payout.campaignId === campaign.id)
      .reduce((total, payout) => total + (parseTokenAmount(payout.reservedAmount) ?? BigInt(0)), BigInt(0));
    const campaignReservations = wholeTokensToBaseUnits(campaign.accounting.reserved);
    if (sampleReservations !== campaignReservations) {
      throw new Error(`Demo payouts for campaign ${campaign.id} do not match its illustrative reserved balance.`);
    }
  }
}

assertDemoPayoutAccounting();

export function getDemoPayout(payoutId: string): Payout | undefined {
  return demoPayouts.find((payout) => payout.id === payoutId);
}

export function getPayoutCampaign(payout: Payout): Campaign | undefined {
  return getDemoCampaign(payout.campaignId);
}

export function getPayoutRecipient(payout: Payout): Recipient | undefined {
  return getRecipientById(payout.recipientId);
}

export function parseTokenAmount(value: string, decimals = 6): bigint | null {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return null;

  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;

  const scale = BigInt(10) ** BigInt(decimals);
  const fractionalUnits = fraction.padEnd(decimals, "0");
  return BigInt(match[1]) * scale + BigInt(fractionalUnits || "0");
}

export function wholeTokensToBaseUnits(value: number, decimals = 6): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Campaign demo balance must be a non-negative safe integer.");
  }
  return BigInt(value) * BigInt(10) ** BigInt(decimals);
}

export function formatTokenAmount(value: string | bigint, decimals = 6): string {
  const units = typeof value === "bigint" ? value : parseTokenAmount(value, decimals);
  if (units === null) return "Not available";

  const scale = BigInt(10) ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const wholeFormatted = whole.toLocaleString("en-US");
  return fraction ? `${wholeFormatted}.${fraction}` : wholeFormatted;
}

export function formatPayoutDate(date: string | null): string {
  if (!date) return "Not recorded";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function payoutReservedAmount(payouts: readonly Payout[] = demoPayouts): bigint {
  return payouts.reduce((total, payout) => {
    const amount = parseTokenAmount(payout.reservedAmount);
    if (amount === null) {
      throw new Error(`Payout ${payout.id} has an invalid reserved amount.`);
    }
    return total + amount;
  }, BigInt(0));
}

export function getPayoutDisplayStatus(status: ContractPayoutStatus): string {
  return payoutStatusLabels[status];
}
