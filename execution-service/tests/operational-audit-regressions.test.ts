import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { inspect } from "node:util";
import { test } from "node:test";
import type { Pool } from "pg";
import { NearRpcError } from "../src/near/errors.ts";
import {
  HttpNearRpcTransport,
  type NearContractReader,
} from "../src/near/rpc.ts";
import {
  TestnetInspector,
  TIDEPOOL,
  tokenMetadata,
} from "../src/near/recipient-preflight.ts";
import { loadExecutionHostConfig } from "../src/host/config.ts";
import { startExecutionHost } from "../src/host/server.ts";
import { startExecutionApiServer } from "../src/api/http.ts";
const canary = "AUDIT_SECRET_TOKEN",
  secretUrl = `https://rpc.invalid/${canary}?api_key=${canary}`,
  hash = "8".repeat(44);
const config = loadExecutionHostConfig({
  DISBURSE_API_PORT: "0",
  DISBURSE_POSTGRES_TARGET: "test",
  DISBURSE_TEST_DATABASE_URL:
    "postgresql://disburse_test@127.0.0.1:19549/disburse_test",
  NEAR_NETWORK: "testnet",
  NEAR_RPC_ENDPOINT: "http://fixture",
  DISBURSE_CONTRACT_ID: "audit.testnet",
  DISBURSE_EXECUTION_API_DEMO_TOKEN: "local-audit-only-token",
});
async function localServer(
  handler: RequestListener,
  work: (url: string) => Promise<void>,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const a = server.address();
    assert.ok(a && typeof a !== "string");
    await work(`http://127.0.0.1:${a.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const dependencies = () => ({
  createPool: () =>
    ({
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    }) as unknown as Pool,
  applyMigrations: async () => ({ applied: [] }),
});
for (const kind of ["network-mismatch", "timeout", "rate-limited"] as const) {
  void test(`startup redacts token-bearing RPC errors and causes while preserving ${kind}`, async () => {
    const reader = {
      config: { networkId: "testnet", contractId: "audit.testnet" },
      verifyNetwork: async () => {
        throw new NearRpcError(kind, `RPC ${secretUrl}`, {
          cause: new Error(secretUrl),
        });
      },
    } as unknown as NearContractReader;
    await assert.rejects(
      startExecutionHost(config, {
        dependencies: { ...dependencies(), createReader: () => reader },
      }),
      (e: unknown) => {
        assert.ok(e instanceof NearRpcError);
        assert.equal(e.kind, kind);
        assert.equal(e.retryable, kind !== "network-mismatch");
        assert.ok(!inspect(e, { depth: 10 }).includes(canary));
        assert.ok(e.message.includes(kind));
        assert.equal(e.cause, undefined);
        return true;
      },
    );
  });
}
void test("unclassified RPC startup exception never copies provider URL text", async () => {
  const reader = {
    config: { networkId: "testnet", contractId: "audit.testnet" },
    verifyNetwork: async () => {
      throw new Error(`RPC ${secretUrl}`);
    },
  } as unknown as NearContractReader;
  await assert.rejects(
    startExecutionHost(config, {
      dependencies: { ...dependencies(), createReader: () => reader },
    }),
    (e: unknown) =>
      e instanceof Error &&
      /NEAR RPC/.test(e.message) &&
      !inspect(e).includes(canary),
  );
});
void test("real RPC reflected URL token is absent from startup diagnostics", async () => {
  await localServer(
    (q, r) => r.end(JSON.stringify({ result: { chain_id: q.url } })),
    async (url) => {
      await assert.rejects(
        startExecutionHost(
          { ...config, nearRpcEndpoint: `${url}/${canary}` },
          { dependencies: dependencies() },
        ),
        (e: unknown) =>
          e instanceof NearRpcError &&
          e.kind === "network-mismatch" &&
          !inspect(e).includes(canary),
      );
    },
  );
});
void test("API diagnostics redact token-bearing RPC exception text", async () => {
  const reader = {
    config: { networkId: "testnet", contractId: "audit.testnet" },
    verifyNetwork: async () => undefined,
    isPaused: async () => true,
    getCodeHash: async () => {
      throw new NearRpcError("unavailable", secretUrl);
    },
    getOwner: async () => "owner.testnet",
    getCampaignCount: async () => "0",
  } as unknown as NearContractReader;
  const server = await startExecutionApiServer(
    { reader, authorize: () => true },
    { host: "127.0.0.1", port: 0 },
  );
  try {
    const a = server.address();
    assert.ok(a && typeof a !== "string");
    const r = await fetch(`http://127.0.0.1:${a.port}/v1/contract`);
    assert.equal(r.status, 503);
    const b = await r.text();
    assert.ok(b.includes("near_rpc_failure"));
    assert.ok(!b.includes(canary));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
for (const shape of ["array", "object"] as const)
  for (const depth of [4, 5]) {
    void test(`real token inspector ${shape} depth ${depth} respects configured limit 4`, async () => {
      const raw =
        shape === "array"
          ? "[".repeat(depth) + "0" + "]".repeat(depth)
          : '{"child":'.repeat(depth) + "0" + "}".repeat(depth);
      await localServer(
        (_q, r) =>
          r.end(
            JSON.stringify({
              result: {
                block_hash: hash,
                block_height: 1,
                result: [...Buffer.from(raw)],
              },
            }),
          ),
        async (url) => {
          const inspector = new TestnetInspector(
            url,
            new HttpNearRpcTransport(url, 1000, fetch, {
              jsonDepth: 4,
              maxAttempts: 1,
            }),
          );
          const pending = inspector.view(
            TIDEPOOL,
            "ft_metadata",
            {},
            { hash, height: "1", network: "testnet" },
          );
          if (depth > 4)
            await assert.rejects(
              pending,
              (e: unknown) =>
                e instanceof NearRpcError && e.kind === "resource-limit",
            );
          else assert.deepEqual(await pending, JSON.parse(raw));
        },
      );
    });
  }
void test("valid real token metadata still parses with nested data and quoted brackets", async () => {
  const metadata = {
    spec: "ft-1.0.0",
    symbol: "USDC",
    decimals: 6,
    name: 'USDC [ { " ] }',
    extra: { tags: ["testnet"] },
  };
  await localServer(
    (_q, r) =>
      r.end(
        JSON.stringify({
          result: {
            block_hash: hash,
            block_height: 1,
            result: [...Buffer.from(JSON.stringify(metadata))],
          },
        }),
      ),
    async (url) => {
      const inspector = new TestnetInspector(
        url,
        new HttpNearRpcTransport(url, 1000, fetch, { jsonDepth: 4 }),
      );
      const v = await inspector.view(
        TIDEPOOL,
        "ft_metadata",
        {},
        { hash, height: "1", network: "testnet" },
      );
      assert.deepEqual(v, metadata);
      assert.equal(tokenMetadata(v).decimals, 6);
    },
  );
});
