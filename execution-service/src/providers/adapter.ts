import type { PayoutSnapshot } from "../domain/payout.ts";

export interface ExecutionRequest {
  readonly payout: PayoutSnapshot;
  readonly executionReference: string;
  readonly idempotencyKey: string;
}

export interface ExecutionQuote {
  readonly providerId: string;
  readonly expectedOutput: PayoutSnapshot["expectedOutput"];
  readonly expiresAt: string;
  readonly quoteReference: string;
}

export interface PreparedExecution {
  readonly providerId: string;
  readonly preparationReference: string;
  readonly opaqueProviderData: string;
}

export interface ProviderExecutionReference {
  readonly providerId: string;
  readonly providerExecutionReference: string;
  readonly destinationChainId: string;
  readonly transactionReference: string | null;
  readonly eventIdentifier: string | null;
}

export type ProviderSubmissionResult =
  | { readonly kind: "accepted"; readonly reference: ProviderExecutionReference }
  | { readonly kind: "definitively-not-accepted"; readonly reasonCode: string }
  | { readonly kind: "unknown"; readonly reasonCode: string };

export type ProviderStatus =
  | { readonly kind: "pending"; readonly reference: ProviderExecutionReference }
  | { readonly kind: "succeeded"; readonly reference: ProviderExecutionReference }
  | { readonly kind: "reverted"; readonly reference: ProviderExecutionReference }
  | { readonly kind: "not-found" }
  | { readonly kind: "unknown"; readonly reasonCode: string };

/** Provider response claims are untrusted until independently verified. */
export interface ProviderEvidenceClaims {
  readonly reference: ProviderExecutionReference;
  readonly destinationChainId: string;
  readonly recipientAddress: string;
  readonly outputTokenId: string;
  readonly outputAtomicAmount: string;
  readonly transactionSucceeded: boolean;
  readonly eventIdentifier: string | null;
  readonly evidenceReference: string;
  readonly contentHash: string;
}

export interface ProviderCapabilities {
  /** Set to supported only after provider-specific guarantees have been established. */
  readonly idempotency: "provider-enforced" | "unsupported" | "unknown";
  readonly lookupByExecutionReference: boolean;
}

/** Provider-neutral boundary. No live provider implementation is included in this milestone. */
export interface ExecutionProviderAdapter {
  readonly providerId: string;
  readonly capabilities: ProviderCapabilities;
  validate(request: ExecutionRequest): Promise<void>;
  quote(request: ExecutionRequest): Promise<ExecutionQuote>;
  prepare(request: ExecutionRequest, quote: ExecutionQuote): Promise<PreparedExecution>;
  submit(
    request: ExecutionRequest,
    prepared: PreparedExecution
  ): Promise<ProviderSubmissionResult>;
  getStatus(executionReference: string): Promise<ProviderStatus>;
  getEvidence(executionReference: string): Promise<ProviderEvidenceClaims>;
}

export type RestartAction = "continue-before-submit" | "reconcile-only" | "manual-review";

/** Never chooses a blind resubmission after an intent may have reached a provider. */
export function restartAction(
  state: "Preparing" | "SubmissionStarted" | "SubmissionUnknown",
  capabilities: ProviderCapabilities
): RestartAction {
  if (state === "Preparing") return "continue-before-submit";
  return capabilities.lookupByExecutionReference ? "reconcile-only" : "manual-review";
}
