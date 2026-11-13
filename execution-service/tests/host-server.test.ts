import assert from "node:assert/strict";
import net from "node:net";
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

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function fakePool(): { pool: Pool; ended: { value: boolean } } {
  const ended = { value: false };
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => {
      ended.value = true;
    },
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => undefined,
    }),
  } as unknown as Pool;
  return { pool, ended };
}

class FixtureTransport implements NearRpcTransport {
  readonly networkId: string;
  readonly paused: boolean | Error;

  constructor(networkId: string, paused: boolean | Error = true) {
    this.networkId = networkId;
    this.paused = paused;
  }

  async getNetworkId(): Promise<string> {
    return this.networkId;
  }

  async viewFunction(): Promise<unknown> {
    if (this.paused instanceof Error) throw this.paused;
    return this.paused;
  }
}

void test("host startup fails when PostgreSQL is unavailable", async () => {
  const port = await freePort();
  const config = loadExecutionHostConfig({
    ...baseEnv,
    DISBURSE_DEV_DATABASE_URL: `postgresql://disburse_dev:secret@127.0.0.1:${port}/disburse_dev`,
  });
  await assert.rejects(
    startExecutionHost(config),
    /PostgreSQL startup failed; connection details are redacted\./,
  );
});

void test("host startup fails when NEAR readiness checks fail", async () => {
  const config = loadExecutionHostConfig({ ...baseEnv });
  const { pool, ended } = fakePool();

  await assert.rejects(
    startExecutionHost(config, {
      dependencies: {
        createPool: () => pool,
        applyMigrations: async () => ({ applied: [] }),
        createJobsRepository: () =>
          ({
            getByPayout: async () => null,
            listByCampaign: async () => [],
          }) as unknown as PostgresJobRepository,
        createTransport: () => new FixtureTransport("mainnet"),
      },
    }),
    (error: unknown) =>
      error instanceof Error && /RPC network ID|network/i.test(error.message),
  );
  assert.equal(ended.value, true);

  const { pool: pool2, ended: ended2 } = fakePool();
  await assert.rejects(
    startExecutionHost(config, {
      dependencies: {
        createPool: () => pool2,
        applyMigrations: async () => ({ applied: [] }),
        createJobsRepository: () =>
          ({
            getByPayout: async () => null,
            listByCampaign: async () => [],
          }) as unknown as PostgresJobRepository,
        createTransport: () => new FixtureTransport("testnet", false),
      },
    }),
    /must be paused for read-only host startup/,
  );
  assert.equal(ended2.value, true);
});

void test("host starts with valid dependencies and shuts down gracefully", async () => {
  const config = loadExecutionHostConfig({ ...baseEnv });
  const { pool, ended } = fakePool();
  const host = await startExecutionHost(config, {
    dependencies: {
      createPool: () => pool,
      applyMigrations: async () => ({ applied: ["0001"] }),
      createJobsRepository: () =>
        ({
          getByPayout: async () => null,
          listByCampaign: async () => [],
        }) as unknown as PostgresJobRepository,
      createTransport: () => new FixtureTransport("testnet", true),
      createReader: (_config, transport) =>
        new NearContractReader(
          { networkId: "testnet", contractId: "disburse.testnet" },
          transport,
        ),
    },
  });

  const address = host.server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  assert.equal(response.status, 200);

  await host.close();
  await host.close();
  assert.equal(ended.value, true);
  assert.equal(host.server.listening, false);
});
