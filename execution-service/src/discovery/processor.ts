import {
  validatePayoutSnapshot,
  type ExecutionJobKey,
  type PayoutReservedEvent,
  type PayoutSnapshot,
} from "../domain/payout.ts";
import type { ContractReader, NearPayoutView } from "../near/clients.ts";
import type { ExecutionJobRecord } from "../persistence/repository.ts";
import {
  decodeNearEvent,
  type DecodedNearEvent,
  type DecodedPayoutEvent,
} from "./events.ts";
import type {
  DiscoveryDiscrepancy,
  DiscoveryObservation,
  DiscoveryRepository,
} from "./repository.ts";
import type { NearEventSource } from "./source.ts";
import { PayoutReconciler } from "./reconciler.ts";

export interface DiscoveryProcessorConfig {
  readonly networkId: string;
  readonly contractId: string;
  readonly pageSize?: number;
}

export interface DiscoveryRunResult {
  readonly processed: number;
  readonly duplicates: number;
  readonly jobsCreated: number;
  readonly unknownEvents: number;
  readonly malformedEvents: number;
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

/** Ingests replayable source events, confirms them against final contract views, and commits cursor + data atomically. */
export class PayoutDiscoveryProcessor {
  private readonly sourceKey: string;
  private readonly pageSize: number;
  private readonly config: DiscoveryProcessorConfig;
  private readonly source: NearEventSource;
  private readonly reader: ContractReader;
  private readonly repository: DiscoveryRepository;

  constructor(
    config: DiscoveryProcessorConfig,
    source: NearEventSource,
    reader: ContractReader,
    repository: DiscoveryRepository,
  ) {
    this.config = config;
    this.source = source;
    this.reader = reader;
    this.repository = repository;
    if (!config.networkId.trim() || !config.contractId.trim()) {
      throw new Error(
        "Discovery network and contract identifiers are required",
      );
    }
    this.sourceKey = JSON.stringify([config.networkId, config.contractId]);
    this.pageSize = config.pageSize ?? 100;
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize <= 0) {
      throw new Error("Discovery page size must be a positive safe integer");
    }
  }

  async processNextPage(nowMs: number): Promise<DiscoveryRunResult> {
    await this.repository.assertSourceReady(
      this.config.networkId,
      this.config.contractId,
    );
    await this.verifyNetwork(nowMs);
    const savedCursor = await this.repository.getCursor(this.sourceKey);
    let page: Awaited<ReturnType<NearEventSource["readAfter"]>>;
    try {
      page = await this.source.readAfter(savedCursor, this.pageSize);
    } catch (error) {
      await this.repository.recordSourceFailure(this.sourceKey, error, nowMs);
      throw error;
    }
    await this.repository.clearSourceFailure(this.sourceKey);
    return this.processPage(this.sourceKey, savedCursor, page, nowMs);
  }

  /** Starts or resumes a named historical backfill stream independently of live ingestion. */
  async backfillFrom(
    startPosition: string,
    nowMs: number,
  ): Promise<DiscoveryRunResult> {
    if (!startPosition.trim())
      throw new Error("Historical start position is required");
    await this.verifyNetwork(nowMs);
    await this.repository.assertSourceReady(
      this.config.networkId,
      this.config.contractId,
    );
    const backfillKey = JSON.stringify([
      this.config.networkId,
      this.config.contractId,
      "backfill",
      startPosition,
    ]);
    const savedCursor = await this.repository.getCursor(backfillKey);
    let page: Awaited<ReturnType<NearEventSource["readAfter"]>>;
    try {
      page =
        savedCursor === null
          ? await this.source.readFrom(startPosition, this.pageSize)
          : await this.source.readAfter(savedCursor, this.pageSize);
    } catch (error) {
      await this.repository.recordSourceFailure(backfillKey, error, nowMs);
      throw error;
    }
    await this.repository.clearSourceFailure(backfillKey);
    return this.processPage(backfillKey, savedCursor, page, nowMs);
  }

