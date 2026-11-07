import type { ExecutionJobRecord } from "../persistence/repository.ts";
import type { DecodedNearEvent } from "./events.ts";

export interface DiscoveryObservation {
  readonly networkId: string;
  readonly contractId: string;
  readonly payoutId: string;
  readonly campaignId: string;
  readonly contractStatus: string;
  readonly payout: unknown;
  readonly observedAtMs: number;
}

export interface DiscoveryDiscrepancy {
  readonly kind:
    | "payout-missing"
    | "event-view-mismatch"
    | "non-executable-status"
    | "rpc-error"
    | "event-identity-mismatch"
    | "unknown-event"
    | "malformed-event"
    | "stale-observation";
  readonly message: string;
  readonly createdAtMs: number;
}

export interface IndexedEventRecord {
  readonly eventKey: string;
  readonly event: DecodedNearEvent;
  readonly processedAtMs: number;
}

export interface DiscoveryFailure {
  readonly failureKey: string;
  readonly sourceKey: string;
  readonly eventIdentity: DecodedNearEvent["identity"];
  readonly stage: "contract-view";
  readonly classification: string;
  readonly retryable: true;
  readonly attempts: number;
  readonly nextRetryAtMs: number;
  readonly message: string;
  readonly occurredAtMs: number;
}

export interface DiscoveryEventCommit {
  readonly sourceKey: string;
  readonly event: DecodedNearEvent;
  readonly observation: DiscoveryObservation | null;
  readonly discrepancy: DiscoveryDiscrepancy | null;
  readonly job: ExecutionJobRecord | null;
  readonly nextCursor: string;
  readonly nowMs: number;
}

export interface DiscoveryStateSnapshot {
  readonly cursors: ReadonlyMap<string, string>;
  readonly events: ReadonlyMap<string, IndexedEventRecord>;
  readonly observations: ReadonlyMap<string, DiscoveryObservation>;
  readonly discrepancies: readonly (DiscoveryDiscrepancy & { readonly payoutKey: string | null })[];
  readonly jobs: ReadonlyMap<string, ExecutionJobRecord>;
  readonly failures: ReadonlyMap<string, DiscoveryFailure>;
}

export interface DiscoveryRepository {
  getCursor(sourceKey: string): Promise<string | null>;
  commitEvent(commit: DiscoveryEventCommit): Promise<{ readonly duplicate: boolean }>;
  recordReconciliation(
    payoutKey: string,
    observation: DiscoveryObservation | null,
    discrepancy: DiscoveryDiscrepancy | null,
  ): Promise<void>;
  recordFailure(event: DecodedNearEvent, sourceKey: string, error: unknown, nowMs: number): Promise<void>;
  getSnapshot(): Promise<DiscoveryStateSnapshot>;
}

export function nearEventKey(event: DecodedNearEvent): string {
  const identity = event.identity;
  return JSON.stringify([
    identity.networkId,
    identity.contractId,
    identity.blockHash,
    identity.transactionHash,
    identity.receiptId,
    identity.eventIndex,
  ]);
}

export function nearPayoutKey(networkId: string, contractId: string, payoutId: string): string {
  return JSON.stringify([networkId, contractId, payoutId]);
}
