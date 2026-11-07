import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FastNearNearDataEventSource,
  NearDataProviderError,
  type FastNearNearDataConfig,
} from "../src/near/providers/fastnear-neardata.ts";
import { decodeNearEvent } from "../src/discovery/events.ts";
import { DurableFileDiscoveryRepository } from "../src/discovery/file-repository.ts";
import { PayoutDiscoveryProcessor } from "../src/discovery/processor.ts";
import { makeRawEvent } from "./support/near-fixtures.ts";
import { makePayout } from "./support/near-fixtures.ts";

const config: FastNearNearDataConfig = {
  network: "testnet",
  contractId: "disburse.testnet",
  startBlockHeight: "10",
  endpoint: "https://fixture.invalid",
  retryAttempts: 1,
};

void test("FastNear source filters by executor, keeps receipt identity, and decodes through NEP-297", async () => {
  const source = new FastNearNearDataEventSource(config, async (input) => {
    const url = String(input);
    return jsonResponse(
      url.endsWith("last_block/final")
        ? block(10, "hash-10", "hash-9", [
            execution("disburse.testnet", "receipt-1", "tx-1", [reservedLog]),
            execution("other.testnet", "receipt-other", "tx-other", [
              reservedLog,
            ]),
          ])
        : block(10, "hash-10", "hash-9", [
            execution("disburse.testnet", "receipt-1", "tx-1", [reservedLog]),
            execution("other.testnet", "receipt-other", "tx-other", [
              reservedLog,
            ]),
          ]),
    );
  });

  const page = await source.readFrom("10", 10);
  assert.equal(page.events.length, 1);
  assert.equal(page.hasMore, false);
  assert.equal(page.events[0]?.identity.receiptId, "receipt-1");
  assert.equal(page.events[0]?.identity.transactionHash, "tx-1");
  assert.equal(page.events[0]?.identity.blockHash, "hash-10");
  assert.equal(page.events[0]?.identity.eventIndex, 0);
  assert.match(page.events[0]?.log ?? "", /^EVENT_JSON:/);
  assert.equal(page.events[0] && decodeNearEvent(page.events[0]).kind, "known");
  assert.match(page.events[0]?.cursor ?? "", /^near-data:v1:/);
  assert.deepEqual(source.getDiagnostics(), {
    network: "testnet",
    contractId: "disburse.testnet",
    startBlockHeight: "10",
    connected: true,
    finalityPolicy: "finalized-only",
    reorgRetractions: "not-supported",
    lastObservedBlock: "10",
    lastFinalizedBlockHeight: "10",
    lastPageCursor: page.nextCursor,
    eventsRetrieved: 1,
    blocksScanned: 1,
    pagesRead: 1,
    requests: 2,
    lastSuccessfulPollAtMs: source.getDiagnostics().lastSuccessfulPollAtMs,
  });
});

void test("all nine supported payout lifecycle event names remain decodable", () => {
  const statuses: Readonly<Record<string, string>> = {
    payout_reserved: "Reserved",
    payout_execution_started: "Executing",
    payout_pending_verification: "PendingVerification",
    payout_execution_failed: "Failed",
    payout_manual_review: "ManualReview",
    payout_settled: "Succeeded",
    failed_payout_reservation_released: "ReservationReleased",
    manual_review_execution_confirmed: "PendingVerification",
    manual_review_non_settlement_confirmed: "ReservationReleased",
  };
  const common = {
    payout_id: 42,
    campaign_id: 7,
    actor_id: "operator.testnet",
    verifier_id: "verifier.testnet",
    previous_status: "Executing",
    new_status: "Succeeded",
    input_token_id: "token.testnet",
    input_amount: "100",
    expected_output_token_id: "erc20:0x123",
    expected_output_amount: "90",
    status: "Reserved",
    execution_reference: "exec-42",
    evidence_reference: "evidence-42",
    reason: "reviewed",
    failure_kind: "RejectedBeforeSubmission",
    resolution_outcome: "NonSettlementConfirmed",
    released_input_amount: "100",
    destination_chain_id: "evm:1",
    provider_id: "provider",
    execution_id: "execution-42",
    output_token_id: "erc20:0x123",
    recipient_address: "0x123",
    actual_output_amount: "80",
    content_hash: "hash-42",
    input_amount_moved_to_spent: "100",
  };

  for (const [event, newStatus] of Object.entries(statuses)) {
    const raw = makeRawEvent(event, `cursor-${event}`);
    const log = `EVENT_JSON:${JSON.stringify({
      standard: "disburse",
      version: "1.0.0",
      event,
      data: [{ ...common, new_status: newStatus }],
    })}`;
    const decoded = decodeNearEvent({ ...raw, log });
    assert.equal(decoded.kind, "known", `${event} should decode`);
  }
});

