import { ACTIVE_TESTNET } from "../near/active-testnet.ts";
export interface ExecutionSafeguards {
  readonly network: "near:testnet";
  readonly contractId: string;
  readonly tokenId: string;
  readonly maxPayout: string;
  readonly maxCampaignExposure: string;
  readonly maxPending: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly emergencyStop: boolean;
}
export function validateSafeguards(policy: ExecutionSafeguards): void {
  if (
    policy.network !== "near:testnet" ||
    policy.contractId !== ACTIVE_TESTNET.contractId ||
    policy.tokenId !== ACTIVE_TESTNET.tokenId
  )
    throw new Error("Execution identity not allowlisted");
  for (const value of [policy.maxPayout, policy.maxCampaignExposure])
    if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > 1000000n)
      throw new Error("Invalid exposure limit");
  if (
    BigInt(policy.maxPayout) > 100000n ||
    BigInt(policy.maxPayout) > BigInt(policy.maxCampaignExposure)
  )
    throw new Error("Invalid payout limit");
  if (
    !Number.isSafeInteger(policy.maxPending) ||
    policy.maxPending < 1 ||
    policy.maxPending > 4 ||
    policy.maxAttempts !== 1 ||
    !Number.isSafeInteger(policy.timeoutMs) ||
    policy.timeoutMs < 1 ||
    policy.timeoutMs > 60000 ||
    typeof policy.emergencyStop !== "boolean"
  )
    throw new Error("Invalid execution safeguards");
}
/** Dormant local policy assessment, never an execution authorization or signer. */
export function assessExecution(
  policy: ExecutionSafeguards,
  state: {
    readonly amount: string;
    readonly campaignExposure: string;
    readonly pending: number;
    readonly operator: string;
    readonly approver: string;
    readonly executor: string;
    readonly recipientVerified: boolean;
    readonly outcome: "new" | "unknown";
  },
) {
  validateSafeguards(policy);
  const blockers: string[] = [
    "Live execution disabled; separate reviewed on-chain authorization required",
  ];
  if (policy.emergencyStop) blockers.push("Emergency stop active");
  for (const value of [state.amount, state.campaignExposure])
    if (!/^(0|[1-9][0-9]*)$/.test(value))
      throw new Error("Invalid atomic exposure");
  if (
    BigInt(state.amount) < 1n ||
    BigInt(state.amount) > BigInt(policy.maxPayout) ||
    BigInt(state.campaignExposure) > BigInt(policy.maxCampaignExposure)
  )
    blockers.push("Exposure limit exceeded");
  if (
    !Number.isSafeInteger(state.pending) ||
    state.pending < 0 ||
    state.pending >= policy.maxPending
  )
    blockers.push("Pending limit exceeded");
  if (
    !state.operator ||
    !state.approver ||
    !state.executor ||
    new Set([state.operator, state.approver, state.executor]).size !== 3
  )
    blockers.push("Independent roles required");
  if (!state.recipientVerified) blockers.push("Recipient ownership unverified");
  if (state.outcome === "unknown")
    blockers.push("Unknown outcome locked; no automatic retry");
  return { executionEnabled: false as const, blockers };
}
