export type PayoutId = string;
export type CampaignId = string;
export type AtomicAmount = string;
export type AccountId = string;

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

export interface TokenAmount {
  readonly tokenId: string;
  /** Decimal string; never pass u128 amounts through a JavaScript number. */
  readonly atomicAmount: AtomicAmount;
  readonly decimals: number;
}

export interface PayoutSnapshot {
  readonly payoutId: PayoutId;
  readonly campaignId: CampaignId;
  readonly inputAmount: TokenAmount;
  readonly destinationChainId: string;
  readonly recipientAddress: string;
  readonly expectedOutput: TokenAmount;
  readonly contractStatus: ContractPayoutStatus;
  readonly executionReference: string | null;
  readonly settlementEvidenceReference: string | null;
}

export interface ContractEventIdentity {
  readonly networkId: string;
  readonly contractId: AccountId;
  readonly transactionHash: string;
  readonly blockHash: string;
  readonly receiptId: string;
  readonly eventIndex: number;
  readonly blockHeight: string;
}

export interface PayoutReservedEvent {
  readonly event: "payout_reserved";
  readonly payoutId: PayoutId;
  readonly campaignId: CampaignId;
  readonly contractStatus: "Reserved";
  readonly identity: ContractEventIdentity;
}

export interface ExecutionJobKey {
  readonly networkId: string;
  readonly contractId: AccountId;
  readonly payoutId: PayoutId;
}

export function executionJobKeyString(key: ExecutionJobKey): string {
  return JSON.stringify([key.networkId, key.contractId, key.payoutId]);
}

export function validatePayoutSnapshot(payout: PayoutSnapshot): void {
  if (!/^\d+$/.test(payout.payoutId) || !/^\d+$/.test(payout.campaignId)) {
    throw new Error("Payout and campaign IDs must be decimal strings");
  }
  if (payout.contractStatus !== "Reserved") {
    throw new Error(
      "Only an on-chain Reserved payout can be enqueued for execution",
    );
  }
  for (const amount of [payout.inputAmount, payout.expectedOutput]) {
    if (
      !/^\d+$/.test(amount.atomicAmount) ||
      BigInt(amount.atomicAmount) <= 0n
    ) {
      throw new Error("Payout atomic amounts must be positive decimal strings");
    }
    if (
      !Number.isInteger(amount.decimals) ||
      amount.decimals < 0 ||
      amount.decimals > 255
    ) {
      throw new Error("Token decimals must fit an unsigned byte");
    }
  }
  if (!payout.destinationChainId.trim() || !payout.recipientAddress.trim()) {
    throw new Error("Payout destination chain and recipient are required");
  }
}