  /** Replays a bounded historical block range without creating or deleting execution jobs. */
  async recoverRange(
    startBlockHeight: string,
    endBlockHeight: string,
    nowMs: number,
  ): Promise<DiscoveryRunResult> {
    if (
      !/^\d+$/.test(startBlockHeight) ||
      !/^\d+$/.test(endBlockHeight) ||
      BigInt(endBlockHeight) < BigInt(startBlockHeight)
    ) {
      throw new Error("Recovery block range is invalid");
    }
    await this.verifyNetwork(nowMs);
    const recoverySnapshot = await this.repository.getSnapshot();
    const previousRecoveries = [...recoverySnapshot.recoveries.values()]
      .filter(
        (item) =>
          item.networkId === this.config.networkId &&
          item.contractId === this.config.contractId &&
          item.startBlockHeight === startBlockHeight &&
          item.endBlockHeight === endBlockHeight &&
          item.status !== "validated",
      )
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
    const existingRecovery = previousRecoveries[0];
    let recoveryId = existingRecovery?.recoveryId;
    if (recoveryId === undefined) {
      let attempt = 0;
      do {
        recoveryId = JSON.stringify([
          this.config.networkId,
          this.config.contractId,
          startBlockHeight,
          endBlockHeight,
          nowMs,
          attempt,
        ]);
        attempt += 1;
      } while (recoverySnapshot.recoveries.has(recoveryId));
    }
    const recoverySourceKey = JSON.stringify([
      this.config.networkId,
      this.config.contractId,
      "recovery",
      recoveryId,
    ]);
    const recovery = await this.repository.startRecovery({
      recoveryId,
      networkId: this.config.networkId,
      contractId: this.config.contractId,
      startBlockHeight,
      endBlockHeight,
      startedAtMs: nowMs,
    });
    let cursor = await this.repository.getCursor(recoverySourceKey);
    let processed = 0;
    let duplicates = 0;
    let unknownEvents = 0;
    let malformedEvents = 0;
    let blocksChecked = recovery.blocksChecked;
    let eventsChecked = recovery.eventsChecked;
    try {
      let hasMore = true;
      while (hasMore) {
        const page = await this.source.readRange(
          startBlockHeight,
          endBlockHeight,
          cursor,
          this.pageSize,
        );
        await this.repository.clearSourceFailure(recoverySourceKey);
        if (page.nextCursor === cursor && page.hasMore)
          throw new Error("Recovery source did not advance its cursor");
        const result = await this.processPage(
          recoverySourceKey,
          cursor,
          page,
          nowMs,
          false,
        );
        cursor = result.cursor;
        processed += result.processed;
        duplicates += result.duplicates;
        unknownEvents += result.unknownEvents;
        malformedEvents += result.malformedEvents;
        blocksChecked += page.blocks.length;
        eventsChecked += page.events.length;
        hasMore = page.hasMore;
        await this.repository.updateRecovery(recoveryId, {
          status: "running",
          updatedAtMs: nowMs,
          cursor,
          blocksChecked,
          eventsChecked,
          summary:
            "Historical page archived and reconciled against current NEAR views",
        });
      }
      const reconciliation = await new PayoutReconciler(
        this.config.networkId,
        this.config.contractId,
        this.reader,
        this.repository,
      ).reconcileKnownPayouts(nowMs);
      const validated =
        reconciliation.failed === 0 && reconciliation.missing === 0;
      if (validated)
        await this.repository.resolveIncidentsInRange(
          this.config.networkId,
          this.config.contractId,
          startBlockHeight,
          endBlockHeight,
          nowMs,
        );
      await this.repository.updateRecovery(recoveryId, {
        status: validated ? "validated" : "conflict",
        updatedAtMs: nowMs,
        cursor,
        blocksChecked,
        eventsChecked,
        summary: validated
          ? `Historical range validated; ${reconciliation.checked} known payouts reconciled against current contract views`
          : `Investigation required: reconciliation reported ${reconciliation.failed} failures and ${reconciliation.missing} missing payouts`,
      });
      return {
        processed,
        duplicates,
        jobsCreated: 0,
        unknownEvents,
        malformedEvents,
        cursor,
        hasMore: false,
      };
    } catch (error) {
      await this.repository.recordSourceFailure(
        recoverySourceKey,
        error,
        nowMs,
      );
      await this.repository.updateRecovery(recoveryId, {
        status: isIntegrityError(error) ? "conflict" : "unavailable",
        updatedAtMs: nowMs,
        cursor: await this.repository.getCursor(recoverySourceKey),
        blocksChecked,
        eventsChecked,
        summary:
          error instanceof Error
            ? error.message
            : "Historical recovery failed; investigation required",
      });
      throw error;
    }
  }

  private async verifyNetwork(nowMs: number): Promise<void> {
    if (
      "verifyNetwork" in this.reader &&
      typeof this.reader.verifyNetwork === "function"
    ) {
      try {
        await this.reader.verifyNetwork();
      } catch (error) {
        await this.repository.recordSourceFailure(
          JSON.stringify([this.config.networkId, this.config.contractId]),
          error,
          nowMs,
        );
        throw error;
      }
    }
  }

