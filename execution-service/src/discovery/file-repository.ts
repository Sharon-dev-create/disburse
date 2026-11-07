import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import type { ExecutionJobRecord } from "../persistence/repository.ts";
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
        if (!next.jobs.has(jobKey)) next.jobs.set(jobKey, commit.job);
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
  };
}

function deserialize(text: string): FileState {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1)
    throw new Error("Unsupported discovery file version");
  return {
    cursors: mapFrom(value.cursors),
    events: mapFrom(value.events),
    observations: mapFrom(value.observations),
    discrepancies: arrayOf(value.discrepancies),
    jobs: mapFrom(value.jobs),
    failures: mapFrom(value.failures),
  };
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
