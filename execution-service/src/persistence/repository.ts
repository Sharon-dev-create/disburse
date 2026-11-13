import type {
  ExecutionJobKey,
  PayoutReservedEvent,
  PayoutSnapshot,
} from "../domain/payout.ts";
import type { JobState, TransitionEvidence } from "../state-machine/state.ts";

export interface Lease {
  readonly workerId: string;
  /** Decimal string so durable fencing counters never pass through JS numbers. */
  readonly fencingToken: string;
  /** Version of the job row covered by this lease. */
  readonly stateVersion: number;
  readonly expiresAtMs: number;
}

export interface ExecutionAttempt {
  readonly attemptKey: string;
  readonly sequence: number;
  readonly phase:
    | "validate"
    | "quote"
    | "prepare"
    | "submit"
    | "confirm"
    | "verify"
    | "settle";
  readonly idempotencyKey: string;
  readonly startedAtMs: number;
  readonly outcome:
    "started" | "accepted" | "rejected" | "unknown" | "verified" | "failed";
}

export interface ExecutionJobRecord {
  readonly key: ExecutionJobKey;
  readonly payout: PayoutSnapshot;
  readonly discoveryEvent: PayoutReservedEvent["identity"];
  readonly state: JobState;
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly lease: Lease | null;
  readonly attempts: readonly ExecutionAttempt[];
}

export interface ExecutionJobCreation {
  readonly idempotencyKey: string;
  readonly event: PayoutReservedEvent;
  readonly payout: PayoutSnapshot;
}

export interface ExecutionJobFailure {
  readonly code: string;
  readonly description: string;
}

export interface PersistedExecutionJob extends ExecutionJobRecord {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly snapshotDigest: string;
  readonly fencingCounter: string;
  readonly attemptCount: number;
  readonly nextEligibleAtMs: number;
  readonly failure: ExecutionJobFailure | null;
}

export interface DurableJobRepository extends JobRepository {
  createIdempotent(creation: ExecutionJobCreation): Promise<{
    readonly job: PersistedExecutionJob;
    readonly created: boolean;
  }>;
  getById(jobId: string): Promise<PersistedExecutionJob | null>;
  getByPayout(key: ExecutionJobKey): Promise<PersistedExecutionJob | null>;
  listByCampaign(
    scope: Pick<ExecutionJobKey, "networkId" | "contractId">,
    campaignId: string,
    limit: number,
  ): Promise<readonly PersistedExecutionJob[]>;
  releaseLease(
    key: ExecutionJobKey,
    lease: Lease,
    nowMs: number,
  ): Promise<PersistedExecutionJob>;
  recordFailure(
    key: ExecutionJobKey,
    lease: Lease,
    failure: ExecutionJobFailure,
    nowMs: number,
  ): Promise<PersistedExecutionJob>;
  recoverExpiredLeases(
    nowMs: number,
  ): Promise<{ readonly recovered: number; readonly manualReview: number }>;
}

export interface JobRepository {
  /** Unique by network, contract and payout; duplicate discoveries return the existing job. */
  enqueueDiscovered(
    event: PayoutReservedEvent,
    payout: PayoutSnapshot,
    nowMs: number,
  ): Promise<{ readonly job: ExecutionJobRecord; readonly created: boolean }>;
  claimNext(
    workerId: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<ExecutionJobRecord | null>;
  renewLease(
    key: ExecutionJobKey,
    lease: Lease,
    nowMs: number,
    ttlMs: number,
  ): Promise<Lease | null>;
  transition(
    key: ExecutionJobKey,
    expectedVersion: number,
    next: JobState,
    evidence: TransitionEvidence,
    lease: Lease | null,
    nowMs: number,
  ): Promise<ExecutionJobRecord>;
  appendAttempt(
    key: ExecutionJobKey,
    lease: Lease,
    attempt: ExecutionAttempt,
    nowMs: number,
  ): Promise<ExecutionJobRecord>;
  get(key: ExecutionJobKey): Promise<ExecutionJobRecord | null>;
}