  private async processPage(
    sourceKey: string,
    savedCursor: string | null,
    page: Awaited<ReturnType<NearEventSource["readAfter"]>>,
    nowMs: number,
    allowJobCreation = true,
  ): Promise<DiscoveryRunResult> {
    if (page.nextCursor !== null && !page.nextCursor.trim())
      throw new Error("Event source returned an invalid page cursor");
    if (page.events.length > 0 && page.nextCursor === null)
      throw new Error("Event source returned events without a page cursor");
    if (page.events.length > this.pageSize)
      throw new Error("Event source exceeded the requested page size");
    try {
      validateBlockObservations(
        page.blocks,
        this.config,
        this.source.providerId,
      );
      await this.repository.archiveBlocks(page.blocks, nowMs);
    } catch (error) {
      if (!isIntegrityError(error)) {
        try {
          await this.repository.recordIncident(
            {
              type: "archive-write-failure",
              networkId: this.config.networkId,
              contractId: this.config.contractId,
              blockHeight: null,
              eventKey: null,
              expected: "Durable block archive commit",
              observed: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unknown archive write failure",
              },
              actionRequired:
                "Stop ingestion, preserve the last durable cursor, verify local storage and backups, then retry after the archive is writable.",
            },
            nowMs,
          );
        } catch {
          // A failed archive store may also prevent recording its own incident.
        }
      }
      await this.repository.recordSourceFailure(sourceKey, error, nowMs);
      throw error;
    }
    let duplicates = 0;
    let jobsCreated = 0;
    let unknownEvents = 0;
    let malformedEvents = 0;
    for (const raw of page.events) {
      const decoded = decodeNearEvent(raw);
      if (decoded.kind === "unknown") unknownEvents += 1;
      if (decoded.kind === "malformed") malformedEvents += 1;
      const result = await this.processDecoded(
        decoded,
        sourceKey,
        nowMs,
        allowJobCreation,
      );
      if (result.duplicate) duplicates += 1;
      if (result.jobCreated) jobsCreated += 1;
    }
    if (page.nextCursor !== null && page.nextCursor !== savedCursor)
      await this.repository.commitCursor(sourceKey, page.nextCursor);
    const cursor = page.nextCursor ?? savedCursor;
    return {
      processed: page.events.length,
      duplicates,
      jobsCreated,
      unknownEvents,
      malformedEvents,
      cursor,
      hasMore: page.hasMore,
    };
  }

  private async processDecoded(
    event: DecodedNearEvent,
    sourceKey: string,
    nowMs: number,
    allowJobCreation: boolean,
  ): Promise<{ readonly duplicate: boolean; readonly jobCreated: boolean }> {
    const identity = event.identity;
    if (
      typeof event.cursor !== "string" ||
      !event.cursor.trim() ||
      typeof event.rawLog !== "string" ||
      typeof identity.networkId !== "string" ||
      !identity.networkId.trim() ||
      typeof identity.contractId !== "string" ||
      !identity.contractId.trim() ||
      typeof identity.blockHeight !== "string" ||
      !/^\d+$/.test(identity.blockHeight) ||
      BigInt(identity.blockHeight) > 18_446_744_073_709_551_615n ||
      typeof identity.blockHash !== "string" ||
      !identity.blockHash.trim() ||
      typeof identity.transactionHash !== "string" ||
      !identity.transactionHash.trim() ||
      typeof identity.receiptId !== "string" ||
      !identity.receiptId.trim() ||
      !Number.isSafeInteger(identity.eventIndex) ||
      identity.eventIndex < 0
    ) {
      const error = new Error(
        "Event source returned an invalid identity, log, or cursor",
      );
      await this.repository.recordSourceFailure(sourceKey, error, nowMs);
      throw error;
    }
    if (
      identity.networkId !== this.config.networkId ||
      identity.contractId !== this.config.contractId
    ) {
      const error = Object.assign(
        new Error(
          "Event source identity does not match configured NEAR network or contract",
        ),
        {
          kind: "network-mismatch",
          retryable: false,
          context: {
            expectedNetworkId: this.config.networkId,
            observedNetworkId: identity.networkId,
            expectedContractId: this.config.contractId,
            observedContractId: identity.contractId,
            blockHeight: identity.blockHeight,
          },
        },
      );
      await this.repository.recordSourceFailure(sourceKey, error, nowMs);
      throw error;
    }
    if (event.kind !== "known") {
      if (event.kind === "malformed") {
        const error = Object.assign(new Error(event.reason), {
          kind: "malformed",
          retryable: false,
          context: {
            blockHeight: event.identity.blockHeight,
            eventIdentity: event.identity,
          },
        });
        await this.repository.recordIncident(
          {
            type: "malformed-provider-response",
            networkId: identity.networkId,
            contractId: identity.contractId,
            blockHeight: identity.blockHeight,
            eventKey: JSON.stringify([
              identity.blockHash,
              identity.transactionHash,
              identity.receiptId,
              identity.eventIndex,
            ]),
            expected: "A well-formed recognized Disburse event",
            observed: { reason: event.reason, rawLog: event.rawLog },
            actionRequired:
              "Preserve the cursor and raw log. Inspect the event and contract version before resuming.",
          },
          nowMs,
        );
        await this.repository.recordSourceFailure(sourceKey, error, nowMs);
        throw error;
      }
      const commit = await this.repository.commitEvent({
        sourceKey,
        providerId: this.source.providerId,
        event,
        observation: null,
        discrepancy: {
          kind: event.kind === "unknown" ? "unknown-event" : "malformed-event",
          message: event.reason,
          createdAtMs: nowMs,
        },
        job: null,
        nextCursor: event.cursor,
        nowMs,
      });
      return { duplicate: commit.duplicate, jobCreated: false };
    }

    let payout: NearPayoutView | null;
    try {
      if (event.name === "payout_reserved") {
        payout = await this.reader.getCampaignPayout(
          event.campaignId,
          event.payoutId,
        );
        if (!payout) payout = await this.reader.getPayout(event.payoutId);
      } else {
        payout = await this.reader.getPayout(event.payoutId);
      }
    } catch (error) {
      await this.repository.recordFailure(event, sourceKey, error, nowMs);
      throw error;
    }
    const discrepancy = this.compareEventAndView(event, payout, nowMs);
    const observation =
      payout &&
      payout.id === event.payoutId &&
      payout.campaignId === event.campaignId
        ? toObservation(identity.networkId, identity.contractId, payout, nowMs)
        : null;
    const job =
      allowJobCreation &&
      event.name === "payout_reserved" &&
      payout &&
      payout.status === "Reserved" &&
      !discrepancy
        ? makeJob(event, payout, nowMs)
        : null;
    const committed = await this.repository.commitEvent({
      sourceKey,
      providerId: this.source.providerId,
      event,
      observation,
      discrepancy:
        discrepancy ??
        (event.name === "payout_reserved" && payout?.status !== "Reserved"
          ? {
              kind: "non-executable-status",
              message: `Payout is currently ${payout?.status ?? "missing"}; no execution job was created`,
              createdAtMs: nowMs,
            }
          : null),
      job,
      nextCursor: event.cursor,
      nowMs,
    });
    return {
      duplicate: committed.duplicate,
      jobCreated: job !== null && !committed.duplicate,
    };
  }

  private compareEventAndView(
    event: DecodedPayoutEvent,
    payout: NearPayoutView | null,
    nowMs: number,
  ): DiscoveryDiscrepancy | null {
    if (!payout)
      return {
        kind: "payout-missing",
        message:
          "A finalized payout event references no payout in the contract view",
        createdAtMs: nowMs,
      };
    if (
      payout.id !== event.payoutId ||
      payout.campaignId !== event.campaignId
    ) {
      return {
        kind: "event-view-mismatch",
        message: "Event payout/campaign identity disagrees with contract view",
        createdAtMs: nowMs,
      };
    }
    if (event.name === "payout_reserved") {
      const inputToken = tokenPayload(payout.inputAmount);
      const outputToken = tokenPayload(payout.expectedOutputAmount);
      if (
        inputToken !== event.fields.input_token_id ||
        payout.inputAmount.atomicAmount !== event.fields.input_amount ||
        outputToken !== event.fields.expected_output_token_id ||
        payout.expectedOutputAmount.atomicAmount !==
          event.fields.expected_output_amount
      ) {
        return {
          kind: "event-view-mismatch",
          message:
            "Reservation event amounts or token identities disagree with contract view",
          createdAtMs: nowMs,
        };
      }
    }
    return null;
  }
}

