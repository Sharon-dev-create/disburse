import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { loadExecutionHostConfig } from "../src/host/config.ts";
import { startExecutionHost } from "../src/host/server.ts";
import { NearContractReader, type NearRpcTransport } from "../src/near/rpc.ts";
import type { PostgresJobRepository } from "../src/persistence/postgres-job-repository.ts";

const baseEnv = {
  DISBURSE_API_HOST: "127.0.0.1",
  DISBURSE_API_PORT: "0",
  DISBURSE_POSTGRES_TARGET: "development",
  DISBURSE_DEV_DATABASE_URL:
    "postgresql://disburse_dev:secret@127.0.0.1:5432/disburse_dev",
  NEAR_NETWORK: "testnet",
  NEAR_RPC_ENDPOINT: "https://rpc.testnet.near.org",
  DISBURSE_CONTRACT_ID: "disburse.testnet",
  DISBURSE_EXECUTION_API_DEMO_TOKEN: "demo-token-123456",
} as const;

function fakePool(): Pool {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => undefined,
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => undefined,
    }),
  } as unknown as Pool;
}

class Rpc implements NearRpcTransport {
  async getNetworkId(): Promise<string> {
    return "testnet";
  }
  async viewFunction(
    _contractId: string,
    methodName: string,
  ): Promise<unknown> {
    if (methodName === "is_paused") return true;
    if (methodName === "get_campaign_payout_accounting") {
      return {
        campaign_id: "42",
        budget: "1000",
        funded: "1000",
        reserved: "0",
        spent: "0",
        available: "1000",
      };
    }
    if (methodName === "ft_metadata") return { decimals: 6 };
    if (methodName === "get_campaign_funding") {
      return {
        campaign_id: "42",
        token_id: "wrap.testnet",
        budget: "1000",
        funded: "1000",
        remaining_budget: "0",
      };
    }
    return null;
  }
}

void test("host composes API routes with demo-token auth and read-only contract reads", async () => {
  const config = loadExecutionHostConfig({ ...baseEnv });
  const host = await startExecutionHost(config, {
    dependencies: {
      createPool: () => fakePool(),
      applyMigrations: async () => ({ applied: [] }),
      createJobsRepository: () =>
        ({
          getByPayout: async () => null,
          listByCampaign: async () => [],
        }) as unknown as PostgresJobRepository,
      createTransport: () => new Rpc(),
      createReader: (_config, transport) =>
        new NearContractReader(
          { networkId: "testnet", contractId: "disburse.testnet" },
          transport,
        ),
    },
  });

  try {
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;

    const unauthorized = await fetch(`${base}/v1/campaigns/42/accounting`);
    assert.equal(unauthorized.status, 401);

    const wrong = await fetch(`${base}/v1/campaigns/42/accounting`, {
      headers: { authorization: "Bearer wrong-token-123456" },
    });
    assert.equal(wrong.status, 401);

    const ok = await fetch(`${base}/v1/campaigns/42/accounting`, {
      headers: { authorization: "Bearer demo-token-123456" },
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.data.accounting.campaignId, "42");
    assert.equal(body.data.accounting.tokenId, "wrap.testnet");
  } finally {
    await host.close();
  }
});
