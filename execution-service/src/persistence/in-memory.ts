import {
  executionJobKeyString,
  validatePayoutSnapshot,
  type ExecutionJobKey,
  type PayoutReservedEvent,
  type PayoutSnapshot,
} from "../domain/payout.ts";
import {
  assertTransition,
  type JobState,
  type TransitionEvidence,
} from "../state-machine/state.ts";
import type {
  ExecutionAttempt,
  ExecutionJobRecord,
  JobRepository,
  Lease,
} from "./repository.ts";

export interface MemoryPersistenceState {
  readonly jobs: Map<string, ExecutionJobRecord>;
  readonly nextFencingToken: Map<string, number>;
}

export function newMemoryPersistenceState(): MemoryPersistenceState {
  return { jobs: new Map(), nextFencingToken: new Map() };
}

/** Test-only repository. Production persistence is specified by the PostgreSQL schema. */
export class InMemoryJobRepository implements JobRepository {
  private readonly storage: MemoryPersistenceState;

  constructor(storage: MemoryPersistenceState = newMemoryPersistenceState()) {
    this.storage = storage;
  }

  async enqueueDiscovered(
    event: PayoutReservedEvent,
    payout: PayoutSnapshot,
    nowMs: number,
  ): Promise<{ readonly job: ExecutionJobRecord; readonly created: boolean }> {
    validatePayoutSnapshot(payout);
    if (
      event.payoutId !== payout.payoutId ||
      event.campaignId !== payout.campaignId
    ) {
      throw new Error(
        "Discovery event does not identify the supplied on-chain payout",
      );
    }
    const key: ExecutionJobKey = {
      networkId: event.identity.networkId,
      contractId: event.identity.contractId,
      payoutId: payout.payoutId,
    };
    const storageKey = executionJobKeyString(key);
    const existing = this.storage.jobs.get(storageKey);
    if (existing) {
      if (JSON.stringify(existing.payout) !== JSON.stringify(payout)) {
        throw new Error(
          "Duplicate payout discovery conflicts with the persisted payout snapshot",
        );
      }
      return { job: existing, created: false };
    }
    const job: ExecutionJobRecord = {
      key,
      payout,
      discoveryEvent: event.identity,
      state: "Discovered",
      version: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      lease: null,
      attempts: [],
    };
    this.storage.jobs.set(storageKey, job);
    return { job, created: true };
  }

  async claimNext(
    workerId: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<ExecutionJobRecord | null> {
    if (!workerId || ttlMs <= 0)
      throw new Error("A worker ID and positive lease duration are required");
    const candidate = [...this.storage.jobs.values()].find((job) => {
      const leaseAvailable =
        job.lease === null || job.lease.expiresAtMs <= nowMs;
      return (
        leaseAvailable && (job.state === "Queued" || job.state === "Leased")
      );
    });
    if (!candidate) return null;

    const storageKey = executionJobKeyString(candidate.key);
    if (candidate.state === "Queued") {
      assertTransition("Queued", "Leased");
    }
    const fencingToken =
      (this.storage.nextFencingToken.get(storageKey) ?? 0) + 1;
    this.storage.nextFencingToken.set(storageKey, fencingToken);
    const lease: Lease = { workerId, fencingToken, expiresAtMs: nowMs + ttlMs };
    const claimed: ExecutionJobRecord = {
      ...candidate,
      state: "Leased",
      version: candidate.version + 1,
      updatedAtMs: nowMs,
      lease,
    };
    this.storage.jobs.set(storageKey, claimed);
    return claimed;
  }

  async renewLease(
    key: ExecutionJobKey,
    lease: Lease,
    nowMs: number,
    ttlMs: number,
  ): Promise<Lease | null> {
    const current = this.storage.jobs.get(executionJobKeyString(key));
    if (
      !current?.lease ||
      !sameLease(current.lease, lease) ||
      current.lease.expiresAtMs <= nowMs
    ) {
      return null;
    }
    if (ttlMs <= 0) throw new Error("Lease duration must be positive");
    const renewed = { ...lease, expiresAtMs: nowMs + ttlMs };
    this.storage.jobs.set(executionJobKeyString(key), {
      ...current,
      version: current.version + 1,
      updatedAtMs: nowMs,
      lease: renewed,
    });
    return renewed;
  }

  async transition(
    key: ExecutionJobKey,
    expectedVersion: number,
    next: JobState,
    evidence: TransitionEvidence,
    lease: Lease | null,
    nowMs: number,
  ): Promise<ExecutionJobRecord> {
    const storageKey = executionJobKeyString(key);
    const current = this.storage.jobs.get(storageKey);
    if (!current) throw new Error("Execution job not found");
    if (current.version !== expectedVersion)
      throw new Error("Execution job version conflict");
    if (
      lease &&
      (!current.lease ||
        !sameLease(current.lease, lease) ||
        lease.expiresAtMs <= nowMs)
    ) {
      throw new Error("Worker lease is stale or expired");
    }
    if (
      (current.state === "Leased" || isWorkerState(current.state)) &&
      !lease
    ) {
      throw new Error("A live worker lease is required for this transition");
    }
    assertTransition(current.state, next, evidence);
    const updated: ExecutionJobRecord = {
      ...current,
      state: next,
      version: current.version + 1,
      updatedAtMs: nowMs,
      lease:
        next === "Queued" || next === "Completed" || next === "Abandoned"
          ? null
          : current.lease,
    };
    this.storage.jobs.set(storageKey, updated);
    return updated;
  }

  async appendAttempt(
    key: ExecutionJobKey,
    lease: Lease,
    attempt: ExecutionAttempt,
    nowMs: number,
  ): Promise<ExecutionJobRecord> {
    const storageKey = executionJobKeyString(key);
    const current = this.storage.jobs.get(storageKey);
    if (
      !current?.lease ||
      !sameLease(current.lease, lease) ||
      lease.expiresAtMs <= nowMs
    ) {
      throw new Error("Worker lease is stale or expired");
    }
    if (
      current.attempts.some((item) => item.attemptKey === attempt.attemptKey)
    ) {
      throw new Error("Duplicate execution attempt key");
    }
    if (attempt.sequence !== current.attempts.length + 1) {
      throw new Error("Execution attempt sequence must be contiguous");
    }
    const updated: ExecutionJobRecord = {
      ...current,
      attempts: [...current.attempts, attempt],
      version: current.version + 1,
      updatedAtMs: nowMs,
    };
    this.storage.jobs.set(storageKey, updated);
    return updated;
  }

  async get(key: ExecutionJobKey): Promise<ExecutionJobRecord | null> {
    return this.storage.jobs.get(executionJobKeyString(key)) ?? null;
  }
}

function sameLease(left: Lease, right: Lease): boolean {
  return (
    left.workerId === right.workerId && left.fencingToken === right.fencingToken
  );
}

function isWorkerState(state: JobState): boolean {
  return [
    "Preparing",
    "SubmissionStarted",
    "SubmissionUnknown",
    "Submitted",
    "ConfirmationPending",
    "VerificationPending",
    "SettlementReady",
    "SettlementSubmitted",
    "RetryableFailure",
    "ManualReview",
  ].includes(state);
}