void test("FastNear receipt logs pass through discovery and require a matching Reserved contract view", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disburse-fastnear-"));
  try {
    const payload = block(10, "hash-10", "hash-9", [
      execution("disburse.testnet", "receipt-1", "tx-1", [reservedLog]),
    ]);
    const source = new FastNearNearDataEventSource(
      { ...config, maxBlocksPerPage: 1 },
      async () => jsonResponse(payload),
    );
    const reader = {
      getPayout: async () => makePayout(),
      getCampaignPayout: async () => null,
      getPayoutByIdempotency: async () => null,
      getCampaignPayoutAccounting: async () => null,
      isPaused: async () => false,
      hasRole: async () => true,
    };
    const repository = await DurableFileDiscoveryRepository.open(
      join(directory, "index.json"),
    );
    const processor = new PayoutDiscoveryProcessor(
      { networkId: "testnet", contractId: "disburse.testnet", pageSize: 10 },
      source,
      reader,
      repository,
    );

    const result = await processor.processNextPage(100);
    const snapshot = await repository.getSnapshot();
    assert.equal(result.processed, 1);
    assert.equal(result.jobsCreated, 1);
    assert.equal(snapshot.events.size, 1);
    assert.equal(snapshot.jobs.size, 1);
    assert.equal([...snapshot.jobs.values()][0]?.key.payoutId, "42");
    assert.equal(
      [...snapshot.observations.values()][0]?.contractStatus,
      "Reserved",
    );
    assert.equal(
      await repository.getCursor(
        JSON.stringify(["testnet", "disburse.testnet"]),
      ),
      result.cursor,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("FastNear source paginates within a receipt and resumes from the opaque cursor", async () => {
  const fetchImpl: typeof fetch = async () => {
    return jsonResponse(
      block(10, "hash-10", "hash-9", [
        execution("disburse.testnet", "receipt-1", "tx-1", [
          reservedLog,
          "log-2",
        ]),
      ]),
    );
  };
  const source = new FastNearNearDataEventSource(config, fetchImpl);
  const first = await source.readFrom("10", 1);
  assert.equal(first.events.length, 1);
  assert.equal(first.hasMore, true);
  assert.equal(first.events[0]?.identity.eventIndex, 0);

  const second = await source.readAfter(first.nextCursor, 1);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0]?.identity.eventIndex, 1);
  assert.equal(second.events[0]?.log, "log-2");
  assert.equal(second.hasMore, false);
});

void test("empty finalized ranges advance a durable block cursor", async () => {
  const source = new FastNearNearDataEventSource(
    { ...config, maxBlocksPerPage: 2 },
    async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("last_block/final"))
        return jsonResponse(block(12, "hash-12", "hash-11", []));
      const height = Number(path.split("/").at(-1));
      return jsonResponse(
        block(height, `hash-${height}`, `hash-${height - 1}`, []),
      );
    },
  );

  const page = await source.readFrom("10", 1);
  assert.equal(page.events.length, 0);
  assert.equal(page.hasMore, true);
  assert.notEqual(page.nextCursor, null);
  const next = await source.readAfter(page.nextCursor, 1);
  assert.equal(next.events.length, 0);
  assert.equal(next.hasMore, false);
});

