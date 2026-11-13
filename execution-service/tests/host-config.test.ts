import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HostConfigError,
  loadExecutionHostConfig,
} from "../src/host/config.ts";

const baseEnv = {
  DISBURSE_API_HOST: "127.0.0.1",
  DISBURSE_API_PORT: "4100",
  DISBURSE_POSTGRES_TARGET: "development",
  DISBURSE_DEV_DATABASE_URL:
    "postgresql://disburse_dev:secret@127.0.0.1:5432/disburse_dev",
  NEAR_NETWORK: "testnet",
  NEAR_RPC_ENDPOINT: "https://rpc.testnet.near.org",
  DISBURSE_CONTRACT_ID: "disburse.testnet",
  DISBURSE_EXECUTION_API_DEMO_TOKEN: "demo-token-123456",
} as const;

void test("loadExecutionHostConfig parses valid host configuration", () => {
  const config = loadExecutionHostConfig({ ...baseEnv });
  assert.equal(config.httpHost, "127.0.0.1");
  assert.equal(config.httpPort, 4100);
  assert.equal(config.postgresTarget, "development");
  assert.equal(config.nearNetworkId, "testnet");
  assert.equal(config.contractAccountId, "disburse.testnet");
  assert.equal(config.demoApiToken, "demo-token-123456");
  assert.equal(config.nearRpcTimeoutMs, 10_000);
});

for (const [name, env] of [
  ["missing demo token", { ...baseEnv, DISBURSE_EXECUTION_API_DEMO_TOKEN: "" }],
  [
    "short demo token",
    { ...baseEnv, DISBURSE_EXECUTION_API_DEMO_TOKEN: "short-token" },
  ],
  ["missing rpc endpoint", { ...baseEnv, NEAR_RPC_ENDPOINT: "" }],
  ["missing contract id", { ...baseEnv, DISBURSE_CONTRACT_ID: "" }],
  [
    "contract id on wrong network",
    { ...baseEnv, DISBURSE_CONTRACT_ID: "disburse.near" },
  ],
  ["invalid near network", { ...baseEnv, NEAR_NETWORK: "localnet" }],
  ["invalid api port", { ...baseEnv, DISBURSE_API_PORT: "70000" }],
] as const) {
  void test(`loadExecutionHostConfig rejects ${name}`, () => {
    assert.throws(() => loadExecutionHostConfig(env), HostConfigError);
  });
}

void test("loadExecutionHostConfig fails closed when postgres target config is missing", () => {
  const env = { ...baseEnv };
  delete (env as Record<string, string | undefined>).DISBURSE_DEV_DATABASE_URL;
  assert.throws(
    () => loadExecutionHostConfig(env),
    /DISBURSE_DEV_DATABASE_URL/,
  );
});

void test("loadExecutionHostConfig does not echo secrets in validation errors", () => {
  const env = {
    ...baseEnv,
    DISBURSE_DEV_DATABASE_URL:
      "postgresql://disburse_dev:super-secret@127.0.0.1:5432/wrong_db",
  };
  try {
    loadExecutionHostConfig(env);
    assert.fail("expected configuration to fail");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes("super-secret"), false);
  }
});
