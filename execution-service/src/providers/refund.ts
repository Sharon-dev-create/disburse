import { createHash } from "node:crypto";
import { validateRecipient } from "./recipient.ts";
import { getSupportedNetwork } from "./networks.ts";

export interface RefundPolicy {
  readonly campaignId: string;
  readonly payoutId: string;
  readonly sourceNetworkId: string;
  readonly sourceTokenId: string;
  readonly refundAddress: string;
  readonly policyVersion: string;
  readonly approvedAt: string;
}

export interface ApprovedRefundPolicy extends RefundPolicy {
  readonly fingerprint: string;
}

export interface RefundPolicyValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface RefundPolicyRepository {
  approve(policy: RefundPolicy): Promise<ApprovedRefundPolicy>;
  get(campaignId: string, payoutId: string): Promise<ApprovedRefundPolicy | null>;
}

export interface RefundPolicyMemoryState {
  readonly policies: Map<string, ApprovedRefundPolicy>;
}

export function newRefundPolicyMemoryState(): RefundPolicyMemoryState {
  return { policies: new Map() };
}

/** Deterministic test repository only; it is not durable across process restarts. */
export class InMemoryRefundPolicyRepository implements RefundPolicyRepository {
  private readonly state: RefundPolicyMemoryState;

  constructor(state: RefundPolicyMemoryState = newRefundPolicyMemoryState()) {
    this.state = state;
  }

  async approve(policy: RefundPolicy): Promise<ApprovedRefundPolicy> {
    const validation = validateRefundPolicy(policy);
    if (!validation.valid) throw new Error(`Invalid refund policy: ${validation.errors.join(", ")}`);
    const key = refundPolicyKey(policy.campaignId, policy.payoutId);
    const existing = this.state.policies.get(key);
    const approved = Object.freeze({ ...policy, fingerprint: fingerprintRefundPolicy(policy) });
    if (existing) {
      if (!sameApprovedRefundPolicy(existing, approved)) {
        throw new Error("Refund policy already approved; replacement requires a separate revocation workflow");
      }
      return Object.freeze({ ...existing });
    }
    this.state.policies.set(key, approved);
    return Object.freeze({ ...approved });
  }

  async get(campaignId: string, payoutId: string): Promise<ApprovedRefundPolicy | null> {
    const policy = this.state.policies.get(refundPolicyKey(campaignId, payoutId));
    return policy ? Object.freeze({ ...policy }) : null;
  }
}

export function validateRefundPolicy(policy: RefundPolicy): RefundPolicyValidation {
  const errors: string[] = [];
  if (!isU64(policy.campaignId)) errors.push("campaignId must be a canonical unsigned u64 string");
  if (!isU64(policy.payoutId)) errors.push("payoutId must be a canonical unsigned u64 string");
  if (getSupportedNetwork(policy.sourceNetworkId) === null) errors.push("sourceNetworkId is unsupported or non-canonical");
  if (typeof policy.sourceTokenId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(policy.sourceTokenId)) {
    errors.push("sourceTokenId must be a bounded canonical token identifier");
  }
  const recipient = validateRecipient(policy.sourceNetworkId, policy.refundAddress);
  if (!recipient.valid) errors.push(`refundAddress is invalid: ${recipient.reason ?? recipient.code}`);
  if (typeof policy.policyVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(policy.policyVersion)) {
    errors.push("policyVersion must be a bounded identifier");
  }
  if (!isCanonicalTimestamp(policy.approvedAt)) errors.push("approvedAt must be an explicit canonical UTC ISO timestamp");
  return { valid: errors.length === 0, errors };
}

export function canonicalizeRefundPolicy(policy: RefundPolicy): string {
  return JSON.stringify([
    "disburse-refund-policy-v1",
    policy.campaignId,
    policy.payoutId,
    policy.sourceNetworkId,
    policy.sourceTokenId,
    policy.refundAddress,
    policy.policyVersion,
    policy.approvedAt,
  ]);
}

export function fingerprintRefundPolicy(policy: RefundPolicy): string {
  return createHash("sha256").update(canonicalizeRefundPolicy(policy), "utf8").digest("hex");
}

export function sameRefundPolicy(left: RefundPolicy, right: RefundPolicy): boolean {
  return canonicalizeRefundPolicy(left) === canonicalizeRefundPolicy(right);
}

export function sameApprovedRefundPolicy(left: ApprovedRefundPolicy, right: ApprovedRefundPolicy): boolean {
  return left.fingerprint === right.fingerprint && sameRefundPolicy(left, right);
}

export function bindRefundPolicy(desired: RefundPolicy, approved: ApprovedRefundPolicy): ApprovedRefundPolicy {
  const validation = validateRefundPolicy(desired);
  if (!validation.valid) throw new Error(`Invalid refund policy: ${validation.errors.join(", ")}`);
  if (!sameRefundPolicy(desired, approved) || fingerprintRefundPolicy(approved) !== approved.fingerprint) {
    throw new Error("Refund policy mismatch or integrity failure: every approved field must match");
  }
  return Object.freeze({ ...approved });
}

export function assertProviderRefundDestination(
  approved: ApprovedRefundPolicy,
  providerRefundAddress: string | null | undefined,
): void {
  if (providerRefundAddress !== undefined && providerRefundAddress !== null && providerRefundAddress !== approved.refundAddress) {
    throw new Error("Provider response refund destination differs from the approved payout policy");
  }
}

export function refundPolicyKey(campaignId: string, payoutId: string): string {
  return JSON.stringify([campaignId, payoutId]);
}

function isU64(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= (1n << 64n) - 1n;
}

function isCanonicalTimestamp(value: string): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}
