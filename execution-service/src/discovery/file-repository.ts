import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
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
  DiscoveryBlockObservation,
  ArchivedDiscoveryBlock,
  DiscoveryIncident,
  HistoricalRecoveryRecord,
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
  blocks: Map<string, ArchivedDiscoveryBlock>;
  incidents: Map<string, DiscoveryIncident>;
  recoveries: Map<string, HistoricalRecoveryRecord>;
  observations: Map<string, DiscoveryObservation>;
  discrepancies: (DiscoveryDiscrepancy & { payoutKey: string | null })[];
  jobs: Map<string, ExecutionJobRecord>;
  failures: Map<string, DiscoveryFailure>;
  nextFencingTokens: Map<string, string>;
}

interface SerializedState {
  readonly version: 3;
  readonly cursors: readonly (readonly [string, string])[];
  readonly events: readonly (readonly [string, IndexedEventRecord])[];
  readonly blocks: readonly (readonly [string, ArchivedDiscoveryBlock])[];
  readonly incidents: readonly (readonly [string, DiscoveryIncident])[];
  readonly recoveries: readonly (readonly [string, HistoricalRecoveryRecord])[];
  readonly observations: readonly (readonly [string, DiscoveryObservation])[];
  readonly discrepancies: readonly (DiscoveryDiscrepancy & {
    payoutKey: string | null;
  })[];
  readonly jobs: readonly (readonly [string, ExecutionJobRecord])[];
  readonly failures: readonly (readonly [string, DiscoveryFailure])[];
  readonly nextFencingTokens: readonly (readonly [string, string])[];
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

