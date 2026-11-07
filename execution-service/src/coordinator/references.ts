import { createHash } from "node:crypto";
import type { ExecutionJobKey } from "../domain/payout.js";
import { executionJobKeyString } from "../domain/payout.js";

/** Stable, bounded references; provider enforcement must still be verified per adapter. */
export function stableExecutionReference(key: ExecutionJobKey): string {
  return `disburse:v1:${digest(executionJobKeyString(key))}`;
}

export function stableProviderIdempotencyKey(key: ExecutionJobKey): string {
  return `disburse-submit:v1:${digest(executionJobKeyString(key))}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
