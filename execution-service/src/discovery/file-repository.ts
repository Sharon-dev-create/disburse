import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import {
  executionJobKeyString,
  type ExecutionJobKey,
} from "../domain/payout.ts";
import type {
  ExecutionAttempt,
  ExecutionJobRecord,
  Lease,
} from "../persistence/repository.ts";
import {
  assertTransition,
  type JobState,
  type TransitionEvidence,
} from "../state-machine/state.ts";
import {
  validatePayoutSnapshot,
  type PayoutReservedEvent,
  type PayoutSnapshot,
} from "../domain/payout.ts";
import type {
  DiscoveryDiscrepancy,
  DiscoveryEventCommit,
  DiscoveryFailure,
  DiscoveryObservation,
  DiscoveryRepository,
  DiscoveryStateSnapshot,
  IndexedEventRecord,
} from "./repository.ts";
import { nearEventKey, nearPayoutKey } from "./repository.ts";

interface FileState {
  cursors: Map<string, string>;
  events: Map<string, IndexedEventRecord>;
  observations: Map<string, DiscoveryObservation>;
  discrepancies: (DiscoveryDiscrepancy & { payoutKey: string | null })[];
  jobs: Map<string, ExecutionJobRecord>;
  failures: Map<string, DiscoveryFailure>;
  nextFencingTokens: Map<string, number>;
}

interface SerializedState {
  readonly version: 1;
  readonly cursors: readonly (readonly [string, string])[];
  readonly events: readonly (readonly [string, IndexedEventRecord])[];
  readonly observations: readonly (readonly [string, DiscoveryObservation])[];
  readonly discrepancies: readonly (DiscoveryDiscrepancy & {
    payoutKey: string | null;
  })[];
  readonly jobs: readonly (readonly [string, ExecutionJobRecord])[];
  readonly failures: readonly (readonly [string, DiscoveryFailure])[];
  readonly nextFencingTokens: readonly (readonly [string, number])[];
}

/**
 * Durable single-writer local repository. Each event, observation, optional job, and cursor
 * update is committed as one fsync + atomic rename. Use a database adapter for multi-process
 * deployments; do not share this file between independent indexer processes.
 */
export class DurableFileDiscoveryRepository implements DiscoveryRepository {
  private state: FileState;
  private queue: Promise<void> = Promise.resolve();
  private readonly path: string;
  private readonly beforeCommit: () => void | Promise<void>;

  private constructor(
    path: string,
    state: FileState,
    beforeCommit: () => void | Promise<void> = () => {},
  ) {
    this.path = path;
    this.beforeCommit = beforeCommit;
    this.state = state;
  }

