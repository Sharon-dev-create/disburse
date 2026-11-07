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
    await this.verifyNetwork();
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
    await this.verifyNetwork();
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

  private async verifyNetwork(): Promise<void> {
    if (
      "verifyNetwork" in this.reader &&
      typeof this.reader.verifyNetwork === "function"
    ) {
      await this.reader.verifyNetwork();
    }
  }

  private async processPage(
    sourceKey: string,
    savedCursor: string | null,
    page: Awaited<ReturnType<NearEventSource["readAfter"]>>,
    nowMs: number,
  ): Promise<DiscoveryRunResult> {
    if (page.nextCursor !== null && !page.nextCursor.trim())
      throw new Error("Event source returned an invalid page cursor");
    if (page.events.length > 0 && page.nextCursor === null)
      throw new Error("Event source returned events without a page cursor");
    if (page.events.length > this.pageSize)
      throw new Error("Event source exceeded the requested page size");
    let duplicates = 0;
    let jobsCreated = 0;
    let unknownEvents = 0;
    let malformedEvents = 0;
    for (const raw of page.events) {
      const decoded = decodeNearEvent(raw);
      if (decoded.kind === "unknown") unknownEvents += 1;
      if (decoded.kind === "malformed") malformedEvents += 1;
      const result = await this.processDecoded(decoded, sourceKey, nowMs);
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
      const commit = await this.repository.commitEvent({
        sourceKey,
        event,
        observation: null,
        discrepancy: {
          kind: "event-identity-mismatch",
          message:
            "Event source identity does not match configured NEAR network/contract or is incomplete",
          createdAtMs: nowMs,
        },
        job: null,
        nextCursor: event.cursor,
        nowMs,
      });
      return { duplicate: commit.duplicate, jobCreated: false };
    }
    if (event.kind !== "known") {
      const commit = await this.repository.commitEvent({
        sourceKey,
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
      event.name === "payout_reserved" &&
      payout &&
      payout.status === "Reserved" &&
      !discrepancy
        ? makeJob(event, payout, nowMs)
        : null;
    const committed = await this.repository.commitEvent({
      sourceKey,
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
