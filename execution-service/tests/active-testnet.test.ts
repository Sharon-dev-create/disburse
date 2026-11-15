import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { ACTIVE_TESTNET } from "../src/near/active-testnet.ts";
import {
  NearContractReader,
  HttpNearRpcTransport,
  type NearRpcTransport,
} from "../src/near/rpc.ts";
import { loadExecutionHostConfig } from "../src/host/config.ts";
import { startExecutionApiServer } from "../src/api/http.ts";
import { startExecutionHost } from "../src/host/server.ts";
import type { PostgresJobRepository } from "../src/persistence/postgres-job-repository.ts";
const env = {
  DISBURSE_API_PORT: "0",
  DISBURSE_POSTGRES_TARGET: "development",
  DISBURSE_DEV_DATABASE_URL:
    "postgresql://disburse_dev:secret@127.0.0.1/disburse_dev",
  NEAR_NETWORK: "testnet",
  NEAR_RPC_ENDPOINT: "https://rpc.testnet.near.org",
  DISBURSE_CONTRACT_ID: ACTIVE_TESTNET.contractId,
  DISBURSE_EXECUTION_API_DEMO_TOKEN: "active-read-only-test-token",
  DISBURSE_ACTIVE_TESTNET_READ_ONLY: "true",
};
class Rpc implements NearRpcTransport {
  network = "testnet";
  codeHash: string = ACTIVE_TESTNET.codeHash;
  owner: string = ACTIVE_TESTNET.ownerId;
  accepted: unknown = true;
  operator: unknown = true;
  paused: unknown = false;
  calls: string[] = [];
  async getNetworkId() {
    return this.network;
  }
  async getCodeHash() {
    return this.codeHash;
  }
  async viewFunction(_c: string, m: string) {
    this.calls.push(m);
    switch (m) {
      case "get_owner":
        return this.owner;
      case "is_paused":
        return this.paused;
      case "get_campaign_count":
        return 0;
      case "is_accepted_token":
        return this.accepted;
      case "has_role":
        return this.operator;
      case "get_payout":
      case "get_campaign_payout_accounting":
      case "get_campaign_funding":
        return null;
      default:
        throw Error("Unexpected operation " + m);
    }
  }
}
const reader = (rpc: Rpc) =>
  new NearContractReader(
    { networkId: "testnet", contractId: ACTIVE_TESTNET.contractId },
    rpc,
  );
