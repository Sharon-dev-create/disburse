import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";
import {
  NearContractReader,
  HttpNearRpcTransport,
  NearRpcError,
  type NearRpcTransport,
} from "../src/near/rpc.ts";
import type { NearPayoutView } from "../src/near/clients.ts";
import { decodeNearEvent } from "../src/discovery/events.ts";
import { DurableFileDiscoveryRepository } from "../src/discovery/file-repository.ts";
import { PayoutDiscoveryProcessor } from "../src/discovery/processor.ts";
import { PayoutReconciler } from "../src/discovery/reconciler.ts";
import { MockNearEventSource } from "../src/discovery/source.ts";
import { makePayout, makeRawEvent } from "./support/near-fixtures.ts";

const config = {
  networkId: "testnet",
  contractId: "disburse.testnet",
  pageSize: 2,
};

void test("NEAR contract reader distinguishes missing payouts and preserves u64/u128 values", async () => {
  const payout = makePayout({
    id: "18446744073709551615",
    campaignId: "9007199254740993",
    inputAmount: {
      tokenId: { Near: "token.testnet" },
      atomicAmount: "340282366920938463463374607431768211455",
      decimals: 6,
    },
  });
  const rpc = new QueueRpc([nearJsonPayout(payout), null]);
  const reader = new NearContractReader(config, rpc);
  const found = await reader.getCampaignPayout("9007199254740993", payout.id);
  assert.equal(found?.id, "18446744073709551615");
  assert.equal(found?.campaignId, "9007199254740993");
  assert.equal(
    found?.inputAmount.atomicAmount,
    "340282366920938463463374607431768211455",
  );
  assert.equal(await reader.getPayout("42"), null);
  assert.equal(rpc.calls[0]?.contractId, config.contractId);
});

void test("NEAR HTTP transport sends exact numeric IDs and classifies timeout and RPC errors", async () => {
  const payout = nearJsonPayout(makePayout({ id: "18446744073709551615" }));
  const transport = new HttpNearRpcTransport(
    "https://rpc.test",
    1000,
    async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        params: { args_base64: string };
      };
      const args = Buffer.from(body.params.args_base64, "base64").toString(
        "utf8",
      );
      assert.equal(args, '{"payout_id":18446744073709551615}');
      const exactJson = JSON.stringify(payout).replace(
        '"id":"18446744073709551615"',
        '"id":18446744073709551615',
      );
      return Response.json({ result: { result: [...Buffer.from(exactJson)] } });
    },
  );
  const value = await transport.viewFunction(config.contractId, "get_payout", {
    payout_id: "__DISBURSE_U64_18446744073709551615__",
  });
  assert.equal((value as { id: string }).id, "18446744073709551615");

  const failed = new HttpNearRpcTransport("https://rpc.test", 1000, async () =>
    Response.json({ error: { code: -32000 } }),
  );
  await assert.rejects(
    failed.viewFunction(config.contractId, "get_payout", {}),
    (error: unknown) => error instanceof NearRpcError && error.kind === "rpc",
  );
  const timedOut = new HttpNearRpcTransport(
    "https://rpc.test",
    1,
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  await assert.rejects(
    timedOut.viewFunction(config.contractId, "get_payout", {}),
    (error: unknown) =>
      error instanceof NearRpcError && error.kind === "timeout",
  );
});

void test("contract reader rejects malformed payout data and invalid IDs without confusing RPC failures with absence", async () => {
  const malformed = new NearContractReader(config, new QueueRpc([{ id: 7 }]));
  await assert.rejects(
    malformed.getPayout("1"),
    /Payout view is not an object|Invalid/,
  );
  const rpcFailure = new NearContractReader(config, {
    viewFunction: async () => {
      throw new NearRpcError("unavailable", "offline");
    },
  });
  await assert.rejects(
    rpcFailure.getPayout("1"),
    (error: unknown) =>
      error instanceof NearRpcError && error.kind === "unavailable",
  );
  await assert.rejects(rpcFailure.getPayout("18446744073709551616"), /u64/);
  const wrongNetwork = new NearContractReader(config, {
    viewFunction: async () => null,
    getNetworkId: async () => "mainnet",
  });
  await assert.rejects(
    wrongNetwork.verifyNetwork(),
    /does not match RPC network/,
  );
});

void test("decoder handles known events, large IDs, unsupported versions, unknown names, and malformed known payloads", () => {
  const huge = makeRawEvent("payout_reserved", "cursor-large", 0, {
    payoutId: "18446744073709551615",
  });
  const hugeLog = huge.log.replace(
    '"payout_id":"18446744073709551615"',
    '"payout_id":18446744073709551615',
  );
  const decoded = decodeNearEvent({ ...huge, log: hugeLog });
  assert.equal(decoded.kind, "known");
  if (decoded.kind === "known")
    assert.equal(decoded.payoutId, "18446744073709551615");

  const unsupported = {
    ...makeRawEvent("payout_reserved", "cursor-version"),
    log: makeRawEvent("payout_reserved", "cursor-version").log.replace(
      '"version":"1.0.0"',
      '"version":"2.0.0"',
    ),
  };
  assert.equal(decodeNearEvent(unsupported).kind, "unknown");
  assert.equal(
    decodeNearEvent(makeRawEvent("future_event", "cursor-unknown")).kind,
    "unknown",
  );
  const malformed = makeRawEvent("payout_reserved", "cursor-malformed", 0, {
    fields: { input_amount: "not-an-amount" },
  });
  assert.equal(decodeNearEvent(malformed).kind, "malformed");
});