void test("resuming a partially read block rejects a changed finalized block hash", async () => {
  let changed = false;
  const source = new FastNearNearDataEventSource(config, async (input) => {
    const path = new URL(String(input)).pathname;
    const hash =
      changed && path.endsWith("/10") ? "replacement-hash-10" : "hash-10";
    return jsonResponse(
      block(10, hash, "hash-9", [
        ...(changed && path.endsWith("/10")
          ? []
          : [
              execution("disburse.testnet", "receipt-1", "tx-1", [
                reservedLog,
                "log-2",
              ]),
            ]),
      ]),
    );
  });
  const first = await source.readFrom("10", 1);
  changed = true;
  await assert.rejects(
    source.readAfter(first.nextCursor, 1),
    (error: unknown) =>
      error instanceof NearDataProviderError &&
      error.kind === "network-mismatch",
  );
});

void test("provider retries rate limits with bounded backoff and validates response metadata", async () => {
  let calls = 0;
  const source = new FastNearNearDataEventSource(
    { ...config, retryAttempts: 2 },
    async () => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 429 });
      return jsonResponse(block(10, "hash-10", "hash-9", []));
    },
  );
  const page = await source.readFrom("10", 1);
  assert.equal(page.events.length, 0);
  assert.equal(calls, 3); // the head request is retried once

  const malformed = new FastNearNearDataEventSource(config, async () =>
    jsonResponse(
      block(10, "hash-10", "hash-9", [
        {
          execution_outcome: {
            id: "receipt",
            block_hash: "hash-10",
            outcome: { executor_id: "disburse.testnet", logs: [] },
          },
        },
      ]),
    ),
  );
  await assert.rejects(
    malformed.readFrom("10", 1),
    (error: unknown) =>
      error instanceof NearDataProviderError && error.kind === "malformed",
  );
});

void test("provider rejects timeouts, malformed JSON, and block/network mismatches without advancing", async () => {
  const timeout = new FastNearNearDataEventSource(
    { ...config, timeoutMs: 5 },
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  await assert.rejects(
    timeout.readFrom("10", 1),
    (error: unknown) =>
      error instanceof NearDataProviderError && error.kind === "timeout",
  );

  const invalidJson = new FastNearNearDataEventSource(
    config,
    async () => new Response("not json", { status: 200 }),
  );
  await assert.rejects(
    invalidJson.readFrom("10", 1),
    (error: unknown) =>
      error instanceof NearDataProviderError && error.kind === "malformed",
  );

  const mismatch = new FastNearNearDataEventSource(config, async () =>
    jsonResponse(block(11, "hash-11", "hash-10", [])),
  );
  await assert.rejects(
    mismatch.readFrom("10", 1),
    (error: unknown) =>
      error instanceof NearDataProviderError &&
      error.kind === "network-mismatch",
  );

  const missingShardOutcomes = new FastNearNearDataEventSource(
    config,
    async () =>
      jsonResponse({
        block: { header: { height: 10, hash: "hash-10", prev_hash: "hash-9" } },
        shards: [{ shard_id: 0 }],
      }),
  );
  await assert.rejects(
    missingShardOutcomes.readFrom("10", 1),
    (error: unknown) =>
      error instanceof NearDataProviderError && error.kind === "malformed",
  );
});

const reservedLog = `EVENT_JSON:${JSON.stringify({
  standard: "disburse",
  version: "1.0.0",
  event: "payout_reserved",
  data: [
    {
      payout_id: 42,
      campaign_id: 7,
      actor_id: "operator.testnet",
      input_token_id: "token.testnet",
      input_amount: "100",
      expected_output_token_id: "erc20:0x123",
      expected_output_amount: "90",
      status: "Reserved",
    },
  ],
})}`;

function block(
  height: number,
  hash: string,
  prevHash: string,
  outcomes: unknown[],
): unknown {
  return {
    block: { header: { height, hash, prev_hash: prevHash } },
    shards: [
      {
        shard_id: 0,
        receipt_execution_outcomes: outcomes,
      },
    ],
  };
}

function execution(
  executorId: string,
  receiptId: string,
  txHash: string,
  logs: readonly string[],
): unknown {
  return {
    tx_hash: txHash,
    execution_outcome: {
      id: receiptId,
      block_hash: "hash-10",
      outcome: { executor_id: executorId, logs },
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