const auth = { authorization: "Bearer token" };
void test("restricted mode is explicit, pinned, strict and local only", () => {
  assert.equal(loadExecutionHostConfig({ ...env }).activeTestnetReadOnly, true);
  assert.equal(
    loadExecutionHostConfig({
      ...env,
      DISBURSE_ACTIVE_TESTNET_READ_ONLY: undefined,
    }).activeTestnetReadOnly,
    false,
  );
  assert.equal(
    loadExecutionHostConfig({
      ...env,
      DISBURSE_ACTIVE_TESTNET_READ_ONLY: "false",
    }).activeTestnetReadOnly,
    false,
  );
  for (const patch of [
    { DISBURSE_ACTIVE_TESTNET_READ_ONLY: "1" },
    { DISBURSE_ACTIVE_TESTNET_READ_ONLY: "" },
    { NEAR_NETWORK: "mainnet", DISBURSE_CONTRACT_ID: "disburse.near" },
    { DISBURSE_CONTRACT_ID: "disburse-topg.testnet" },
    { DISBURSE_CONTRACT_ID: "" },
    { NODE_ENV: "production" },
    { DISBURSE_API_HOST: "0.0.0.0" },
  ])
    assert.throws(() => loadExecutionHostConfig({ ...env, ...patch }));
});
void test("default rejects active contract; restricted startup fails closed on live mismatch", async () => {
  await assert.rejects(
    startExecutionApiServer(
      { reader: reader(new Rpc()), authorize: () => true },
      { port: 0, host: "127.0.0.1" },
    ),
    /must be paused/,
  );
  for (const patch of [
    { network: "mainnet" },
    { codeHash: "wrong" },
    { owner: "wrong.testnet" },
    { accepted: false },
    { operator: false },
    { paused: "false" },
  ]) {
    await assert.rejects(
      startExecutionApiServer(
        {
          reader: reader(Object.assign(new Rpc(), patch)),
          authorize: () => true,
          activeTestnetReadOnly: true,
        },
        { port: 0, host: "127.0.0.1" },
      ),
    );
  }
  await assert.rejects(
    startExecutionApiServer(
      {
        reader: new NearContractReader(
          { networkId: "testnet", contractId: "disburse-topg.testnet" },
          new Rpc(),
        ),
        authorize: () => true,
        activeTestnetReadOnly: true,
      },
      { port: 0 },
    ),
    /isolated/,
  );
});
void test("authenticated allowlisted reads work and blocked operations have no database or transaction effects", async () => {
  const rpc = new Rpc();
  let dbReads = 0;
  const server = await startExecutionApiServer(
    {
      reader: reader(rpc),
      activeTestnetReadOnly: true,
      authorize: (req) => req.headers.authorization === auth.authorization,
      jobs: {
        getByPayout: async () => {
          dbReads++;
          return null;
        },
        listByCampaign: async () => {
          dbReads++;
          return [];
        },
      },
    },
    { port: 0, host: "127.0.0.1" },
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/v1/contract")).status, 401);
    const result = await fetch(base + "/v1/contract", { headers: auth });
    assert.equal(result.status, 200);
    const body = (await result.json()) as {
      data: { contractId: string; campaignCount: string; payoutCount: string };
    };
    assert.equal(body.data.contractId, ACTIVE_TESTNET.contractId);
    assert.equal(body.data.campaignCount, "0");
    assert.equal(body.data.payoutCount, "0");
    assert.equal(
      (await fetch(base + "/v1/payouts/0", { headers: auth })).status,
      404,
    );
    for (const path of [
      "/v1/campaigns",
      "/v1/payouts/0/execute",
      "/v1/payouts/0/retry",
      "/v1/refunds",
      "/v1/authorizations",
      "/admin",
      "/v1/queue",
    ])
      for (const method of ["POST", "GET", "DELETE"]) {
        const blocked = await fetch(base + path, { method, headers: auth });
        assert.equal(blocked.status, 403);
        assert.equal(
          ((await blocked.json()) as { error: { code: string } }).error.code,
          "read_only_mode",
        );
      }
    assert.equal(dbReads, 0);
    rpc.codeHash = "changed";
    assert.equal(
      (await fetch(base + "/v1/contract", { headers: auth })).status,
      500,
    );
    assert.ok(
      rpc.calls.every((m) =>
        [
          "get_owner",
          "is_paused",
          "get_campaign_count",
          "is_accepted_token",
          "has_role",
          "get_payout",
        ].includes(m),
      ),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
void test("restricted host checks migrations without applying them and exposes only repository reads", async () => {
  let migrationChecks = 0;
  let migrated = false;
  let writes = 0;
  const pool = {
    query: async (sql: string) => {
      assert.equal(sql, "SELECT 1");
      return { rows: [] };
    },
    end: async () => {},
  } as unknown as Pool;
  const jobs = new Proxy(
    { getByPayout: async () => null, listByCampaign: async () => [] },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        writes++;
        throw Error("Mutation capability requested");
      },
    },
  );
  const host = await startExecutionHost(loadExecutionHostConfig(env), {
    dependencies: {
      createPool: () => pool,
      assertMigrations: async () => {
        migrationChecks++;
      },
      applyMigrations: async () => {
        migrated = true;
        throw Error("Must not migrate");
      },
      createJobsRepository: () => jobs as unknown as PostgresJobRepository,
      createTransport: () => new Rpc(),
    },
  });
  await host.close();
  assert.equal(migrationChecks, 1);
  assert.equal(migrated, false);
  assert.equal(writes, 0);
});
void test("code query uses finalized account RPC and rejects errors", async () => {
  let params: unknown;
  const transport = new HttpNearRpcTransport(
    "https://rpc.testnet.near.org",
    100,
    async (_url, init) => {
      params = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ result: { code_hash: ACTIVE_TESTNET.codeHash } }),
      );
    },
  );
  assert.equal(
    await transport.getCodeHash(ACTIVE_TESTNET.contractId),
    ACTIVE_TESTNET.codeHash,
  );
  assert.deepEqual((params as { params: unknown }).params, {
    request_type: "view_account",
    finality: "final",
    account_id: ACTIVE_TESTNET.contractId,
  });
  await assert.rejects(
    new HttpNearRpcTransport(
      "https://rpc.testnet.near.org",
      100,
      async () => new Response("{}", { status: 429 }),
    ).getCodeHash(ACTIVE_TESTNET.contractId),
  );
});