void test("multiple events in one transaction remain distinct and duplicate delivery creates one job", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disburse-discovery-"));
  try {
    const event = makeRawEvent("payout_reserved", "cursor-1", 0);
    const lifecycle = makeRawEvent(
      "payout_pending_verification",
      "cursor-2",
      1,
      {
        fields: {
          previous_status: "Executing",
          new_status: "PendingVerification",
          execution_reference: "exec-42",
        },
      },
    );
    const source = new MockNearEventSource([
      event,
      lifecycle,
      { ...event, cursor: "cursor-3" },
    ]);
    const repository = await DurableFileDiscoveryRepository.open(
      join(directory, "index.json"),
    );
    const reader = new MutableReader(
      makePayout({ status: "PendingVerification" }),
    );
    const processor = new PayoutDiscoveryProcessor(
      config,
      source,
      reader,
      repository,
    );
    const page1 = await processor.processNextPage(100);
    assert.equal(page1.processed, 2);
    assert.equal(page1.jobsCreated, 0); // current contract state is no longer Reserved
    const page2 = await processor.processNextPage(101);
    assert.equal(page2.processed, 1);
    assert.equal(page2.duplicates, 1);
    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.events.size, 2);
    assert.equal(snapshot.jobs.size, 0);
    assert.equal(
      snapshot.observations.values().next().value?.contractStatus,
      "PendingVerification",
    );
    assert.equal(
      await repository.getCursor(
        JSON.stringify([config.networkId, config.contractId]),
      ),
      "cursor-3",
    );
    const restarted = await DurableFileDiscoveryRepository.open(
      join(directory, "index.json"),
    );
    assert.equal((await restarted.getSnapshot()).events.size, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("reserved creation maps one job after event identity and contract data agree; lifecycle view is authoritative", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disburse-discovery-"));
  try {
    const events = [
      makeRawEvent("payout_reserved", "cursor-reserved", 0),
      makeRawEvent("payout_execution_started", "cursor-started", 1, {
        fields: {
          previous_status: "Reserved",
          new_status: "Executing",
          execution_reference: "exec-42",
        },
      }),
    ];
    const repository = await DurableFileDiscoveryRepository.open(
      join(directory, "index.json"),
    );
    const reader = new MutableReader(makePayout());
    const processor = new PayoutDiscoveryProcessor(
      { ...config, pageSize: 1 },
      new MockNearEventSource(events),
      reader,
      repository,
    );
    const first = await processor.processNextPage(100);
    assert.equal(first.jobsCreated, 1);
    reader.payout = makePayout({
      status: "Executing",
      executionReference: "exec-42",
    });
    await processor.processNextPage(101);
    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.jobs.size, 1);
    assert.equal(snapshot.events.size, 2);
    assert.equal(
      [...snapshot.jobs.values()][0]?.payout.contractStatus,
      "Reserved",
    );
    assert.equal(
      [...snapshot.observations.values()][0]?.contractStatus,
      "Executing",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("view failures do not advance the event cursor; persistence failure cannot commit the cursor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disburse-discovery-"));
  try {
    const event = makeRawEvent("payout_reserved", "cursor-fail");
    const repository = await DurableFileDiscoveryRepository.open(
      join(directory, "index.json"),
    );
    const failingReader = new MutableReader(makePayout());
    failingReader.error = new NearRpcError("timeout", "timed out");
    const processor = new PayoutDiscoveryProcessor(
      config,
      new MockNearEventSource([event]),
      failingReader,
      repository,
    );
    await assert.rejects(processor.processNextPage(100), /timed out/);
    assert.equal(
      await repository.getCursor(
        JSON.stringify([config.networkId, config.contractId]),
      ),
      null,
    );
    const failedState = await repository.getSnapshot();
    assert.equal(failedState.failures.size, 1);
    assert.equal([...failedState.failures.values()][0]?.retryable, true);

    let failCommit = true;
    const failedStore = await DurableFileDiscoveryRepository.open(
      join(directory, "atomic.json"),
      {
        beforeCommit: () => {
          if (failCommit) throw new Error("disk unavailable");
        },
      },
    );
    await assert.rejects(
      failedStore.commitEvent({
        sourceKey: "source",
        event: decodeNearEvent(event),
        observation: null,
        discrepancy: null,
        job: null,
        nextCursor: event.cursor,
        nowMs: 100,
      }),
      /disk unavailable/,
    );
    assert.equal(await failedStore.getCursor("source"), null);
    assert.equal((await failedStore.getSnapshot()).events.size, 0);
    failCommit = false;
    await failedStore.commitEvent({
      sourceKey: "source",
      event: decodeNearEvent(event),
      observation: null,
      discrepancy: null,
      job: null,
      nextCursor: event.cursor,
      nowMs: 101,
    });
    const restarted = await DurableFileDiscoveryRepository.open(
      join(directory, "atomic.json"),
    );
    assert.equal(await restarted.getCursor("source"), event.cursor);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("reconciliation refreshes stale observations and records missing or unavailable payouts without authorizing work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disburse-discovery-"));
  try {
    const event = decodeNearEvent(
      makeRawEvent("payout_reserved", "cursor-reconcile"),
    );
    const repository = await DurableFileDiscoveryRepository.open(
      join(directory, "index.json"),
    );
    await repository.commitEvent({
      sourceKey: "source",
      event,
      observation: {
        networkId: config.networkId,
        contractId: config.contractId,
        payoutId: "42",
        campaignId: "7",
        contractStatus: "Reserved",
        payout: makePayout(),
        observedAtMs: 100,
      },
      discrepancy: null,
      job: null,
      nextCursor: event.cursor,
      nowMs: 100,
    });
    const reader = new MutableReader(makePayout({ status: "ManualReview" }));
    const reconciler = new PayoutReconciler(
      config.networkId,
      config.contractId,
      reader,
      repository,
    );
    const result = await reconciler.reconcileKnownPayouts(200);
    assert.equal(result.changed, 1);
    const snapshot = await repository.getSnapshot();
    assert.equal(
      [...snapshot.observations.values()][0]?.contractStatus,
      "ManualReview",
    );
    assert.equal([...snapshot.discrepancies].at(-1)?.kind, "stale-observation");
    assert.equal(snapshot.jobs.size, 0);
    reader.payout = null;
    reader.error = null;
    assert.equal((await reconciler.reconcileKnownPayouts(300)).missing, 1);
    reader.error = new NearRpcError("unavailable", "node unavailable");
    assert.equal((await reconciler.reconcileKnownPayouts(400)).failed, 1);
    const latest = await repository.getSnapshot();
    assert.equal(latest.observations.size, 1); // RPC failure did not erase the last observed view.
    assert.equal(latest.discrepancies.at(-1)?.kind, "rpc-error");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("event source cursor resumes after its last delivered event and historical backfill is deterministic", async () => {
  const events = [
    makeRawEvent("future_event", "cursor-a"),
    makeRawEvent("future_event", "cursor-b", 1),
  ];
  const source = new MockNearEventSource(events);
  const page = await source.readFrom("cursor-a", 1);
  assert.equal(page.events[0]?.cursor, "cursor-a");
  assert.equal(page.hasMore, true);
  const next = await source.readAfter(page.nextCursor, 1);
  assert.equal(next.events[0]?.cursor, "cursor-b");
});

class QueueRpc implements NearRpcTransport {
  readonly calls: { contractId: string; methodName: string }[] = [];
  private readonly values: unknown[];
  constructor(values: unknown[]) {
    this.values = values;
  }
  async viewFunction(contractId: string, methodName: string): Promise<unknown> {
    this.calls.push({ contractId, methodName });
    const value = this.values.shift();
    if (value instanceof Error) throw value;
    return value;
  }
}

class MutableReader extends NearContractReader {
  payout: NearPayoutView | null;
  error: Error | null = null;
  constructor(payout: NearPayoutView | null) {
    super(config, {
      viewFunction: async () => null,
      getNetworkId: async () => config.networkId,
    });
    this.payout = payout;
  }
  override async getPayout(): Promise<NearPayoutView | null> {
    if (this.error) throw this.error;
    return this.payout;
  }
  override async getCampaignPayout(): Promise<NearPayoutView | null> {
    if (this.error) throw this.error;
    return this.payout;
  }
}

function nearJsonPayout(payout: NearPayoutView): unknown {
  const token = (amount: NearPayoutView["inputAmount"]) => ({
    token_id: amount.tokenId,
    atomic_amount: amount.atomicAmount,
    decimals: amount.decimals,
  });
  return {
    id: payout.id,
    campaign_id: payout.campaignId,
    recipient_near_account_id: payout.recipientNearAccountId,
    input_amount: token(payout.inputAmount),
    destination: {
      chain_id: payout.destination.chainId,
      recipient_address: payout.destination.recipientAddress,
    },
    expected_output_amount: token(payout.expectedOutputAmount),
    status: payout.status,
    created_at_ns: payout.createdAtNs,
    execution_reference: payout.executionReference,
    settlement_evidence_reference: payout.settlementEvidenceReference,
    lifecycle_reason: payout.lifecycleReason,
    failure_evidence: payout.failureEvidence,
    settlement_evidence: payout.settlementEvidence,
    resolution_evidence: payout.resolutionEvidence,
  };
}
