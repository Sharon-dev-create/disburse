import type { TokenAmount } from "../domain/payout.ts";

/** Quote requests are independent of execution job state and have no spend capability. */
export interface QuoteIntent {
  readonly sourceNetworkId: string;
  readonly input: TokenAmount;
  readonly destinationNetworkId: string;
  readonly recipientAddress: string;
  readonly expectedOutput: TokenAmount;
  /** Required by 1Click even for a dry quote; supplied by a future explicit refund policy. */
  readonly refundAddress: string;
  /** Required by the published request schema; caller supplies policy, adapter does not invent one. */
  readonly deadline: string;
}

export interface QuoteFee {
  readonly kind: "origin-refund" | "destination-withdrawal";
  readonly tokenId: string;
  readonly atomicAmount: string;
}

export interface ExecutionOpportunity {
  readonly providerId: string;
  readonly sourceNetworkId: string;
  readonly sourceTokenId: string;
  readonly quotedInputAtomicAmount: string;
  readonly maximumInputAtomicAmount: string | null;
  readonly destinationNetworkId: string;
  readonly destinationTokenId: string;
  readonly recipientAddress: string;
  readonly expectedOutputAtomicAmount: string;
  readonly minimumOutputAtomicAmount: string | null;
  readonly quoteReference: string;
  /** Null when the provider does not return a provider-side expiry for a dry quote. */
  readonly expiresAt: string | null;
  /** Local freshness policy; this is not a provider guarantee or reservation. */
  readonly freshUntil: string;
  readonly fees: readonly QuoteFee[];
  readonly estimatedExecutionSeconds: number | null;
  readonly providerMetadata: Readonly<Record<string, string>>;
}

export interface QuoteProviderAdapter {
  readonly providerId: string;
  quote(intent: QuoteIntent): Promise<ExecutionOpportunity>;
}

export type QuoteLifecycleState =
  | "Requested"
  | "Received"
  | "Validated"
  | "Rejected"
  | "Expired";

const quoteTransitions: Readonly<Record<QuoteLifecycleState, readonly QuoteLifecycleState[]>> = {
  Requested: ["Received", "Rejected"],
  Received: ["Validated", "Rejected", "Expired"],
  Validated: ["Expired"],
  Rejected: [],
  Expired: [],
};

export function canTransitionQuote(
  from: QuoteLifecycleState,
  to: QuoteLifecycleState,
): boolean {
  return quoteTransitions[from].includes(to);
}

export function isFreshQuote(opportunity: ExecutionOpportunity, nowMs: number): boolean {
  const freshUntilMs = Date.parse(opportunity.freshUntil);
  return Number.isFinite(freshUntilMs) && nowMs < freshUntilMs;
}
