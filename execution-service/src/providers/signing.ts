import { createHash } from "node:crypto";

export interface SpendingLimit {
  readonly maxInputAtomicAmount: string;
  readonly allowedSourceTokens: readonly string[];
  readonly allowedDestinationNetworks: readonly string[];
  readonly allowedDestinationTokens: readonly string[];
  readonly approvedRecipient?: string;
  readonly approvedRefundAddress?: string;
}

export interface SigningPolicy extends SpendingLimit {
  readonly policyVersion: string;
  readonly requireFreshQuote: boolean;
}

export interface SigningRequest {
  readonly campaignId: string;
  readonly payoutId: string;
  readonly executionAttemptId: string;
  readonly providerId: string;
  readonly quoteReference: string;
  readonly sourceNetworkId: string;
  readonly sourceTokenId: string;
  readonly destinationNetworkId: string;
  readonly destinationTokenId: string;
  readonly recipientAddress: string;
  readonly refundAddress: string;
  readonly maximumInputAtomicAmount: string;
  readonly expectedOutputAtomicAmount: string;
  readonly quoteExpiresAt: string;
}

export interface ExecutionAuthorization {
  readonly authorizationId: string;
  readonly campaignId: string;
  readonly payoutId: string;
  readonly executionAttemptId: string;
  readonly policyVersion: string;
  readonly providerId: string;
  readonly quoteReference: string;
  readonly sourceNetworkId: string;
  readonly sourceTokenId: string;
  readonly destinationNetworkId: string;
  readonly destinationTokenId: string;
  readonly recipientAddress: string;
  readonly refundAddress: string;
  readonly maximumInputAtomicAmount: string;
  readonly expectedOutputAtomicAmount: string;
  readonly quoteExpiresAt: string;
  readonly authorizedAt: string;
  readonly authorizationHash: string;
}

export interface SigningDecision {
  readonly approved: boolean;
  readonly reason: string | null;
  readonly authorization: ExecutionAuthorization | null;
}

export interface SignerAuditRecord {
  readonly authorizationId: string | null;
  readonly approved: boolean;
  readonly reason: string | null;
  readonly recordedAt: string;
}

export interface Signer {
  sign(request: SigningRequest, policy: SigningPolicy): Promise<SigningDecision>;
}

export class DeterministicMockSigner implements Signer {
  readonly auditLog: SignerAuditRecord[] = [];

  async sign(
    request: SigningRequest,
    policy: SigningPolicy,
  ): Promise<SigningDecision> {
    const decision = authorizeExecution(request, policy, Date.now());
    this.auditLog.push({
      authorizationId: decision.authorization?.authorizationId ?? null,
      approved: decision.approved,
      reason: decision.reason,
      recordedAt: new Date().toISOString(),
    });
    return decision;
  }
}

export function authorizeExecution(
  request: SigningRequest,
  policy: SigningPolicy,
  nowMs = Date.now(),
): SigningDecision {
  const errors: string[] = [];

  for (const value of [
    request.campaignId,
    request.payoutId,
    request.executionAttemptId,
    request.providerId,
    request.quoteReference,
    request.sourceNetworkId,
    request.sourceTokenId,
    request.destinationNetworkId,
    request.destinationTokenId,
    request.recipientAddress,
    request.refundAddress,
    request.maximumInputAtomicAmount,
    request.expectedOutputAtomicAmount,
    request.quoteExpiresAt,
  ]) {
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push("Signing request contains incomplete required data");
      break;
    }
  }

  if (!isUnsignedAtomicInteger(request.maximumInputAtomicAmount)) {
    errors.push("maximumInputAtomicAmount must be a positive integer string");
  }
  if (!isUnsignedAtomicInteger(request.expectedOutputAtomicAmount)) {
    errors.push("expectedOutputAtomicAmount must be a positive integer string");
  }
  if (!isWithinPolicyLimit(request.maximumInputAtomicAmount, policy.maxInputAtomicAmount)) {
    errors.push("Requested input exceeds the configured maximum spending limit");
  }
  if (!policy.allowedSourceTokens.includes(request.sourceTokenId)) {
    errors.push("Source token is not in the configured allowlist");
  }
  if (!policy.allowedDestinationNetworks.includes(request.destinationNetworkId)) {
    errors.push("Destination network is not allowed");
  }
  if (!policy.allowedDestinationTokens.includes(request.destinationTokenId)) {
    errors.push("Destination token is not allowed");
  }
  if (
    policy.approvedRecipient !== undefined &&
    request.recipientAddress !== policy.approvedRecipient
  ) {
    errors.push("Recipient differs from the approved payout recipient");
  }
  if (
    policy.approvedRefundAddress !== undefined &&
    request.refundAddress !== policy.approvedRefundAddress
  ) {
    errors.push("Refund address differs from the approved payout policy");
  }

  const quoteExpiresAtMs = Date.parse(request.quoteExpiresAt);
  if (!Number.isFinite(quoteExpiresAtMs) || quoteExpiresAtMs <= nowMs) {
    errors.push("Quote has expired or has no valid future expiry");
  }

  if (errors.length > 0) {
    return {
      approved: false,
      reason: errors[0] ?? "Request rejected by policy",
      authorization: null,
    };
  }

  const authorization = createExecutionAuthorization(request, policy, nowMs);
  return {
    approved: true,
    reason: null,
    authorization,
  };
}