  static async open(
    path: string,
    options: { readonly beforeCommit?: () => void | Promise<void> } = {},
  ): Promise<DurableFileDiscoveryRepository> {
    let state = emptyState();
    try {
      state = deserialize(await readFile(path, "utf8"));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    return new DurableFileDiscoveryRepository(
      path,
      state,
      options.beforeCommit,
    );
  }

  async getCursor(sourceKey: string): Promise<string | null> {
    return this.state.cursors.get(sourceKey) ?? null;
  }

  async commitCursor(sourceKey: string, cursor: string): Promise<void> {
    await this.exclusive(async () => {
      if (this.state.cursors.get(sourceKey) === cursor) return;
      const next = cloneState(this.state);
      next.cursors.set(sourceKey, cursor);
      await this.persist(next);
      this.state = next;
    });
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
    return this.exclusive(async () => {
      const existing = this.state.jobs.get(storageKey);
      if (existing) {
        if (
          JSON.stringify(existing.payout) !== JSON.stringify(payout) ||
          JSON.stringify(existing.discoveryEvent) !==
            JSON.stringify(event.identity)
        ) {
          throw new Error(
            "Duplicate payout discovery conflicts with the persisted job",
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
      const next = cloneState(this.state);
      next.jobs.set(storageKey, job);
      await this.persist(next);
      this.state = next;
      return { job, created: true };
    });
  }

  async claimNext(
    workerId: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<ExecutionJobRecord | null> {
    if (!workerId || ttlMs <= 0)
      throw new Error("A worker ID and positive lease duration are required");
    return this.exclusive(async () => {
      const candidate = [...this.state.jobs.values()].find(
        (job) =>
          (job.lease === null || job.lease.expiresAtMs <= nowMs) &&
          (job.state === "Queued" || job.state === "Leased"),
      );
      if (!candidate) return null;
      const storageKey = executionJobKeyString(candidate.key);
      if (candidate.state === "Queued") assertTransition("Queued", "Leased");
      const fencingToken =
        (this.state.nextFencingTokens.get(storageKey) ?? 0) + 1;
      const lease: Lease = {
        workerId,
        fencingToken,
        expiresAtMs: nowMs + ttlMs,
      };
      const claimed: ExecutionJobRecord = {
        ...candidate,
        state: "Leased",
        version: candidate.version + 1,
        updatedAtMs: nowMs,
        lease,
      };
      const next = cloneState(this.state);
      next.nextFencingTokens.set(storageKey, fencingToken);
      next.jobs.set(storageKey, claimed);
      await this.persist(next);
      this.state = next;
      return claimed;
    });
  }

  async renewLease(
    key: ExecutionJobKey,
    lease: Lease,
    nowMs: number,
    ttlMs: number,
  ): Promise<Lease | null> {
    const storageKey = executionJobKeyString(key);
    return this.exclusive(async () => {
      const current = this.state.jobs.get(storageKey);
      if (
        !current?.lease ||
        !sameLease(current.lease, lease) ||
        current.lease.expiresAtMs <= nowMs
      )
        return null;
      if (ttlMs <= 0) throw new Error("Lease duration must be positive");
      const renewed = { ...lease, expiresAtMs: nowMs + ttlMs };
      const next = cloneState(this.state);
      next.jobs.set(storageKey, {
        ...current,
        version: current.version + 1,
        updatedAtMs: nowMs,
        lease: renewed,
      });
      await this.persist(next);
      this.state = next;
      return renewed;
    });
  }

  async transition(
    key: ExecutionJobKey,
    expectedVersion: number,
    nextState: JobState,
    evidence: TransitionEvidence,
    lease: Lease | null,
    nowMs: number,
  ): Promise<ExecutionJobRecord> {
    const storageKey = executionJobKeyString(key);
    return this.exclusive(async () => {
      const current = this.state.jobs.get(storageKey);
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
      assertTransition(current.state, nextState, evidence);
      const updated: ExecutionJobRecord = {
        ...current,
        state: nextState,
        version: current.version + 1,
        updatedAtMs: nowMs,
        lease:
          nextState === "Queued" ||
          nextState === "Completed" ||
          nextState === "Abandoned"
            ? null
            : current.lease,
      };
      const next = cloneState(this.state);
      next.jobs.set(storageKey, updated);
      await this.persist(next);
      this.state = next;
      return updated;
    });
  }

  async appendAttempt(
    key: ExecutionJobKey,
    lease: Lease,
    attempt: ExecutionAttempt,
    nowMs: number,
  ): Promise<ExecutionJobRecord> {
    const storageKey = executionJobKeyString(key);
    return this.exclusive(async () => {
      const current = this.state.jobs.get(storageKey);
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
      const next = cloneState(this.state);
      next.jobs.set(storageKey, updated);
      await this.persist(next);
      this.state = next;
      return updated;
    });
  }

  async get(key: ExecutionJobKey): Promise<ExecutionJobRecord | null> {
    return this.state.jobs.get(executionJobKeyString(key)) ?? null;
  }

  async commitEvent(
    commit: DiscoveryEventCommit,
  ): Promise<{ readonly duplicate: boolean }> {
    return this.exclusive(async () => {
      const eventKey = nearEventKey(commit.event);
      const existing = this.state.events.get(eventKey);
      if (existing && !sameEventContent(existing.event, commit.event)) {
        throw new Error(
          "A stable NEAR event identity was received with conflicting content",
        );
      }
      const next = cloneState(this.state);
      next.failures.delete(eventKey);
      if (!existing) {
        next.events.set(eventKey, {
          eventKey,
          event: commit.event,
          processedAtMs: commit.nowMs,
        });
      }
      const identity = commit.event.identity;
      const payoutKey =
        "payoutId" in commit.event
          ? nearPayoutKey(
              identity.networkId,
              identity.contractId,
              commit.event.payoutId,
            )
          : null;
      if (commit.observation && payoutKey)
        next.observations.set(payoutKey, commit.observation);
      if (commit.discrepancy) {
        next.discrepancies.push({ ...commit.discrepancy, payoutKey });
      }
      if (commit.job) {
        const jobKey = nearPayoutKey(
          commit.job.key.networkId,
          commit.job.key.contractId,
          commit.job.key.payoutId,
        );
        const existingJob = next.jobs.get(jobKey);
        if (
          existingJob &&
          (JSON.stringify(existingJob.payout) !==
            JSON.stringify(commit.job.payout) ||
            JSON.stringify(existingJob.discoveryEvent) !==
              JSON.stringify(commit.job.discoveryEvent))
        ) {
          throw new Error(
            "Discovery event conflicts with the existing operational job",
          );
        }
        if (!existingJob) next.jobs.set(jobKey, commit.job);
      }
      next.cursors.set(commit.sourceKey, commit.nextCursor);
      await this.persist(next);
      this.state = next;
      return { duplicate: existing !== undefined };
    });
  }

  async getSnapshot(): Promise<DiscoveryStateSnapshot> {
    const state = this.state;
    return {
      cursors: new Map(state.cursors),
      events: new Map(state.events),
      observations: new Map(state.observations),
      discrepancies: [...state.discrepancies],
      jobs: new Map(state.jobs),
      failures: new Map(state.failures),
    };
  }

  async recordReconciliation(
    payoutKey: string,
    observation: DiscoveryObservation | null,
    discrepancy: DiscoveryDiscrepancy | null,
  ): Promise<void> {
    await this.exclusive(async () => {
      const next = cloneState(this.state);
      if (observation) next.observations.set(payoutKey, observation);
      if (discrepancy) next.discrepancies.push({ ...discrepancy, payoutKey });
      await this.persist(next);
      this.state = next;
    });
  }

  async recordFailure(
    event: DiscoveryEventCommit["event"],
    sourceKey: string,
    error: unknown,
    nowMs: number,
  ): Promise<void> {
    await this.exclusive(async () => {
      const failureKey = nearEventKey(event);
      const previous = this.state.failures.get(failureKey);
      const attempts = (previous?.attempts ?? 0) + 1;
      const next = cloneState(this.state);
      next.failures.set(failureKey, {
        failureKey,
        sourceKey,
        eventIdentity: event.identity,
        stage: "contract-view",
        classification:
          error instanceof Error && "kind" in error
            ? String(error.kind)
            : "unknown",
        retryable: true,
        attempts,
        nextRetryAtMs:
          nowMs + Math.min(60_000, 1_000 * 2 ** Math.min(attempts - 1, 6)),
        message:
          error instanceof Error
            ? error.message
            : "Unknown contract view failure",
        occurredAtMs: nowMs,
      });
      await this.persist(next);
      this.state = next;
    });
  }

  async recordSourceFailure(
    sourceKey: string,
    error: unknown,
    nowMs: number,
  ): Promise<void> {
    await this.exclusive(async () => {
      const failureKey = JSON.stringify(["source", sourceKey]);
      const previous = this.state.failures.get(failureKey);
      const attempts = (previous?.attempts ?? 0) + 1;
      const next = cloneState(this.state);
      next.failures.set(failureKey, {
        failureKey,
        sourceKey,
        eventIdentity: null,
        stage: "event-source",
        classification:
          error instanceof Error && "kind" in error
            ? String(error.kind)
            : "unknown",
        retryable: true,
        attempts,
        nextRetryAtMs:
          nowMs + Math.min(60_000, 1_000 * 2 ** Math.min(attempts - 1, 6)),
        message:
          error instanceof Error
            ? error.message
            : "Unknown event source failure",
        occurredAtMs: nowMs,
      });
      await this.persist(next);
      this.state = next;
    });
  }

  async clearSourceFailure(sourceKey: string): Promise<void> {
    await this.exclusive(async () => {
      const failureKey = JSON.stringify(["source", sourceKey]);
      if (!this.state.failures.has(failureKey)) return;
      const next = cloneState(this.state);
      next.failures.delete(failureKey);
      await this.persist(next);
      this.state = next;
    });
  }

  private async persist(state: FileState): Promise<void> {
    await this.beforeCommit();
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(serialize(state)), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
      const directory = await open(dirname(this.path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function emptyState(): FileState {
  return {
    cursors: new Map(),
    events: new Map(),
    observations: new Map(),
    discrepancies: [],
    jobs: new Map(),
    failures: new Map(),
    nextFencingTokens: new Map(),
  };
}

function cloneState(state: FileState): FileState {
  return {
    cursors: new Map(state.cursors),
    events: new Map(state.events),
    observations: new Map(state.observations),
    discrepancies: [...state.discrepancies],
    jobs: new Map(state.jobs),
    failures: new Map(state.failures),
    nextFencingTokens: new Map(state.nextFencingTokens),
  };
}

function serialize(state: FileState): SerializedState {
  return {
    version: 1,
    cursors: [...state.cursors],
    events: [...state.events],
    observations: [...state.observations],
    discrepancies: state.discrepancies,
    jobs: [...state.jobs],
    failures: [...state.failures],
    nextFencingTokens: [...state.nextFencingTokens],
  };
}

function deserialize(text: string): FileState {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1)
    throw new Error("Unsupported discovery file version");
  const cursors = stringMapFrom(value.cursors);
  if ([...cursors.values()].some((cursor) => !cursor.trim())) {
    throw new Error("Corrupt discovery repository cursor");
  }
  const nextFencingTokens = numberMapFrom(value.nextFencingTokens);
  if (
    [...nextFencingTokens.values()].some(
      (token) => !Number.isSafeInteger(token) || token < 0,
    )
  ) {
    throw new Error("Corrupt discovery fencing token");
  }
  return {
    cursors,
    events: mapFrom(value.events),
    observations: mapFrom(value.observations),
    discrepancies: arrayOf(value.discrepancies),
    jobs: mapFrom(value.jobs),
    failures: mapFrom(value.failures),
    nextFencingTokens,
  };
}

function stringMapFrom(value: unknown): Map<string, string> {
  const result = mapFrom<string, unknown>(value);
  if ([...result.values()].some((item) => typeof item !== "string")) {
    throw new Error("Corrupt discovery repository cursor data");
  }
  return result as Map<string, string>;
}

function numberMapFrom(value: unknown): Map<string, number> {
  const result = mapFrom<string, unknown>(value);
  if ([...result.values()].some((item) => typeof item !== "number")) {
    throw new Error("Corrupt discovery repository fencing data");
  }
  return result as Map<string, number>;
}

function sameLease(left: Lease, right: Lease): boolean {
  return (
    left.workerId === right.workerId &&
    left.fencingToken === right.fencingToken &&
    left.expiresAtMs === right.expiresAtMs
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
  ].includes(state);
}

function mapFrom<K extends string, V>(value: unknown): Map<K, V> {
  if (!Array.isArray(value))
    throw new Error("Corrupt discovery repository map");
  const result = new Map<K, V>();
  for (const pair of value) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string"
    ) {
      throw new Error("Corrupt discovery repository entry");
    }
    result.set(pair[0] as K, pair[1] as V);
  }
  return result;
}

function arrayOf<T>(value: unknown): T[] {
  if (!Array.isArray(value))
    throw new Error("Corrupt discovery repository array");
  return value as T[];
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function sameEventContent(
  left: IndexedEventRecord["event"],
  right: IndexedEventRecord["event"],
): boolean {
  return (
    JSON.stringify({ ...left, cursor: "" }) ===
    JSON.stringify({ ...right, cursor: "" })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
