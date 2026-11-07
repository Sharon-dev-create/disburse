import type {
  ExecutionJobRecord,
  JobRepository,
} from "../persistence/repository.ts";
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
  readonly providerId: string;
  readonly canonicalPayloadHash: string;
  readonly firstObservedAtMs: number;
  readonly processedAtMs: number;
}

export interface DiscoveryBlockObservation {
  readonly networkId: string;
  readonly contractId: string;
  readonly blockHeight: string;
  readonly blockHash: string;
  readonly parentBlockHash: string;
  readonly providerId: string;
  readonly contractReceiptCount: number;
  readonly contractLogCount: number;
  readonly canonicalPayloadHash: string;
}

export interface ArchivedDiscoveryBlock extends DiscoveryBlockObservation {
  readonly firstObservedAtMs: number;
  readonly lastObservedAtMs: number;
}

export type DiscoveryIncidentType =
  | "provider-outage"
  | "rate-limit"
  | "missing-history"
  | "malformed-provider-response"
  | "block-continuity-failure"
  | "network-mismatch"
  | "conflicting-historical-block"
  | "conflicting-historical-event"
  | "cursor-corruption"
  | "archive-write-failure"
  | "reconciliation-failure";

export interface DiscoveryIncident {
  readonly incidentId: string;
  readonly type: DiscoveryIncidentType;
  readonly networkId: string;
  readonly contractId: string;
  readonly blockHeight: string | null;
  readonly eventKey: string | null;
  readonly expected: unknown;
  readonly observed: unknown;
  readonly detectedAtMs: number;
  readonly lastSeenAtMs: number;
  readonly occurrences: number;
  readonly status: "open" | "resolved" | "unverifiable";
  readonly actionRequired: string;
}

export interface HistoricalRecoveryRecord {
  readonly recoveryId: string;
  readonly networkId: string;
  readonly contractId: string;
  readonly startBlockHeight: string;
  readonly endBlockHeight: string;
  readonly status: "running" | "validated" | "conflict" | "unavailable";
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
  readonly cursor: string | null;
  readonly blocksChecked: number;
  readonly eventsChecked: number;
  readonly summary: string;
}

export interface DiscoveryFailure {
  readonly failureKey: string;
  readonly sourceKey: string;
  readonly eventIdentity: DecodedNearEvent["identity"] | null;
  readonly stage: "contract-view" | "event-source";
  readonly classification: string;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly nextRetryAtMs: number;
  readonly message: string;
  readonly occurredAtMs: number;
}

export interface DiscoveryEventCommit {
  readonly sourceKey: string;
  readonly providerId: string;
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
  readonly blocks: ReadonlyMap<string, ArchivedDiscoveryBlock>;
  readonly incidents: ReadonlyMap<string, DiscoveryIncident>;
  readonly recoveries: ReadonlyMap<string, HistoricalRecoveryRecord>;
  readonly observations: ReadonlyMap<string, DiscoveryObservation>;
  readonly discrepancies: readonly (DiscoveryDiscrepancy & {
    readonly payoutKey: string | null;
  })[];
  readonly jobs: ReadonlyMap<string, ExecutionJobRecord>;
  readonly failures: ReadonlyMap<string, DiscoveryFailure>;
}

export interface DiscoveryRepository extends JobRepository {
  assertSourceReady(networkId: string, contractId: string): Promise<void>;
  getCursor(sourceKey: string): Promise<string | null>;
  /** Durably checkpoints source progress across ranges containing no events. */
  commitCursor(sourceKey: string, cursor: string): Promise<void>;
  archiveBlocks(
    observations: readonly DiscoveryBlockObservation[],
    nowMs: number,
  ): Promise<void>;
  recordIncident(
    incident: Omit<
      DiscoveryIncident,
      "incidentId" | "detectedAtMs" | "lastSeenAtMs" | "occurrences" | "status"
    > & { readonly status?: DiscoveryIncident["status"] },
    nowMs: number,
  ): Promise<void>;
  startRecovery(
    recovery: Omit<
      HistoricalRecoveryRecord,
      | "status"
      | "updatedAtMs"
      | "cursor"
      | "blocksChecked"
      | "eventsChecked"
      | "summary"
    >,
  ): Promise<HistoricalRecoveryRecord>;
  updateRecovery(
    recoveryId: string,
    update: Pick<
      HistoricalRecoveryRecord,
      | "status"
      | "updatedAtMs"
      | "cursor"
      | "blocksChecked"
      | "eventsChecked"
      | "summary"
    >,
  ): Promise<void>;
  resolveIncidentsInRange(
    networkId: string,
    contractId: string,
    startBlockHeight: string,
    endBlockHeight: string,
    nowMs: number,
  ): Promise<void>;
  commitEvent(
    commit: DiscoveryEventCommit,
  ): Promise<{ readonly duplicate: boolean }>;
  recordReconciliation(
    payoutKey: string,
    observation: DiscoveryObservation | null,
    discrepancy: DiscoveryDiscrepancy | null,
  ): Promise<void>;
  recordFailure(
    event: DecodedNearEvent,
    sourceKey: string,
    error: unknown,
    nowMs: number,
  ): Promise<void>;
  recordSourceFailure(
    sourceKey: string,
    error: unknown,
    nowMs: number,
  ): Promise<void>;
  clearSourceFailure(sourceKey: string): Promise<void>;
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

export function nearPayoutKey(
  networkId: string,
  contractId: string,
  payoutId: string,
): string {
  return JSON.stringify([networkId, contractId, payoutId]);
}
