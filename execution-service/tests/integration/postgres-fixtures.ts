import { createHash } from "node:crypto";
import type { ExecutionOpportunity } from "../../src/providers/quote.ts";
import {
  createExecutionAuthorization,
  type PayoutReservationSnapshot,
  type SigningPolicy,
  type SigningRequest,
} from "../../src/providers/signing.ts";
import {
  fingerprintRefundPolicy,
  type RefundPolicy,
} from "../../src/providers/refund.ts";

export interface AuthorizationFixture {
  readonly authorization: ReturnType<typeof createExecutionAuthorization>;
  readonly request: SigningRequest;
  readonly policy: SigningPolicy;
  readonly reservation: PayoutReservationSnapshot;
  readonly quote: ExecutionOpportunity;
  readonly refundPolicy: RefundPolicy;
}

export function makeAuthorizationFixture(
  seed: string,
  options: {
    readonly nowMs?: number;
    readonly policyVersion?: string;
    readonly ttlMs?: number;
  } = {},
): AuthorizationFixture {
  const nowMs = options.nowMs ?? Date.now();
  const campaignId = deterministicU64(seed, "campaign");
  const payoutId = deterministicU64(seed, "payout");
  const executionAttemptId = `integration-${seed}`;
  const refundPolicy: RefundPolicy = {
    campaignId,
    payoutId,
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    refundAddress: "treasury.near",
    policyVersion: "refund-v1",
    approvedAt: new Date(nowMs - 1_000).toISOString(),
  };
  const request: SigningRequest = {
    nearNetworkId: "near:mainnet",
    contractId: "disburse.near",
    campaignId,
    payoutId,
    executionAttemptId,
    providerId: "near-intents-1click",
    quoteReference: `quote-${seed}`,
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    destinationNetworkId: "eip155:1",
    destinationTokenId: "token:eth-usdc",
    recipientAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
    refundAddress: refundPolicy.refundAddress,
    refundPolicyFingerprint: fingerprintRefundPolicy(refundPolicy),
    maximumInputAtomicAmount: "4000",
    expectedOutputAtomicAmount: "300",
  };
  const policy: SigningPolicy = {
    policyVersion: options.policyVersion ?? "integration-sign-v1",
    requireFreshQuote: true,
    maxQuoteAgeMs: 3_600_000,
    authorizationTtlMs: options.ttlMs ?? 900_000,
    maxInputAtomicAmount: "5000",
    allowedSourceNetworks: ["near:mainnet"],
    allowedSourceTokens: ["token:near-usdc"],
    allowedDestinationNetworks: ["eip155:1"],
    allowedDestinationTokens: ["token:eth-usdc"],
    approvedRecipient: request.recipientAddress,
    approvedRefundAddress: refundPolicy.refundAddress,
    approvedRefundPolicyFingerprint: fingerprintRefundPolicy(refundPolicy),
  };
  const reservation: PayoutReservationSnapshot = {
    networkId: request.nearNetworkId,
    contractId: request.contractId,
    observedAtBlock: "1234",
    campaignId,
    payoutId,
    status: "Reserved",
    inputTokenId: request.sourceTokenId,
    inputAtomicAmount: "4000",
    campaignReservedAtomicAmount: "4000",
    expectedOutputTokenId: request.destinationTokenId,
    expectedOutputAtomicAmount: request.expectedOutputAtomicAmount,
    destinationNetworkId: request.destinationNetworkId,
    recipientAddress: request.recipientAddress,
  };
  const quote: ExecutionOpportunity = {
    providerId: request.providerId,
    sourceNetworkId: request.sourceNetworkId,
    sourceTokenId: request.sourceTokenId,
    quotedInputAtomicAmount: "4000",
    maximumInputAtomicAmount: null,
    destinationNetworkId: request.destinationNetworkId,
    destinationTokenId: request.destinationTokenId,
    recipientAddress: request.recipientAddress,
    expectedOutputAtomicAmount: request.expectedOutputAtomicAmount,
    minimumOutputAtomicAmount: request.expectedOutputAtomicAmount,
    quoteReference: request.quoteReference,
    expiresAt: new Date(nowMs + 3_600_000).toISOString(),
    freshUntil: new Date(nowMs + 1_800_000).toISOString(),
    fees: [],
    estimatedExecutionSeconds: 60,
    providerMetadata: {
      responseTimestamp: new Date(nowMs - 1_000).toISOString(),
      executionAttemptId,
    },
  };
  return {
    authorization: createExecutionAuthorization(
      request,
      policy,
      reservation,
      quote,
      nowMs,
    ),
    request,
    policy,
    reservation,
    quote,
    refundPolicy,
  };
}

export function deterministicU64(seed: string, label: string): string {
  const bytes = createHash("sha256").update(`${seed}:${label}`).digest();
  return BigInt.asUintN(64, bytes.readBigUInt64BE(0)).toString();
}
