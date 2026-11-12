import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import {
  startExecutionApiServer,
  type ExecutionApiOptions,
} from "../src/api/http.ts";
import { NearRpcError, NearContractReader } from "../src/near/rpc.ts";
import type { NearRpcTransport } from "../src/near/rpc.ts";

const payout = {
  id: "7",
  campaign_id: "42",
  recipient_near_account_id: null,
  input_amount: {
    token_id: { Near: "wrap.testnet" },
    atomic_amount: "1000000",
    decimals: 6,
  },
  destination: {
    chain_id: "eip155:8453",
    recipient_address: "0x1234567890123456789012345678901234567890",
  },
  expected_output_amount: {
    token_id: { External: "0x0987654321098765432109876543210987654321" },
    atomic_amount: "990000",
    decimals: 6,
  },
  status: "Reserved",
  created_at_ns: "1730000000000000000",
  execution_reference: null,
  settlement_evidence_reference: null,
  lifecycle_reason: null,
  failure_evidence: null,
  settlement_evidence: null,
  resolution_evidence: [],
};

const accounting = {
  campaign_id: "42",
  budget: "10000",
  funded: "6000",
  reserved: "1000",
  spent: "2000",
  available: "3000",
};

class FixtureRpc implements NearRpcTransport {
  actualNetworkId = "testnet";
  payoutValue: unknown = payout;
  accountingValue: unknown = accounting;
  payoutError: NearRpcError | null = null;
  readonly calls: string[] = [];

  async getNetworkId(): Promise<string> {
    return this.actualNetworkId;
  }

  async viewFunction(
    contractId: string,
    methodName: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    assert.equal(contractId, "disburse.testnet");
    void args;
    this.calls.push(methodName);
    if (methodName === "is_paused") return false;
    if (methodName === "get_payout" && this.payoutError) {
      throw this.payoutError;
    }
    if (methodName === "get_payout" || methodName === "get_campaign_payout")
      return this.payoutValue;
    if (methodName === "get_campaign_payout_accounting")
      return this.accountingValue;
    throw new Error(`Unexpected contract view ${methodName}`);
  }
}

function createOptions(rpc: FixtureRpc): ExecutionApiOptions {
  return {
    reader: new NearContractReader(
      { networkId: "testnet", contractId: "disburse.testnet" },
      rpc,
    ),
    authorize: (request: IncomingMessage) =>
      request.headers.authorization === "Bearer test-api-token",
    now: () => new Date("2026-11-12T12:00:00.000Z"),
  };
}

