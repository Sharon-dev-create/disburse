import {
  validatePayoutSnapshot,
  type ExecutionJobKey,
  type PayoutReservedEvent,
  type PayoutSnapshot,
} from "../domain/payout.ts";
import type { ContractReader, NearPayoutView } from "../near/clients.ts";
import type { ExecutionJobRecord } from "../persistence/repository.ts";
import { decodeNearEvent, type DecodedNearEvent, type DecodedPayoutEvent } from "./events.ts";
import type { DiscoveryDiscrepancy, DiscoveryObservation, DiscoveryRepository } from "./repository.ts";
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
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

/** Ingests replayable source events, confirms them against final contract views, and commits cursor + data atomically. */
export class PayoutDiscoveryProcessor {
  private readonly sourceKey: string;
  private readonly pageSize: number;

  constructor(
    private readonly config: DiscoveryProcessorConfig,
    private readonly source: NearEventSource,
    private readonly reader: ContractReader,
    private readonly repository: DiscoveryRepository,
  ) {
    if (!config.networkId.trim() || !config.contractId.trim()) {
      throw new Error("Discovery network and contract identifiers are required");
    }
    this.sourceKey = JSON.stringify([config.networkId, config.contractId]);
    this.pageSize = config.pageSize ?? 100;
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize <= 0) {
      throw new Error("Discovery page size must be a positive safe integer");
    }
  }

  async processNextPage(nowMs: number): Promise<DiscoveryRunResult> {
    const savedCursor = await this.repository.getCursor(this.sourceKey);
    const page = await this.source.readAfter(savedCursor, this.pageSize);
    if (page.events.length === 0 && page.nextCursor !== null && page.nextCursor !== savedCursor) {
      throw new Error("Event source advanced a cursor without returning events");
    }
    if (page.events.length > this.pageSize) throw new Error("Event source exceeded the requested page size");
    let duplicates = 0;
    let jobsCreated = 0;
    for (const raw of page.events) {
      const decoded = decodeNearEvent(raw);
      const result = await this.processDecoded(decoded, nowMs);
      if (result.duplicate) duplicates += 1;
      if (result.jobCreated) jobsCreated += 1;
    }
    const cursor = page.events.at(-1)?.cursor ?? savedCursor;
    return {
      processed: page.events.length,
      duplicates,
      jobsCreated,
      cursor,
      hasMore: page.hasMore,
    };
  }

  private async processDecoded(
    event: DecodedNearEvent,
    nowMs: number,
  ): Promise<{ readonly duplicate: boolean; readonly jobCreated: boolean }> {
    const identity = event.identity;
    if (
      identity.networkId !== this.config.networkId ||
      identity.contractId !== this.config.contractId ||
      !/^[0-9]+$/.test(identity.blockHeight) ||
      !identity.blockHash.trim() ||
      !identity.transactionHash.trim() ||
      !identity.receiptId.trim() ||
      !Number.isSafeInteger(identity.eventIndex) ||
      identity.eventIndex < 0 ||
      !event.cursor.trim()
    ) {
      const commit = await this.repository.commitEvent({
        sourceKey: this.sourceKey,
        event,
        observation: null,
        discrepancy: { kind: "event-identity-mismatch", message: "Event source identity does not match configured NEAR network/contract or is incomplete", createdAtMs: nowMs },
        job: null,
        nextCursor: event.cursor,
        nowMs,
      });
      return { duplicate: commit.duplicate, jobCreated: false };
    }
    if (event.kind !== "known") {
      const commit = await this.repository.commitEvent({
        sourceKey: this.sourceKey,
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
    if (event.name === "payout_reserved") {
      payout = await this.reader.getCampaignPayout(event.campaignId, event.payoutId);
    } else {
      payout = await this.reader.getPayout(event.payoutId);
    }
    const discrepancy = this.compareEventAndView(event, payout, nowMs);
    const observation = payout && payout.id === event.payoutId && payout.campaignId === event.campaignId
      ? toObservation(identity.networkId, identity.contractId, payout, nowMs)
      : null;
    const job = event.name === "payout_reserved" && payout && payout.status === "Reserved" && !discrepancy
      ? makeJob(event, payout, nowMs)
      : null;
    const committed = await this.repository.commitEvent({
      sourceKey: this.sourceKey,
      event,
      observation,
      discrepancy: discrepancy ?? (event.name === "payout_reserved" && payout?.status !== "Reserved"
        ? { kind: "non-executable-status", message: `Payout is currently ${payout?.status ?? "missing"}; no execution job was created`, createdAtMs: nowMs }
        : null),
      job,
      nextCursor: event.cursor,
      nowMs,
    });
    return { duplicate: committed.duplicate, jobCreated: job !== null && !committed.duplicate };
  }

  private compareEventAndView(
    event: DecodedPayoutEvent,
    payout: NearPayoutView | null,
    nowMs: number,
  ): DiscoveryDiscrepancy | null {
    if (!payout) return { kind: "payout-missing", message: "A finalized payout event references no payout in the contract view", createdAtMs: nowMs };
    if (payout.id !== event.payoutId || payout.campaignId !== event.campaignId) {
      return { kind: "event-view-mismatch", message: "Event payout/campaign identity disagrees with contract view", createdAtMs: nowMs };
    }
    if (event.name === "payout_reserved") {
      const inputToken = tokenPayload(payout.inputAmount);
      const outputToken = tokenPayload(payout.expectedOutputAmount);
      if (
        inputToken !== event.fields.input_token_id ||
        payout.inputAmount.atomicAmount !== event.fields.input_amount ||
        outputToken !== event.fields.expected_output_token_id ||
        payout.expectedOutputAmount.atomicAmount !== event.fields.expected_output_amount
      ) {
        return { kind: "event-view-mismatch", message: "Reservation event amounts or token identities disagree with contract view", createdAtMs: nowMs };
      }
    }
    return null;
  }
}

function makeJob(event: DecodedPayoutEvent, view: NearPayoutView, nowMs: number): ExecutionJobRecord {
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

function mapAmount(amount: NearPayoutView["inputAmount"]): PayoutSnapshot["inputAmount"] {
  const variant = "Near" in amount.tokenId ? "Near" : "External";
  const tokenId = amount.tokenId[variant];
  return { tokenId, atomicAmount: amount.atomicAmount, decimals: amount.decimals };
}

function tokenPayload(amount: NearPayoutView["inputAmount"]): string {
  return "Near" in amount.tokenId ? amount.tokenId.Near : amount.tokenId.External;
}

function toObservation(networkId: string, contractId: string, payout: NearPayoutView, nowMs: number): DiscoveryObservation {
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
