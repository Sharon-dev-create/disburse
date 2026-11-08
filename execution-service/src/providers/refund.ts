export interface RefundPolicy {
  readonly campaignId: string;
  readonly payoutId: string;
  readonly sourceNetworkId: string;
  readonly sourceTokenId: string;
  readonly refundAddress: string;
  readonly policyVersion: string;
  readonly approvedAt: string;
}

export interface RefundPolicyValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateRefundPolicy(
  policy: RefundPolicy,
): RefundPolicyValidation {
  const errors: string[] = [];
  const required: ReadonlyArray<keyof RefundPolicy> = [
    "campaignId",
    "payoutId",
    "sourceNetworkId",
    "sourceTokenId",
    "refundAddress",
    "policyVersion",
    "approvedAt",
  ];

  for (const field of required) {
    const value = policy[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`${String(field)} is required`);
    }
  }

  if (
    !/^[A-Za-z0-9._:-]+$/.test(policy.refundAddress.trim()) ||
    policy.refundAddress.trim().length > 256
  ) {
    errors.push("refundAddress must be a non-empty, bounded source-chain address");
  }
  if (!/^[A-Za-z0-9:_-]+$/.test(policy.sourceNetworkId.trim())) {
    errors.push("sourceNetworkId is invalid");
  }
  if (!/^[A-Za-z0-9:_-]+$/.test(policy.sourceTokenId.trim())) {
    errors.push("sourceTokenId is invalid");
  }
  if (!Number.isFinite(Date.parse(policy.approvedAt))) {
    errors.push("approvedAt must be an ISO-8601 timestamp");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function sameRefundPolicy(
  left: RefundPolicy,
  right: RefundPolicy,
): boolean {
  return canonicalizeRefundPolicy(left) === canonicalizeRefundPolicy(right);
}

export function canonicalizeRefundPolicy(policy: RefundPolicy): string {
  return JSON.stringify({
    campaignId: policy.campaignId,
    payoutId: policy.payoutId,
    sourceNetworkId: policy.sourceNetworkId,
    sourceTokenId: policy.sourceTokenId,
    refundAddress: policy.refundAddress,
    policyVersion: policy.policyVersion,
    approvedAt: policy.approvedAt,
  });
}

export function bindRefundPolicy(
  desired: RefundPolicy,
  approved: RefundPolicy,
): RefundPolicy {
  const validation = validateRefundPolicy(desired);
  if (!validation.valid) {
    throw new Error(`Invalid refund policy: ${validation.errors.join(", ")}`);
  }
  if (
    desired.campaignId !== approved.campaignId ||
    desired.payoutId !== approved.payoutId ||
    desired.sourceNetworkId !== approved.sourceNetworkId ||
    desired.sourceTokenId !== approved.sourceTokenId ||
    desired.refundAddress !== approved.refundAddress
  ) {
    throw new Error("Refund policy mismatch: approved refund policy must match the payout");
  }
  return { ...approved };
}