function isIntegrityError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("name" in error && error.name === "DiscoveryIntegrityError") return true;
  return (
    "kind" in error &&
    typeof error.kind === "string" &&
    [
      "block-continuity-failure",
      "network-mismatch",
      "cursor-corruption",
      "malformed",
    ].includes(error.kind)
  );
}

function validateBlockObservations(
  blocks: Awaited<ReturnType<NearEventSource["readAfter"]>>["blocks"],
  config: DiscoveryProcessorConfig,
  providerId: string,
): void {
  let previous: (typeof blocks)[number] | undefined;
  for (const block of blocks) {
    const height = /^\d+$/.test(block.blockHeight)
      ? BigInt(block.blockHeight)
      : -1n;
    if (
      block.networkId !== config.networkId ||
      block.contractId !== config.contractId ||
      block.providerId !== providerId ||
      height < 0n ||
      !block.blockHash.trim() ||
      !block.parentBlockHash.trim() ||
      !Number.isSafeInteger(block.contractReceiptCount) ||
      block.contractReceiptCount < 0 ||
      !Number.isSafeInteger(block.contractLogCount) ||
      block.contractLogCount < 0 ||
      !/^[a-f0-9]{64}$/i.test(block.canonicalPayloadHash)
    ) {
      throw Object.assign(
        new Error("Event source returned invalid or mismatched block metadata"),
        {
          kind: "network-mismatch",
          retryable: false,
          context: {
            blockHeight: block.blockHeight,
            networkId: block.networkId,
            contractId: block.contractId,
            providerId: block.providerId,
          },
        },
      );
    }
    if (
      previous &&
      (height !== BigInt(previous.blockHeight) + 1n ||
        block.parentBlockHash !== previous.blockHash)
    ) {
      throw Object.assign(
        new Error("Event source block page is not height/hash contiguous"),
        {
          kind: "block-continuity-failure",
          retryable: false,
          context: {
            blockHeight: block.blockHeight,
            expectedBlockHeight: (BigInt(previous.blockHeight) + 1n).toString(),
            expectedParentHash: previous.blockHash,
            observedParentHash: block.parentBlockHash,
          },
        },
      );
    }
    previous = block;
  }
}