export function createExecutionAuthorization(
  request: SigningRequest,
  policy: SigningPolicy,
  nowMs = Date.now(),
): ExecutionAuthorization {
  const authorizedAt = new Date(nowMs).toISOString();
  const authorizationId = `auth:${request.campaignId}:${request.payoutId}:${request.executionAttemptId}`;
  const authorization: ExecutionAuthorization = {
    authorizationId,
    campaignId: request.campaignId,
    payoutId: request.payoutId,
    executionAttemptId: request.executionAttemptId,
    policyVersion: policy.policyVersion,
    providerId: request.providerId,
    quoteReference: request.quoteReference,
    sourceNetworkId: request.sourceNetworkId,
    sourceTokenId: request.sourceTokenId,
    destinationNetworkId: request.destinationNetworkId,
    destinationTokenId: request.destinationTokenId,
    recipientAddress: request.recipientAddress,
    refundAddress: request.refundAddress,
    maximumInputAtomicAmount: request.maximumInputAtomicAmount,
    expectedOutputAtomicAmount: request.expectedOutputAtomicAmount,
    quoteExpiresAt: request.quoteExpiresAt,
    authorizedAt,
    authorizationHash: "",
  };

  return {
    ...authorization,
    authorizationHash: hashExecutionAuthorization(authorization),
  };
}

export function hashExecutionAuthorization(
  authorization: ExecutionAuthorization,
): string {
  const payload = JSON.stringify({
    authorizationId: authorization.authorizationId,
    campaignId: authorization.campaignId,
    payoutId: authorization.payoutId,
    executionAttemptId: authorization.executionAttemptId,
    policyVersion: authorization.policyVersion,
    providerId: authorization.providerId,
    quoteReference: authorization.quoteReference,
    sourceNetworkId: authorization.sourceNetworkId,
    sourceTokenId: authorization.sourceTokenId,
    destinationNetworkId: authorization.destinationNetworkId,
    destinationTokenId: authorization.destinationTokenId,
    recipientAddress: authorization.recipientAddress,
    refundAddress: authorization.refundAddress,
    maximumInputAtomicAmount: authorization.maximumInputAtomicAmount,
    expectedOutputAtomicAmount: authorization.expectedOutputAtomicAmount,
    quoteExpiresAt: authorization.quoteExpiresAt,
    authorizedAt: authorization.authorizedAt,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function isExecutionAuthorizationExpired(
  authorization: ExecutionAuthorization,
  nowMs = Date.now(),
): boolean {
  return Date.parse(authorization.quoteExpiresAt) <= nowMs;
}

export function isSameExecutionAuthorization(
  left: ExecutionAuthorization,
  right: ExecutionAuthorization,
): boolean {
  return left.authorizationHash === right.authorizationHash;
}

function isUnsignedAtomicInteger(value: string): boolean {
  return /^[0-9]+$/.test(value) && value !== "0" && BigInt(value) > 0n;
}

function isWithinPolicyLimit(
  requested: string,
  policyLimit: string,
): boolean {
  return BigInt(requested) <= BigInt(policyLimit);
}
