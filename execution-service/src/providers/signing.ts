import { createHash } from "node:crypto";
import { validateRecipient } from "./recipient.ts";
import type { ExecutionOpportunity } from "./quote.ts";
import { getSupportedNetwork } from "./networks.ts";

export interface SpendingLimit {
  readonly maxInputAtomicAmount: string;
  readonly allowedSourceNetworks: readonly string[];
  readonly allowedSourceTokens: readonly string[];
  readonly allowedDestinationNetworks: readonly string[];
  readonly allowedDestinationTokens: readonly string[];
  readonly approvedRecipient: string;
  readonly approvedRefundAddress: string;
  readonly approvedRefundPolicyFingerprint: string;
}

export interface SigningPolicy extends SpendingLimit {
  readonly policyVersion: string;
  readonly requireFreshQuote: boolean;
  /** Required and positive if freshness is enabled; must be null if disabled. */
  readonly maxQuoteAgeMs: number | null;
  /** Independent lifetime for authorization records. */
  readonly authorizationTtlMs: number;
}

export interface PayoutReservationSnapshot {
  readonly networkId: string;
  readonly contractId: string;
  readonly observedAtBlock: string;
  readonly campaignId: string;
  readonly payoutId: string;
  readonly status: string;
  readonly inputTokenId: string;
  readonly inputAtomicAmount: string;
  readonly campaignReservedAtomicAmount: string;
  readonly expectedOutputTokenId: string;
  readonly expectedOutputAtomicAmount: string;
  readonly destinationNetworkId: string;
  readonly recipientAddress: string;
}

export interface SigningRequest {
  readonly nearNetworkId: string;
  readonly contractId: string;
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
  readonly refundPolicyFingerprint: string;
  readonly maximumInputAtomicAmount: string;
  readonly expectedOutputAtomicAmount: string;
}

export type AuthorizationLifecycle =
  "Created" | "Approved" | "Consumed" | "Expired" | "Revoked";

export interface ExecutionAuthorization extends SigningRequest {
  readonly authorizationId: string;
  readonly policyVersion: string;
  readonly policyFingerprint: string;
  readonly reservationIdentity: string;
  readonly reservationObservedAtBlock: string;
  readonly quoteIssuedAt: string;
  readonly quoteExpiresAt: string;
  readonly quoteRequiredInputAtomicAmount: string;
  readonly authorizedAt: string;
  readonly authorizationExpiresAt: string;
  readonly authorizationHash: string;
  readonly lifecycle: AuthorizationLifecycle;
}

export interface AuthorizationLifecycleTimestamps {
  readonly approvedAt: string | null;
  readonly consumedAt: string | null;
  readonly revokedAt: string | null;
  readonly expiredAt: string | null;
}

export interface StoredExecutionAuthorization
  extends ExecutionAuthorization,
    AuthorizationLifecycleTimestamps {}

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
  authorize(
    request: SigningRequest,
    policy: SigningPolicy,
    reservation: PayoutReservationSnapshot,
    quote: ExecutionOpportunity,
    nowMs?: number,
  ): Promise<SigningDecision>;
}