function makeJob(
  event: DecodedPayoutEvent,
  view: NearPayoutView,
  nowMs: number,
): ExecutionJobRecord {
  const payout: PayoutSnapshot = {
    payoutId: view.id,
    campaignId: view.campaignId,
    inputAmount: mapAmount(view.inputAmount),
    destinationChainId: view.destination.chainId,
    recipientAddress: view.destination.recipientAddress,
    expectedOutput: mapAmount(view.expectedOutputAmount),
    contractStatus: "Reserved",
    executionReference: view.executionReference,
    settlementEvidenceReference: view.settlementEvidenceReference,
  };
  validatePayoutSnapshot(payout);
  const key: ExecutionJobKey = {
    networkId: event.identity.networkId,
    contractId: event.identity.contractId,
    payoutId: payout.payoutId,
  };
  const reservedEvent: PayoutReservedEvent = {
    event: "payout_reserved",
    payoutId: event.payoutId,
    campaignId: event.campaignId,
    contractStatus: "Reserved",
    identity: {
      networkId: event.identity.networkId,
      contractId: event.identity.contractId,
      blockHeight: event.identity.blockHeight,
      blockHash: event.identity.blockHash,
      transactionHash: event.identity.transactionHash,
      receiptId: event.identity.receiptId,
      eventIndex: event.identity.eventIndex,
    },
  };
  return {
    key,
    payout,
    discoveryEvent: reservedEvent.identity,
    state: "Discovered",
    version: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    lease: null,
    attempts: [],
  };
}

function mapAmount(
  amount: NearPayoutView["inputAmount"],
): PayoutSnapshot["inputAmount"] {
  const tokenId =
    "Near" in amount.tokenId ? amount.tokenId.Near : amount.tokenId.External;
  return {
    tokenId,
    atomicAmount: amount.atomicAmount,
    decimals: amount.decimals,
  };
}

function tokenPayload(amount: NearPayoutView["inputAmount"]): string {
  return "Near" in amount.tokenId
    ? amount.tokenId.Near
    : amount.tokenId.External;
}

function toObservation(
  networkId: string,
  contractId: string,
  payout: NearPayoutView,
  nowMs: number,
): DiscoveryObservation {
  return {
    networkId,
    contractId,
    payoutId: payout.id,
    campaignId: payout.campaignId,
    contractStatus: payout.status,
    payout,
    observedAtMs: nowMs,
  };
}