  async assertSourceReady(
    networkId: string,
    contractId: string,
  ): Promise<void> {
    const blocking = [...this.state.incidents.values()].find(
      (incident) =>
        incident.networkId === networkId &&
        incident.contractId === contractId &&
        incident.status === "open" &&
        !["provider-outage", "rate-limit", "reconciliation-failure"].includes(
          incident.type,
        ),
    );
    if (blocking) {
      throw new DiscoveryIntegrityError(
        blocking.type,
        `Discovery is paused by unresolved ${blocking.type} incident${blocking.blockHeight ? ` at block ${blocking.blockHeight}` : ""}`,
        blocking,
      );
    }
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

  async archiveBlocks(
    observations: readonly DiscoveryBlockObservation[],
    nowMs: number,
  ): Promise<void> {
    if (observations.length === 0) return;
    await this.exclusive(async () => {
      const next = cloneState(this.state);
      const ordered = [...observations].sort((left, right) =>
        BigInt(left.blockHeight) < BigInt(right.blockHeight)
          ? -1
          : BigInt(left.blockHeight) > BigInt(right.blockHeight)
            ? 1
            : 0,
      );
      for (let index = 0; index < ordered.length; index += 1) {
        const observed = ordered[index]!;
        const priorInPage = index > 0 ? ordered[index - 1] : undefined;
        const priorHeight = BigInt(observed.blockHeight) - 1n;
        const predecessor =
          priorInPage && BigInt(priorInPage.blockHeight) === priorHeight
            ? priorInPage
            : next.blocks.get(
                discoveryBlockKey({
                  ...observed,
                  blockHeight: priorHeight.toString(),
                }),
              );
        const nextHeight = BigInt(observed.blockHeight) + 1n;
        const successor =
          next.blocks.get(
            discoveryBlockKey({
              ...observed,
              blockHeight: nextHeight.toString(),
            }),
          ) ?? ordered[index + 1];
        const discontinuity =
          (priorInPage &&
            BigInt(observed.blockHeight) !==
              BigInt(priorInPage.blockHeight) + 1n) ||
          (predecessor && predecessor.blockHash !== observed.parentBlockHash) ||
          (successor &&
            BigInt(successor.blockHeight) === nextHeight &&
            successor.parentBlockHash !== observed.blockHash);
        if (discontinuity) {
          const incidentInput = {
            type: "block-continuity-failure" as const,
            networkId: observed.networkId,
            contractId: observed.contractId,
            blockHeight: observed.blockHeight,
            eventKey: null,
            expected: predecessor
              ? { parentBlockHash: predecessor.blockHash }
              : { contiguousFrom: priorInPage?.blockHeight ?? null },
            observed: {
              blockHeight: observed.blockHeight,
              blockHash: observed.blockHash,
              parentBlockHash: observed.parentBlockHash,
            },
            actionRequired:
              "Stop ingestion, preserve the checkpoint, and investigate the bounded range before resuming.",
          };
          const incident = buildIncident(
            incidentInput,
            nowMs,
            next.incidents.get(incidentKey(incidentInput)),
          );
          next.incidents.set(incident.incidentId, incident);
          await this.persist(next);
          this.state = next;
          throw new DiscoveryIntegrityError(
            "block-continuity-failure",
            `Block chain continuity failed at ${observed.blockHeight}`,
            incident,
          );
        }
        const key = discoveryBlockKey(observed);
        const existing = next.blocks.get(key);
        if (existing && !sameBlockObservation(existing, observed)) {
          const incident = buildIncident(
            {
              type: "conflicting-historical-block",
              networkId: observed.networkId,
              contractId: observed.contractId,
              blockHeight: observed.blockHeight,
              eventKey: null,
              expected: existing,
              observed,
              actionRequired:
                "Stop ingestion and rescan this finalized range. Preserve both observations; do not replace the archived block.",
            },
            nowMs,
            next.incidents.get(blockIncidentId(observed)),
          );
          next.incidents.set(incident.incidentId, incident);
          await this.persist(next);
          this.state = next;
          throw new DiscoveryIntegrityError(
            "conflicting-historical-block",
            `Archived block ${observed.blockHeight} differs from the provider response`,
            incident,
          );
        }
        if (existing) {
          next.blocks.set(key, { ...existing, lastObservedAtMs: nowMs });
        } else {
          next.blocks.set(key, {
            ...observed,
            firstObservedAtMs: nowMs,
            lastObservedAtMs: nowMs,
          });
        }
      }
      await this.persist(next);
      this.state = next;
    });
  }

  async recordIncident(
    input: Omit<
      DiscoveryIncident,
      "incidentId" | "detectedAtMs" | "lastSeenAtMs" | "occurrences" | "status"
    > & { readonly status?: DiscoveryIncident["status"] },
    nowMs: number,
  ): Promise<void> {
    await this.exclusive(async () => {
      const next = cloneState(this.state);
      const id = incidentKey(input);
      next.incidents.set(
        id,
        buildIncident(input, nowMs, next.incidents.get(id), input.status),
      );
      await this.persist(next);
      this.state = next;
    });
  }

  async startRecovery(
    recovery: Omit<
      HistoricalRecoveryRecord,
      | "status"
      | "updatedAtMs"
      | "cursor"
      | "blocksChecked"
      | "eventsChecked"
      | "summary"
    >,
  ): Promise<HistoricalRecoveryRecord> {
    return this.exclusive(async () => {
      const existing = this.state.recoveries.get(recovery.recoveryId);
      if (existing) return existing;
      const created: HistoricalRecoveryRecord = {
        ...recovery,
        status: "running",
        updatedAtMs: recovery.startedAtMs,
        cursor: null,
        blocksChecked: 0,
        eventsChecked: 0,
        summary: "Recovery scan started",
      };
      const next = cloneState(this.state);
      next.recoveries.set(created.recoveryId, created);
      await this.persist(next);
      this.state = next;
      return created;
    });
  }

  async updateRecovery(
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
  ): Promise<void> {
    await this.exclusive(async () => {
      const existing = this.state.recoveries.get(recoveryId);
      if (!existing) throw new Error("Unknown historical recovery ID");
      const next = cloneState(this.state);
      next.recoveries.set(recoveryId, { ...existing, ...update });
      await this.persist(next);
      this.state = next;
    });
  }

  async resolveIncidentsInRange(
    networkId: string,
    contractId: string,
    startBlockHeight: string,
    endBlockHeight: string,
    nowMs: number,
  ): Promise<void> {
    const start = BigInt(startBlockHeight);
    const end = BigInt(endBlockHeight);
    await this.exclusive(async () => {
      const next = cloneState(this.state);
      let changed = false;
      for (const [id, incident] of next.incidents) {
        const recoverableWithoutHeight = [
          "provider-outage",
          "rate-limit",
          "reconciliation-failure",
          "network-mismatch",
          "malformed-provider-response",
          "archive-write-failure",
        ].includes(incident.type);
        const recoverableInRange = [
          "block-continuity-failure",
          "missing-history",
          "network-mismatch",
          "malformed-provider-response",
        ].includes(incident.type);
        if (
          incident.networkId !== networkId ||
          incident.contractId !== contractId ||
          incident.status !== "open" ||
          (!recoverableWithoutHeight &&
            (incident.blockHeight === null ||
              BigInt(incident.blockHeight) < start ||
              BigInt(incident.blockHeight) > end ||
              !recoverableInRange))
        )
          continue;
        next.incidents.set(id, {
          ...incident,
          status: "resolved",
          lastSeenAtMs: nowMs,
        });
        changed = true;
      }
      if (!changed) return;
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
      const fencingToken = (
        BigInt(this.state.nextFencingTokens.get(storageKey) ?? "0") + 1n
      ).toString();
      const lease: Lease = {
        workerId,
        fencingToken,
        stateVersion: candidate.version + 1,
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
        lease.stateVersion !== current.version ||
        current.lease.expiresAtMs <= nowMs
      )
        return null;
      if (ttlMs <= 0) throw new Error("Lease duration must be positive");
      const renewed = {
        ...lease,
        stateVersion: current.version + 1,
        expiresAtMs: nowMs + ttlMs,
      };
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
          lease.stateVersion !== expectedVersion ||
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
            : current.lease
              ? { ...current.lease, stateVersion: current.version + 1 }
              : null,
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
        lease.stateVersion !== current.version ||
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
        lease: { ...current.lease, stateVersion: current.version + 1 },
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
      const next = cloneState(this.state);
      const observedHash = canonicalEventPayloadHash(commit.event);
      if (
        existing &&
        (existing.canonicalPayloadHash !== observedHash ||
          !sameEventIdentity(existing.event, commit.event))
      ) {
        const incidentInput = {
          type: "conflicting-historical-event",
          networkId: commit.event.identity.networkId,
          contractId: commit.event.identity.contractId,
          blockHeight: commit.event.identity.blockHeight,
          eventKey,
          expected: {
            providerId: existing.providerId,
            canonicalPayloadHash: existing.canonicalPayloadHash,
            identity: existing.event.identity,
            rawLog: existing.event.rawLog,
          },
          observed: {
            providerId: commit.providerId,
            canonicalPayloadHash: observedHash,
            identity: commit.event.identity,
            rawLog: commit.event.rawLog,
          },
          actionRequired:
            "Stop the affected scan and investigate the preserved original and new event payloads.",
        } as const;
        const incident = buildIncident(
          incidentInput,
          commit.nowMs,
          next.incidents.get(incidentKey(incidentInput)),
        );
        next.incidents.set(incident.incidentId, incident);
        await this.persist(next);
        this.state = next;
        throw new DiscoveryIntegrityError(
          "conflicting-historical-event",
          "A stable NEAR event identity was returned with changed content",
          incident,
        );
      }
      next.failures.delete(eventKey);
      if (!existing) {
        next.events.set(eventKey, {
          eventKey,
          event: commit.event,
          providerId: commit.providerId,
          canonicalPayloadHash: observedHash,
          firstObservedAtMs: commit.nowMs,
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
      blocks: new Map(state.blocks),
      incidents: new Map(state.incidents),
      recoveries: new Map(state.recoveries),
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
      if (
        discrepancy &&
        ["rpc-error", "event-view-mismatch", "payout-missing"].includes(
          discrepancy.kind,
        )
      ) {
        const [networkId, contractId] = parsePayoutKeyTuple(payoutKey);
        const incidentInput = {
          type: "reconciliation-failure" as const,
          networkId,
          contractId,
          blockHeight: null,
          eventKey: payoutKey,
          expected: null,
          observed: { message: discrepancy.message },
          actionRequired:
            "Retry the read-only contract view and preserve the last successful payout observation until the read succeeds.",
        };
        const id = incidentKey(incidentInput);
        const incident = buildIncident(
          incidentInput,
          discrepancy.createdAtMs,
          next.incidents.get(id),
        );
        next.incidents.set(id, incident);
      }
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
      const classification = errorKind(error) ?? "unknown";
      next.failures.set(failureKey, {
        failureKey,
        sourceKey,
        eventIdentity: event.identity,
        stage: "contract-view",
        classification,
        retryable: errorRetryable(error),
        attempts,
        nextRetryAtMs: errorRetryable(error)
          ? nowMs + Math.min(60_000, 1_000 * 2 ** Math.min(attempts - 1, 6))
          : nowMs,
        message:
          error instanceof Error
            ? error.message
            : "Unknown contract view failure",
        occurredAtMs: nowMs,
      });
      const incident = buildIncident(
        {
          type: "reconciliation-failure",
          networkId: event.identity.networkId,
          contractId: event.identity.contractId,
          blockHeight: event.identity.blockHeight,
          eventKey: failureKey,
          expected: null,
          observed: { classification, message: errorMessage(error) },
          actionRequired:
            "Recheck the read-only contract view and preserve the previous payout observation until the read succeeds.",
        },
        nowMs,
        next.incidents.get(
          JSON.stringify(["reconciliation-failure", failureKey]),
        ),
      );
      next.incidents.set(incident.incidentId, incident);
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
      const classification = errorKind(error) ?? "unknown";
      const retryable = errorRetryable(error);
      next.failures.set(failureKey, {
        failureKey,
        sourceKey,
        eventIdentity: null,
        stage: "event-source",
        classification,
        retryable,
        attempts,
        nextRetryAtMs: retryable
          ? nowMs + Math.min(60_000, 1_000 * 2 ** Math.min(attempts - 1, 6))
          : nowMs,
        message:
          error instanceof Error
            ? error.message
            : "Unknown event source failure",
        occurredAtMs: nowMs,
      });
      const incidentInput = providerIncidentInput(sourceKey, error);
      if (incidentInput) {
        const id = incidentKey(incidentInput);
        const incident = buildIncident(
          incidentInput,
          nowMs,
          next.incidents.get(id),
        );
        next.incidents.set(id, incident);
      }
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
    blocks: new Map(),
    incidents: new Map(),
    recoveries: new Map(),
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
    blocks: new Map(state.blocks),
    incidents: new Map(state.incidents),
    recoveries: new Map(state.recoveries),
    observations: new Map(state.observations),
    discrepancies: [...state.discrepancies],
    jobs: new Map(state.jobs),
    failures: new Map(state.failures),
    nextFencingTokens: new Map(state.nextFencingTokens),
  };
}

function serialize(state: FileState): SerializedState {
  return {
    version: 3,
    cursors: [...state.cursors],
    events: [...state.events],
    blocks: [...state.blocks],
    incidents: [...state.incidents],
    recoveries: [...state.recoveries],
    observations: [...state.observations],
    discrepancies: state.discrepancies,
    jobs: [...state.jobs],
    failures: [...state.failures],
    nextFencingTokens: [...state.nextFencingTokens],
  };
}

function deserialize(text: string): FileState {
  const value: unknown = JSON.parse(text);
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== 3)
  )
    throw new Error("Unsupported discovery file version");
  const cursors = stringMapFrom(value.cursors);
  if ([...cursors.values()].some((cursor) => !cursor.trim())) {
    throw new Error("Corrupt discovery repository cursor");
  }
  const nextFencingTokens = fencingMapFrom(value.nextFencingTokens);
  const events = mapFrom<string, IndexedEventRecord>(value.events);
  for (const [key, event] of events) {
    if (!event.providerId || !event.canonicalPayloadHash) {
      events.set(key, {
        ...event,
        providerId: event.providerId ?? "legacy-unknown",
        canonicalPayloadHash:
          event.canonicalPayloadHash ?? canonicalEventPayloadHash(event.event),
        firstObservedAtMs: event.firstObservedAtMs ?? event.processedAtMs,
      });
    }
  }
  return {
    cursors,
    events,
    blocks:
      value.version === 2 || value.version === 3
        ? mapFrom(value.blocks)
        : new Map(),
    incidents:
      value.version === 2 || value.version === 3
        ? mapFrom(value.incidents)
        : new Map(),
    recoveries:
      value.version === 2 || value.version === 3
        ? mapFrom(value.recoveries)
        : new Map(),
    observations: mapFrom(value.observations),
    discrepancies: arrayOf(value.discrepancies),
    jobs: jobsMapFrom(value.jobs),
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

function fencingMapFrom(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, item] of mapFrom<string, unknown>(value)) {
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item) || item < 0)
        throw new Error("Corrupt discovery repository fencing data");
      result.set(key, String(item));
      continue;
    }
    if (typeof item !== "string" || !/^\d+$/.test(item))
      throw new Error("Corrupt discovery repository fencing data");
    result.set(key, BigInt(item).toString());
  }
  return result;
}

function jobsMapFrom(value: unknown): Map<string, ExecutionJobRecord> {
  const jobs = new Map<string, ExecutionJobRecord>();
  for (const [key, item] of mapFrom<string, unknown>(value)) {
    if (!isRecord(item) || typeof item.version !== "number")
      throw new Error("Corrupt discovery repository job data");
    if (item.lease === null) {
      jobs.set(key, item as unknown as ExecutionJobRecord);
      continue;
    }
    if (
      !isRecord(item.lease) ||
      typeof item.lease.workerId !== "string" ||
      typeof item.lease.expiresAtMs !== "number"
    )
      throw new Error("Corrupt discovery repository lease data");
    const rawToken = item.lease.fencingToken;
    const fencingToken =
      typeof rawToken === "number" &&
      Number.isSafeInteger(rawToken) &&
      rawToken > 0
        ? String(rawToken)
        : typeof rawToken === "string" && /^\d+$/.test(rawToken)
          ? BigInt(rawToken).toString()
          : null;
    if (fencingToken === null)
      throw new Error("Corrupt discovery repository fencing token");
    const stateVersion =
      typeof item.lease.stateVersion === "number"
        ? item.lease.stateVersion
        : item.version;
    jobs.set(key, {
      ...item,
      lease: {
        ...item.lease,
        fencingToken,
        stateVersion,
      },
    } as unknown as ExecutionJobRecord);
  }
  return jobs;
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

export class DiscoveryIntegrityError extends Error {
  readonly kind: string;
  readonly incident: DiscoveryIncident;

  constructor(kind: string, message: string, incident: DiscoveryIncident) {
    super(message);
    this.name = "DiscoveryIntegrityError";
    this.kind = kind;
    this.incident = incident;
  }
}

export function canonicalEventPayloadHash(
  event: IndexedEventRecord["event"],
): string {
  let canonicalPayload = event.rawLog;
  if (event.rawLog.startsWith("EVENT_JSON:")) {
    try {
      const json = event.rawLog
        .slice("EVENT_JSON:".length)
        .replace(
          /("(?:payout_id|campaign_id)"\s*:\s*)(\d+)(?=\s*[,}])/g,
          (_match, prefix: string, digits: string) =>
            `${prefix}${JSON.stringify(digits)}`,
        );
      canonicalPayload = stableJson(JSON.parse(json) as unknown);
    } catch {
      // Preserve and hash malformed payload bytes exactly as observed.
    }
  }
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

function sameEventIdentity(
  left: IndexedEventRecord["event"],
  right: IndexedEventRecord["event"],
): boolean {
  return JSON.stringify(left.identity) === JSON.stringify(right.identity);
}

function sameBlockObservation(
  archived: ArchivedDiscoveryBlock,
  observed: DiscoveryBlockObservation,
): boolean {
  return (
    archived.networkId === observed.networkId &&
    archived.contractId === observed.contractId &&
    archived.blockHeight === observed.blockHeight &&
    archived.blockHash === observed.blockHash &&
    archived.parentBlockHash === observed.parentBlockHash &&
    archived.providerId === observed.providerId &&
    archived.contractReceiptCount === observed.contractReceiptCount &&
    archived.contractLogCount === observed.contractLogCount &&
    archived.canonicalPayloadHash === observed.canonicalPayloadHash
  );
}

function discoveryBlockKey(block: DiscoveryBlockObservation): string {
  return JSON.stringify([block.networkId, block.contractId, block.blockHeight]);
}

function incidentKey(
  incident: Pick<
    DiscoveryIncident,
    "type" | "networkId" | "contractId" | "blockHeight" | "eventKey"
  >,
): string {
  return JSON.stringify([
    incident.type,
    incident.networkId,
    incident.contractId,
    incident.blockHeight,
    incident.eventKey,
  ]);
}

function blockIncidentId(block: DiscoveryBlockObservation): string {
  return incidentKey({
    type: "conflicting-historical-block",
    networkId: block.networkId,
    contractId: block.contractId,
    blockHeight: block.blockHeight,
    eventKey: null,
  });
}

function buildIncident(
  input: Omit<
    DiscoveryIncident,
    "incidentId" | "detectedAtMs" | "lastSeenAtMs" | "occurrences" | "status"
  > & { readonly status?: DiscoveryIncident["status"] },
  nowMs: number,
  previous?: DiscoveryIncident,
  status: DiscoveryIncident["status"] = input.status ?? "open",
): DiscoveryIncident {
  const id = incidentKey(input);
  return {
    ...input,
    incidentId: id,
    detectedAtMs: previous?.detectedAtMs ?? nowMs,
    lastSeenAtMs: nowMs,
    occurrences: (previous?.occurrences ?? 0) + 1,
    status,
  };
}

function providerIncidentInput(
  sourceKey: string,
  error: unknown,
): Omit<
  DiscoveryIncident,
  "incidentId" | "detectedAtMs" | "lastSeenAtMs" | "occurrences" | "status"
> | null {
  const kind = errorKind(error);
  if (!kind) return null;
  const networkContract = parseSourceKey(sourceKey);
  const typeByKind: Readonly<Record<string, DiscoveryIncident["type"]>> = {
    timeout: "provider-outage",
    unavailable: "provider-outage",
    "rate-limited": "rate-limit",
    "missing-history": "missing-history",
    malformed: "malformed-provider-response",
    "block-continuity-failure": "block-continuity-failure",
    "network-mismatch": "network-mismatch",
    configuration: "network-mismatch",
    "cursor-corruption": "cursor-corruption",
    "conflicting-historical-block": "conflicting-historical-block",
    "conflicting-historical-event": "conflicting-historical-event",
  };
  const type = typeByKind[kind];
  if (!type) return null;
  const context = errorContext(error);
  const expectedValues = Object.fromEntries(
    Object.entries(context)
      .filter(([key]) => key.startsWith("expected"))
      .map(([key, value]) => [
        key
          .slice("expected".length)
          .replace(/^./u, (letter) => letter.toLowerCase()),
        value,
      ]),
  );
  const observedValues = Object.fromEntries(
    Object.entries(context)
      .filter(([key]) => key.startsWith("observed"))
      .map(([key, value]) => [
        key
          .slice("observed".length)
          .replace(/^./u, (letter) => letter.toLowerCase()),
        value,
      ]),
  );
  return {
    type,
    networkId: networkContract.networkId,
    contractId: networkContract.contractId,
    blockHeight:
      typeof context.blockHeight === "string" ? context.blockHeight : null,
    eventKey: null,
    expected:
      Object.keys(expectedValues).length > 0
        ? expectedValues
        : typeof context.blockHeight === "string"
          ? { blockHeight: context.blockHeight }
          : null,
    observed: {
      ...observedValues,
      classification: kind,
      message: errorMessage(error),
    },
    actionRequired: actionForIncident(type),
  };
}

function parseSourceKey(sourceKey: string): {
  networkId: string;
  contractId: string;
} {
  try {
    const parsed: unknown = JSON.parse(sourceKey);
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    )
      return { networkId: parsed[0], contractId: parsed[1] };
  } catch {
    // Recovery and custom source keys may not encode the tuple.
  }
  return { networkId: "unknown", contractId: "unknown" };
}

function parsePayoutKeyTuple(payoutKey: string): [string, string] {
  try {
    const value: unknown = JSON.parse(payoutKey);
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // Corrupt keys are recorded under unknown scope; never infer financial state from them.
  }
  return ["unknown", "unknown"];
}

function errorKind(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof error.kind === "string"
    ? error.kind
    : null;
}

function errorRetryable(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
    ? error.retryable
    : true;
}

function errorContext(error: unknown): Readonly<Record<string, unknown>> {
  return typeof error === "object" &&
    error !== null &&
    "context" in error &&
    isRecord(error.context)
    ? error.context
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown discovery failure";
}

function actionForIncident(type: DiscoveryIncident["type"]): string {
  switch (type) {
    case "provider-outage":
      return "Retry the read-only request after provider availability returns; keep the durable cursor unchanged.";
    case "rate-limit":
      return "Apply the documented provider rate limit and retry the same cursor.";
    case "missing-history":
      return "Stop at this height and verify provider retention or request an independent archive; do not skip the range.";
    case "malformed-provider-response":
      return "Stop ingestion and inspect the provider response schema without advancing the cursor.";
    case "block-continuity-failure":
      return "Stop ingestion and run a bounded historical rescan; require manual investigation if observations differ.";
    case "network-mismatch":
      return "Verify NEAR_NETWORK, the RPC chain ID, endpoint network, and contract account configuration.";
    case "conflicting-historical-block":
      return "Preserve both observations and require manual investigation before resuming.";
    case "conflicting-historical-event":
      return "Preserve both payloads and require manual investigation before resuming.";
    case "cursor-corruption":
      return "Preserve the repository and recover from its last known-good block after investigation.";
    case "archive-write-failure":
      return "Stop ingestion, verify local storage health and backups, then retry from the unchanged cursor.";
    case "reconciliation-failure":
      return "Retry the read-only NEAR payout view and retain the last valid observation.";
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