export interface AuthorizationRepository {
  create(
    authorization: ExecutionAuthorization,
  ): Promise<StoredExecutionAuthorization>;
  get(authorizationId: string): Promise<StoredExecutionAuthorization | null>;
  getByCampaignPayoutAttempt(
    campaignId: string,
    payoutId: string,
    executionAttemptId: string,
  ): Promise<StoredExecutionAuthorization | null>;
  approve(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization>;
  consume(
    authorizationId: string,
    request: SigningRequest,
    policy: SigningPolicy,
    reservation: PayoutReservationSnapshot,
    quote: ExecutionOpportunity,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization>;
  revoke(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization>;
  expire(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization>;
}

export interface AuthorizationMemoryState {
  readonly records: Map<string, StoredExecutionAuthorization>;
}

export function newAuthorizationMemoryState(): AuthorizationMemoryState {
  return { records: new Map() };
}

/** Test-only process-memory repository. It is not durable or multi-process safe. */
export class InMemoryAuthorizationRepository implements AuthorizationRepository {
  private readonly state: AuthorizationMemoryState;

  constructor(state: AuthorizationMemoryState = newAuthorizationMemoryState()) {
    this.state = state;
  }

  async create(
    authorization: ExecutionAuthorization,
  ): Promise<StoredExecutionAuthorization> {
    verifyAuthorizationHash(authorization);
    if (authorization.lifecycle !== "Created")
      throw new Error("Only Created authorizations can be persisted");
    const existing = this.state.records.get(authorization.authorizationId);
    if (existing) {
      if (existing.authorizationHash !== authorization.authorizationHash) {
        throw new Error(
          "Authorization ID already exists with different protected fields",
        );
      }
      return cloneAuthorization(existing);
    }
    const stored = Object.freeze({
      ...authorization,
      approvedAt: null,
      consumedAt: null,
      revokedAt: null,
      expiredAt: null,
    });
    this.state.records.set(
      authorization.authorizationId,
      stored,
    );
    return cloneAuthorization(stored);
  }

  async get(
    authorizationId: string,
  ): Promise<StoredExecutionAuthorization | null> {
    const authorization = this.state.records.get(authorizationId);
    return authorization ? cloneAuthorization(authorization) : null;
  }

  async getByCampaignPayoutAttempt(
    campaignId: string,
    payoutId: string,
    executionAttemptId: string,
  ): Promise<StoredExecutionAuthorization | null> {
    const authorization = [...this.state.records.values()].find(
      (item) =>
        item.campaignId === campaignId &&
        item.payoutId === payoutId &&
        item.executionAttemptId === executionAttemptId,
    );
    return authorization ? cloneAuthorization(authorization) : null;
  }

  async approve(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization> {
    const current = this.state.records.get(authorizationId);
    if (!current) throw new Error("Authorization does not exist");
    if (current.lifecycle === "Approved") return cloneAuthorization(current);
    if (current.lifecycle === "Expired" || current.lifecycle === "Revoked")
      throw new Error(`Authorization is ${current.lifecycle} and cannot be approved`);
    if (current.lifecycle !== "Created")
      throw new Error(`Authorization is ${current.lifecycle} and cannot be approved`);
    if (nowMs >= Date.parse(current.authorizationExpiresAt)) {
      const expired = Object.freeze({
        ...current,
        lifecycle: "Expired" as const,
        expiredAt: new Date(nowMs).toISOString(),
      });
      this.state.records.set(authorizationId, expired);
      throw new Error("Authorization has expired");
    }
    const approved = Object.freeze({
      ...current,
      lifecycle: "Approved" as const,
      approvedAt: new Date(nowMs).toISOString(),
    });
    this.state.records.set(authorizationId, approved);
    return cloneAuthorization(approved);
  }

  async consume(
    authorizationId: string,
    request: SigningRequest,
    policy: SigningPolicy,
    reservation: PayoutReservationSnapshot,
    quote: ExecutionOpportunity,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization> {
    const current = this.state.records.get(authorizationId);
    if (!current) throw new Error("Authorization does not exist");
    if (current.lifecycle !== "Approved")
      throw new Error(
        `Authorization is ${current.lifecycle} and cannot be consumed`,
      );
    verifyExecutionAuthorization(
      current,
      request,
      policy,
      reservation,
      quote,
      nowMs,
    );
    const consumed = Object.freeze({
      ...current,
      lifecycle: "Consumed" as const,
      consumedAt: new Date(nowMs).toISOString(),
    });
    // Synchronous map mutation before returning makes this mock atomic only within this JS process.
    this.state.records.set(authorizationId, consumed);
    return cloneAuthorization(consumed);
  }

  async revoke(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization> {
    const current = this.state.records.get(authorizationId);
    if (!current) throw new Error("Authorization does not exist");
    if (current.lifecycle === "Revoked") return cloneAuthorization(current);
    if (current.lifecycle !== "Created" && current.lifecycle !== "Approved")
      throw new Error(
        `Authorization is ${current.lifecycle} and cannot be revoked`,
      );
    if (nowMs >= Date.parse(current.authorizationExpiresAt))
      return this.expire(authorizationId, nowMs);
    const revoked = Object.freeze({
      ...current,
      lifecycle: "Revoked" as const,
      revokedAt: new Date(nowMs).toISOString(),
    });
    this.state.records.set(
      authorizationId,
      revoked,
    );
    return cloneAuthorization(revoked);
  }

  async expire(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization> {
    const current = this.state.records.get(authorizationId);
    if (!current) throw new Error("Authorization does not exist");
    if (current.lifecycle === "Expired") return cloneAuthorization(current);
    if (current.lifecycle !== "Created" && current.lifecycle !== "Approved")
      throw new Error(
        `Authorization is ${current.lifecycle} and cannot expire`,
      );
    if (nowMs < Date.parse(current.authorizationExpiresAt))
      throw new Error("Authorization has not expired");
    const expired = Object.freeze({
      ...current,
      lifecycle: "Expired" as const,
      expiredAt: new Date(nowMs).toISOString(),
    });
    this.state.records.set(authorizationId, expired);
    return cloneAuthorization(expired);
  }
}

export class DeterministicMockSigner implements Signer {
  readonly auditLog: SignerAuditRecord[] = [];

  async authorize(
    request: SigningRequest,
    policy: SigningPolicy,
    reservation: PayoutReservationSnapshot,
    quote: ExecutionOpportunity,
    nowMs = Date.now(),
  ): Promise<SigningDecision> {
    const decision = authorizeExecution(
      request,
      policy,
      reservation,
      quote,
      nowMs,
    );
    this.auditLog.push({
      authorizationId: decision.authorization?.authorizationId ?? null,
      approved: decision.approved,
      reason: decision.reason,
      recordedAt: new Date(nowMs).toISOString(),
    });
    return decision;
  }
}

export function authorizeExecution(
  request: SigningRequest,
  policy: SigningPolicy,
  reservation: PayoutReservationSnapshot,
  quote: ExecutionOpportunity,
  nowMs = Date.now(),
): SigningDecision {
  try {
    validateAuthorizationInputs(request, policy, reservation, quote, nowMs);
    const created = createExecutionAuthorization(
      request,
      policy,
      reservation,
      quote,
      nowMs,
    );
    return {
      approved: true,
      reason: null,
      authorization: approveExecutionAuthorization(created),
    };
  } catch (error) {
    return {
      approved: false,
      reason: error instanceof Error ? error.message : "Authorization rejected",
      authorization: null,
    };
  }
}

export function createExecutionAuthorization(
  request: SigningRequest,
  policy: SigningPolicy,
  reservation: PayoutReservationSnapshot,
  quote: ExecutionOpportunity,
  nowMs = Date.now(),
): ExecutionAuthorization {
  validateAuthorizationInputs(request, policy, reservation, quote, nowMs);
  const authorizationId = `auth:${request.campaignId}:${request.payoutId}:${request.executionAttemptId}`;
  const unsigned: ExecutionAuthorization = {
    ...request,
    authorizationId,
    policyVersion: policy.policyVersion,
    policyFingerprint: fingerprintSigningPolicy(policy),
    reservationIdentity: reservationIdentity(reservation),
    reservationObservedAtBlock: reservation.observedAtBlock,
    quoteIssuedAt: quote.providerMetadata.responseTimestamp ?? "",
    quoteExpiresAt: quote.expiresAt ?? "",
    quoteRequiredInputAtomicAmount: quote.quotedInputAtomicAmount,
    authorizedAt: new Date(nowMs).toISOString(),
    authorizationExpiresAt: authorizationExpiry(policy, quote, nowMs),
    authorizationHash: "",
    lifecycle: "Created",
  };
  return Object.freeze({
    ...unsigned,
    authorizationHash: hashExecutionAuthorization(unsigned),
  });
}

export function approveExecutionAuthorization(
  authorization: ExecutionAuthorization,
): ExecutionAuthorization {
  verifyAuthorizationHash(authorization);
  if (authorization.lifecycle !== "Created")
    throw new Error("Only Created authorization can be approved");
  return Object.freeze({ ...authorization, lifecycle: "Approved" });
}

export function fingerprintSigningPolicy(policy: SigningPolicy): string {
  const canonical = JSON.stringify([
    "disburse-signing-policy-v1",
    policy.policyVersion,
    canonicalAtomic(policy.maxInputAtomicAmount),
    [...policy.allowedSourceNetworks].sort(),
    [...policy.allowedSourceTokens].sort(),
    [...policy.allowedDestinationNetworks].sort(),
    [...policy.allowedDestinationTokens].sort(),
    policy.approvedRecipient,
    policy.approvedRefundAddress,
    policy.approvedRefundPolicyFingerprint,
    policy.requireFreshQuote,
    policy.maxQuoteAgeMs,
    policy.authorizationTtlMs,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function hashExecutionAuthorization(
  authorization: ExecutionAuthorization,
): string {
  const payload = JSON.stringify(authorization, (key, value: unknown) =>
    key === "authorizationHash" ||
    key === "lifecycle" ||
    key === "approvedAt" ||
    key === "consumedAt" ||
    key === "revokedAt" ||
    key === "expiredAt"
      ? undefined
      : value,
  );
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function verifyAuthorizationHash(
  authorization: ExecutionAuthorization,
): void {
  if (
    !/^[a-f0-9]{64}$/.test(authorization.authorizationHash) ||
    hashExecutionAuthorization(authorization) !==
      authorization.authorizationHash
  ) {
    throw new Error("Authorization integrity hash mismatch");
  }
}

export function verifyExecutionAuthorization(
  authorization: ExecutionAuthorization,
  request: SigningRequest,
  policy: SigningPolicy,
  reservation: PayoutReservationSnapshot,
  quote: ExecutionOpportunity,
  nowMs: number,
): void {
  verifyAuthorizationHash(authorization);
  if (authorization.policyFingerprint !== fingerprintSigningPolicy(policy)) {
    throw new Error("Signing policy fingerprint changed");
  }
  validateAuthorizationInputs(request, policy, reservation, quote, nowMs);
  if (authorization.lifecycle !== "Approved")
    throw new Error("Authorization is not in Approved state");
  if (nowMs >= Date.parse(authorization.authorizationExpiresAt))
    throw new Error("Authorization has expired");
  const expected = createExecutionAuthorization(
    request,
    policy,
    reservation,
    quote,
    Date.parse(authorization.authorizedAt),
  );
  if (expected.authorizationHash !== authorization.authorizationHash)
    throw new Error(
      "Authorization does not match the current request, quote, policy, or reservation",
    );
  if (
    authorization.authorizationId !==
    `auth:${request.campaignId}:${request.payoutId}:${request.executionAttemptId}`
  )
    throw new Error("Authorization belongs to another execution attempt");
}

export function reservationIdentity(
  reservation: PayoutReservationSnapshot,
): string {
  return JSON.stringify([
    "near-payout-reservation-v1",
    reservation.networkId,
    reservation.contractId,
    reservation.campaignId,
    reservation.payoutId,
    reservation.inputTokenId,
    canonicalAtomic(reservation.inputAtomicAmount),
    reservation.status,
    canonicalAtomic(reservation.campaignReservedAtomicAmount),
    reservation.expectedOutputTokenId,
    canonicalAtomic(reservation.expectedOutputAtomicAmount),
    reservation.destinationNetworkId,
    reservation.recipientAddress,
    reservation.observedAtBlock,
  ]);
}

function authorizationExpiry(
  policy: SigningPolicy,
  quote: ExecutionOpportunity,
  nowMs: number,
): string {
  const policyExpiry = nowMs + policy.authorizationTtlMs;
  if (!Number.isSafeInteger(policyExpiry))
    throw new Error(
      "Authorization expiry exceeds the supported timestamp range",
    );
  if (quote.expiresAt === null) return new Date(policyExpiry).toISOString();
  const quoteExpiry = parseRfc3339(quote.expiresAt);
  if (!Number.isFinite(quoteExpiry) || quoteExpiry <= nowMs)
    throw new Error("Quote expiry is invalid or already elapsed");
  return new Date(Math.min(policyExpiry, quoteExpiry)).toISOString();
}

function validateAuthorizationInputs(
  request: SigningRequest,
  policy: SigningPolicy,
  reservation: PayoutReservationSnapshot,
  quote: ExecutionOpportunity,
  nowMs: number,
): void {
  validatePolicy(policy);
  for (const value of Object.values(request)) {
    if (typeof value !== "string" || value.trim().length === 0)
      throw new Error("Signing request contains incomplete required data");
  }
  if (
    !/^(0|[1-9][0-9]*)$/.test(request.campaignId) ||
    !/^(0|[1-9][0-9]*)$/.test(request.payoutId)
  )
    throw new Error(
      "Campaign and payout IDs must be canonical decimal strings",
    );
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(request.executionAttemptId))
    throw new Error("Execution attempt ID is invalid");
  if (
    request.providerId !== quote.providerId ||
    request.quoteReference !== quote.quoteReference
  )
    throw new Error("Quote provider or quote identity mismatch");
  if (quote.providerMetadata.executionAttemptId !== request.executionAttemptId)
    throw new Error(
      "Quote is not associated with the current execution attempt",
    );
  if (
    request.sourceNetworkId !== quote.sourceNetworkId ||
    request.sourceTokenId !== quote.sourceTokenId ||
    request.destinationNetworkId !== quote.destinationNetworkId ||
    request.destinationTokenId !== quote.destinationTokenId ||
    request.recipientAddress !== quote.recipientAddress ||
    request.expectedOutputAtomicAmount !== quote.expectedOutputAtomicAmount
  )
    throw new Error("Quote route or output does not match signing request");
  const sourceNetwork = getSupportedNetwork(request.sourceNetworkId);
  const destinationNetwork = getSupportedNetwork(request.destinationNetworkId);
  if (!sourceNetwork || !destinationNetwork)
    throw new Error("Source or destination network is unsupported");
  if (!policy.allowedSourceNetworks.includes(request.sourceNetworkId))
    throw new Error("Source network is not allowed");
  if (!policy.allowedSourceTokens.includes(request.sourceTokenId))
    throw new Error("Source token is not allowed");
  if (!policy.allowedDestinationNetworks.includes(request.destinationNetworkId))
    throw new Error("Destination network is not allowed");
  if (!policy.allowedDestinationTokens.includes(request.destinationTokenId))
    throw new Error("Destination token is not allowed");
  if (
    request.refundPolicyFingerprint !== policy.approvedRefundPolicyFingerprint
  )
    throw new Error(
      "Refund policy fingerprint differs from the approved payout policy",
    );
  assertRecipientMatches(
    request.destinationNetworkId,
    request.recipientAddress,
    policy.approvedRecipient,
    "Recipient",
  );
  assertRecipientMatches(
    request.sourceNetworkId,
    request.refundAddress,
    policy.approvedRefundAddress,
    "Refund address",
  );
  const inputCap = canonicalAtomic(request.maximumInputAtomicAmount);
  const reservationInput = canonicalAtomic(reservation.inputAtomicAmount);
  const quoteRequiredInput = canonicalAtomic(quote.quotedInputAtomicAmount);
  const quoteOutput = canonicalAtomic(quote.expectedOutputAtomicAmount);
  const requestOutput = canonicalAtomic(request.expectedOutputAtomicAmount);
  const policyMax = canonicalAtomic(policy.maxInputAtomicAmount);
  if (BigInt(inputCap) > BigInt(policyMax))
    throw new Error("Authorized input cap exceeds policy maximum");
  if (BigInt(inputCap) > BigInt(reservationInput))
    throw new Error("Authorized input cap exceeds payout reservation");
  if (BigInt(quoteRequiredInput) > BigInt(inputCap))
    throw new Error("Quote-required input exceeds approved input cap");
  if (BigInt(quoteRequiredInput) > BigInt(reservationInput))
    throw new Error("Quote-required input exceeds payout reservation");
  if (BigInt(inputCap) === 0n || BigInt(quoteRequiredInput) === 0n)
    throw new Error("Payout input and quote-required input must be positive");
  if (
    quoteOutput !== requestOutput ||
    quoteOutput !== canonicalAtomic(reservation.expectedOutputAtomicAmount) ||
    quote.destinationTokenId !== reservation.expectedOutputTokenId
  )
    throw new Error("Exact output differs from payout authorization");
  if (
    quote.minimumOutputAtomicAmount === null ||
    BigInt(canonicalAtomic(quote.minimumOutputAtomicAmount)) <
      BigInt(quoteOutput)
  )
    throw new Error("Quote minimum output is below the exact payout amount");
  assertReservationMatches(request, reservation);
  if (policy.requireFreshQuote) validateQuoteFreshness(policy, quote, nowMs);
  else if (policy.maxQuoteAgeMs !== null)
    throw new Error(
      "When quote freshness is disabled, maxQuoteAgeMs must be null and this must be an explicit approved policy choice",
    );
}

function validatePolicy(policy: SigningPolicy): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(policy.policyVersion))
    throw new Error("Policy version is invalid");
  canonicalAtomic(policy.maxInputAtomicAmount);
  if (
    !Array.isArray(policy.allowedSourceNetworks) ||
    policy.allowedSourceNetworks.length === 0
  )
    throw new Error("Allowed source networks are required");
  for (const network of [
    ...policy.allowedSourceNetworks,
    ...policy.allowedDestinationNetworks,
  ])
    if (!getSupportedNetwork(network))
      throw new Error(`Policy contains unsupported network ${network}`);
  for (const list of [
    policy.allowedSourceNetworks,
    policy.allowedSourceTokens,
    policy.allowedDestinationNetworks,
    policy.allowedDestinationTokens,
  ])
    if (new Set(list).size !== list.length)
      throw new Error("Policy allowlists must not contain duplicates");
  if (
    !policy.allowedSourceTokens.length ||
    !policy.allowedDestinationNetworks.length ||
    !policy.allowedDestinationTokens.length
  )
    throw new Error(
      "All policy asset and network allowlists must be non-empty",
    );
  if (
    !Number.isSafeInteger(policy.authorizationTtlMs) ||
    policy.authorizationTtlMs <= 0
  )
    throw new Error("Authorization TTL must be a positive safe integer");
  if (
    policy.requireFreshQuote &&
    (!Number.isInteger(policy.maxQuoteAgeMs) ||
      policy.maxQuoteAgeMs === null ||
      policy.maxQuoteAgeMs <= 0)
  )
    throw new Error("Fresh quote policy requires a positive maxQuoteAgeMs");
  if (!policy.requireFreshQuote && policy.maxQuoteAgeMs !== null)
    throw new Error(
      "Disabled quote freshness must be explicitly represented by maxQuoteAgeMs:null",
    );
  if (
    typeof policy.approvedRecipient !== "string" ||
    typeof policy.approvedRefundAddress !== "string"
  )
    throw new Error("Approved recipient and refund address are required");
  if (!/^[a-f0-9]{64}$/.test(policy.approvedRefundPolicyFingerprint))
    throw new Error("Approved refund policy fingerprint is required");
}

function validateQuoteFreshness(
  policy: SigningPolicy,
  quote: ExecutionOpportunity,
  nowMs: number,
): void {
  if (!quote.expiresAt || !quote.providerMetadata.responseTimestamp)
    throw new Error("Quote has no provider-issued timestamp or expiry");
  const issuedAt = parseRfc3339(quote.providerMetadata.responseTimestamp);
  const expiresAt = parseRfc3339(quote.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt
  )
    throw new Error("Quote timestamp sequence is invalid");
  if (issuedAt > nowMs || expiresAt <= nowMs)
    throw new Error("Quote is not currently valid");
  if (policy.maxQuoteAgeMs === null || nowMs - issuedAt > policy.maxQuoteAgeMs)
    throw new Error("Quote is older than the configured freshness limit");
  if (
    !Number.isFinite(parseRfc3339(quote.freshUntil)) ||
    parseRfc3339(quote.freshUntil) <= nowMs
  )
    throw new Error("Local quote freshness window has expired");
}

function parseRfc3339(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    return Number.NaN;
  const timestamp = Date.parse(value);
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(timestamp) &&
    Number.isFinite(calendar.getTime()) &&
    calendar.toISOString().slice(0, 10) === value.slice(0, 10)
    ? timestamp
    : Number.NaN;
}

function assertReservationMatches(
  request: SigningRequest,
  reservation: PayoutReservationSnapshot,
): void {
  if (reservation.status !== "Reserved")
    throw new Error("Payout is not in the on-chain Reserved state");
  if (
    reservation.campaignId !== request.campaignId ||
    reservation.payoutId !== request.payoutId
  )
    throw new Error("Reservation belongs to another campaign or payout");
  if (
    !/^(0|[1-9][0-9]*)$/.test(reservation.observedAtBlock) ||
    !reservation.contractId.trim()
  )
    throw new Error("Reservation observation identity is invalid");
  if (
    reservation.networkId !== request.nearNetworkId ||
    reservation.contractId !== request.contractId
  )
    throw new Error(
      "Reservation was observed from another NEAR contract or network",
    );
  if (
    !getSupportedNetwork(request.nearNetworkId) ||
    getSupportedNetwork(request.nearNetworkId)?.kind !== "near"
  )
    throw new Error("Reservation NEAR network is unsupported");
  if (
    reservation.networkId !== request.sourceNetworkId ||
    reservation.inputTokenId !== request.sourceTokenId ||
    reservation.expectedOutputTokenId !== request.destinationTokenId ||
    canonicalAtomic(reservation.expectedOutputAtomicAmount) !==
      canonicalAtomic(request.expectedOutputAtomicAmount) ||
    reservation.destinationNetworkId !== request.destinationNetworkId
  )
    throw new Error(
      "Reservation assets or destination differ from the request",
    );
  const recipient = validateRecipient(
    reservation.destinationNetworkId,
    reservation.recipientAddress,
  );
  const requested = validateRecipient(
    request.destinationNetworkId,
    request.recipientAddress,
  );
  if (
    !recipient.valid ||
    !requested.valid ||
    recipient.normalizedAddress !== requested.normalizedAddress
  )
    throw new Error("Reservation recipient differs from the request");
  canonicalAtomic(reservation.campaignReservedAtomicAmount);
  if (
    BigInt(reservation.campaignReservedAtomicAmount) <
    BigInt(reservation.inputAtomicAmount)
  )
    throw new Error(
      "Campaign on-chain reserved accounting is insufficient for this payout",
    );
}

function assertRecipientMatches(
  networkId: string,
  requested: string,
  approved: string,
  label: string,
): void {
  const validated = validateRecipient(networkId, requested);
  const policy = validateRecipient(networkId, approved);
  if (
    !validated.valid ||
    !policy.valid ||
    validated.normalizedAddress !== policy.normalizedAddress
  )
    throw new Error(`${label} is invalid or differs from policy`);
}

function canonicalAtomic(value: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error(
      "Atomic amount must be a canonical non-negative integer string",
    );
  const parsed = BigInt(value);
  if (parsed > (1n << 128n) - 1n) throw new Error("Atomic amount exceeds u128");
  return value;
}

function cloneAuthorization(
  authorization: StoredExecutionAuthorization,
): StoredExecutionAuthorization {
  return Object.freeze({ ...authorization });
}