async function withApi(
  options: ExecutionApiOptions,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await startExecutionApiServer(options, {
    host: "127.0.0.1",
    port: 0,
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function authorizedFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer test-api-token");
  return fetch(url, { ...init, headers });
}

void test("startup checks the configured RPC network and deployed contract ABI", async () => {
  const rpc = new FixtureRpc();
  const options = createOptions(rpc);
  const server = await startExecutionApiServer(options, {
    host: "127.0.0.1",
    port: 0,
  });
  assert.deepEqual(rpc.calls, ["is_paused"]);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  rpc.actualNetworkId = "mainnet";
  await assert.rejects(
    startExecutionApiServer(options, { host: "127.0.0.1", port: 0 }),
    (error: unknown) =>
      error instanceof NearRpcError && error.kind === "network-mismatch",
  );
});

void test("authenticated read routes return validated payout and accounting views", async () => {
  const rpc = new FixtureRpc();
  await withApi(createOptions(rpc), async (baseUrl) => {
    const payoutResponse = await authorizedFetch(`${baseUrl}/v1/payouts/7`);
    assert.equal(payoutResponse.status, 200);
    assert.equal(payoutResponse.headers.get("cache-control"), "no-store");
    const payoutBody = await payoutResponse.json();
    assert.equal(payoutBody.data.networkId, "testnet");
    assert.equal(payoutBody.data.payout.campaignId, "42");
    assert.equal(payoutBody.data.payout.status, "Reserved");
    assert.equal(payoutBody.data.payout.source.atomicAmount, "1000000");
    assert.equal(payoutBody.data.payout.destination.networkId, "eip155:8453");
    assert.equal(
      payoutBody.data.payout.destination.expectedAtomicAmount,
      "990000",
    );
    assert.equal(payoutBody.data.payout.destinationTransactionHash, undefined);
    assert.equal(payoutBody.meta.readAt, "2026-11-12T12:00:00.000Z");

    const campaignPayoutResponse = await authorizedFetch(
      `${baseUrl}/v1/campaigns/42/payouts/7`,
    );
    assert.equal(campaignPayoutResponse.status, 200);

    const accountingResponse = await authorizedFetch(
      `${baseUrl}/v1/campaigns/42/accounting`,
    );
    assert.equal(accountingResponse.status, 200);
    const accountingBody = await accountingResponse.json();
    assert.deepEqual(accountingBody.data.accounting, {
      campaignId: "42",
      budget: "10000",
      funded: "6000",
      reserved: "1000",
      spent: "2000",
      available: "3000",
    });
  });
});

void test("unauthorized callers cannot read contract state; liveness is non-sensitive", async () => {
  const rpc = new FixtureRpc();
  await withApi(createOptions(rpc), async (baseUrl) => {
    rpc.calls.splice(0);
    const unauthorized = await fetch(`${baseUrl}/v1/payouts/7`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");
    assert.deepEqual(rpc.calls, []);

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.deepEqual(rpc.calls, []);
  });
});

void test("invalid identifiers and unsupported methods are rejected", async () => {
  await withApi(createOptions(new FixtureRpc()), async (baseUrl) => {
    for (const id of ["-1", "01", "18446744073709551616", "abc"]) {
      const response = await authorizedFetch(`${baseUrl}/v1/payouts/${id}`);
      assert.equal(response.status, 400, id);
      assert.equal((await response.json()).error.code, "invalid_request");
    }

    const post = await authorizedFetch(`${baseUrl}/v1/payouts/7`, {
      method: "POST",
    });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET");

    const query = await authorizedFetch(
      `${baseUrl}/v1/payouts/7?include=evidence`,
    );
    assert.equal(query.status, 400);
  });
});

void test("missing records are distinct from malformed and unavailable RPC responses", async () => {
  const rpc = new FixtureRpc();
  await withApi(createOptions(rpc), async (baseUrl) => {
    rpc.payoutValue = null;
    const missingPayout = await authorizedFetch(`${baseUrl}/v1/payouts/7`);
    assert.equal(missingPayout.status, 404);
    assert.equal((await missingPayout.json()).error.code, "payout_not_found");

    rpc.accountingValue = null;
    const missingCampaign = await authorizedFetch(
      `${baseUrl}/v1/campaigns/42/accounting`,
    );
    assert.equal(missingCampaign.status, 404);
    assert.equal(
      (await missingCampaign.json()).error.code,
      "campaign_not_found",
    );

    rpc.payoutValue = { malformed: true };
    const malformed = await authorizedFetch(`${baseUrl}/v1/payouts/7`);
    assert.equal(malformed.status, 502);
    assert.equal((await malformed.json()).error.code, "near_rpc_failure");

    rpc.payoutError = new NearRpcError("timeout", "fixture timeout");
    const unavailable = await authorizedFetch(`${baseUrl}/v1/payouts/7`);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, "near_rpc_failure");
  });
});

void test("invalid contract response schemas and accounting invariants fail closed", async () => {
  const rpc = new FixtureRpc();
  await withApi(createOptions(rpc), async (baseUrl) => {
    rpc.payoutValue = {
      ...payout,
      destination: {
        ...payout.destination,
        recipient_address: "not-an-address",
      },
    };
    const invalidAddress = await authorizedFetch(`${baseUrl}/v1/payouts/7`);
    assert.equal(invalidAddress.status, 502);
    assert.equal(
      (await invalidAddress.json()).error.code,
      "invalid_contract_response",
    );

    rpc.accountingValue = { ...accounting, available: "3001" };
    const invalidAccounting = await authorizedFetch(
      `${baseUrl}/v1/campaigns/42/accounting`,
    );
    assert.equal(invalidAccounting.status, 502);
    assert.equal(
      (await invalidAccounting.json()).error.code,
      "invalid_contract_response",
    );
  });
});
