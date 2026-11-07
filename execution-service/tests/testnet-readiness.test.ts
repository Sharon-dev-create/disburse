import assert from "node:assert/strict";
import test from "node:test";
import { loadTestnetReadinessConfig } from "../src/near/testnet-readiness.ts";

const baseEnvironment: NodeJS.ProcessEnv = {
  NEAR_NETWORK: "testnet",
  NEAR_RPC_ENDPOINT: "https://rpc.testnet.near.org",
  NEAR_DATA_ENDPOINT: "https://testnet.neardata.xyz",
  NEAR_DEPLOYMENT_ACCOUNT: "deploy.testnet",
  DISBURSE_CONTRACT_ID: "disburse.testnet",
  NEAR_INITIALIZER_ACCOUNT: "owner.testnet",
  NEAR_EXPECTED_OWNER_ACCOUNT: "owner.testnet",
  NEAR_OPERATOR_ACCOUNT: "operator.testnet",
  NEAR_VERIFIER_ACCOUNT: "verifier.testnet",
  TEST_TOKEN_CONTRACT: "token.testnet",
  TEST_TOKEN_FUNDER_ACCOUNT: "funder.testnet",
};

void test("testnet readiness accepts explicit testnet endpoints and separate roles", () => {
  const config = loadTestnetReadinessConfig(baseEnvironment);
  assert.equal(config.networkId, "testnet");
  assert.equal(config.operatorAccount, "operator.testnet");
  assert.equal(config.verifierAccount, "verifier.testnet");
});

void test("testnet readiness rejects mainnet or non-testnet endpoints", () => {
  assert.throws(
    () =>
      loadTestnetReadinessConfig({
        ...baseEnvironment,
        NEAR_NETWORK: "mainnet",
      }),
    /requires NEAR_NETWORK=testnet/,
  );
  assert.throws(
    () =>
      loadTestnetReadinessConfig({
        ...baseEnvironment,
        NEAR_RPC_ENDPOINT: "https://rpc.mainnet.near.org",
      }),
    /requires NEAR_RPC_ENDPOINT/,
  );
  assert.throws(
    () =>
      loadTestnetReadinessConfig({
        ...baseEnvironment,
        NEAR_DATA_ENDPOINT: "https://mainnet.neardata.xyz",
      }),
    /requires NEAR_DATA_ENDPOINT/,
  );
  assert.throws(
    () =>
      loadTestnetReadinessConfig({
        ...baseEnvironment,
        DISBURSE_CONTRACT_ID: "disburse.near",
      }),
    /must be a named NEAR testnet account/,
  );
  assert.throws(
    () =>
      loadTestnetReadinessConfig({
        ...baseEnvironment,
        TEST_TOKEN_CONTRACT: "invalid..token.testnet",
      }),
    /must be a named NEAR testnet account/,
  );
});

void test("testnet readiness rejects initializer-owner and signing-role ambiguity", () => {
  assert.throws(
    () =>
      loadTestnetReadinessConfig({
        ...baseEnvironment,
        NEAR_EXPECTED_OWNER_ACCOUNT: "other-owner.testnet",
      }),
    /Expected owner must equal the initializer signer/,
  );
  assert.throws(
    () =>
      loadTestnetReadinessConfig({
        ...baseEnvironment,
        NEAR_OPERATOR_ACCOUNT: "owner.testnet",
      }),
    /Operator must differ/,
  );
  assert.throws(
    () =>
      loadTestnetReadinessConfig({
        ...baseEnvironment,
        NEAR_VERIFIER_ACCOUNT: "operator.testnet",
      }),
    /Verifier must be distinct/,
  );
});
