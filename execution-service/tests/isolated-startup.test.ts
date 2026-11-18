import assert from "node:assert/strict";
import { test } from "node:test";
import { startExecutionHost } from "../src/host.ts";
const valid: NodeJS.ProcessEnv = {
  DISBURSE_EXECUTION_PROFILE: "isolated-testnet",
  DISBURSE_ACTIVE_TESTNET_READ_ONLY: "true",
  DISBURSE_EXECUTION_WORKER_ENABLED: "false",
  DISBURSE_PAYOUT_SUBMISSION_ENABLED: "false",
  DISBURSE_MAX_PAYOUT_ATOMIC: "0",
  DISBURSE_POSTGRES_TARGET: "test",
  DISBURSE_TEST_DATABASE_URL:
    "postgresql://disburse_test@127.0.0.1:19552/disburse_test",
  NEAR_NETWORK: "testnet",
  NEAR_RPC_ENDPOINT: "https://rpc.testnet.near.org",
  DISBURSE_CONTRACT_ID: "disburse-test-contract.testnet",
  DISBURSE_EXECUTION_API_DEMO_TOKEN: "local-test-token-only",
};
void test("actual startup accepts isolated read-only profile", async () => {
  let initialized = false;
  await startExecutionHost(valid, async (config) => {
    assert.equal(config.activeTestnetReadOnly, true);
    initialized = true;
  });
  assert.equal(initialized, true);
});
for (const [name, value] of [
  ["DISBURSE_ACTIVE_TESTNET_READ_ONLY", undefined],
  ["DISBURSE_ACTIVE_TESTNET_READ_ONLY", "false"],
  ["DISBURSE_ACTIVE_TESTNET_READ_ONLY", "yes"],
  ["NEAR_NETWORK", "mainnet"],
  ["DISBURSE_CONTRACT_ID", "other.testnet"],
  ["DISBURSE_CONTRACT_ID", undefined],
  ["DISBURSE_CONTRACT_ID", "disburse-topg.testnet"],
  ["DISBURSE_EXECUTION_WORKER_ENABLED", "true"],
  ["DISBURSE_EXECUTION_WORKER_ENABLED", "yes"],
  ["DISBURSE_EXECUTION_WORKER_ENABLED", undefined],
  ["DISBURSE_PAYOUT_SUBMISSION_ENABLED", "true"],
  ["DISBURSE_PAYOUT_SUBMISSION_ENABLED", undefined],
  ["NEAR_RPC_ENDPOINT", undefined],
  ["DISBURSE_MAX_PAYOUT_ATOMIC", "100000"],
  ["DISBURSE_MAX_PAYOUT_ATOMIC", undefined],
  ["DISBURSE_POSTGRES_TARGET", "development"],
  ["DISBURSE_EXECUTION_PROFILE", "unknown"],
  ["DISBURSE_EXECUTION_PROFILE", undefined],
] as const) {
  void test(`startup rejects ${name}=${String(value)} before initialization`, async () => {
    let initialized = false;
    await assert.rejects(
      startExecutionHost({ ...valid, [name]: value }, async () => {
        initialized = true;
      }),
    );
    assert.equal(initialized, false);
  });
}
void test("restart revalidates incomplete configuration", async () => {
  await startExecutionHost(valid, async () => {});
  await assert.rejects(
    startExecutionHost({ ...valid, NEAR_RPC_ENDPOINT: undefined }, async () => {
      assert.fail("must not initialize");
    }),
  );
});
