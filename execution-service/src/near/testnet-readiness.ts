const TESTNET_RPC = "https://rpc.testnet.near.org";
const TESTNET_NEAR_DATA = "https://testnet.neardata.xyz";

export interface TestnetReadinessConfig {
  readonly networkId: "testnet";
  readonly rpcEndpoint: typeof TESTNET_RPC;
  readonly nearDataEndpoint: typeof TESTNET_NEAR_DATA;
  readonly deploymentAccount: string;
  readonly contractAccount: string;
  readonly initializerAccount: string;
  readonly expectedOwnerAccount: string;
  readonly operatorAccount: string;
  readonly verifierAccount: string;
  readonly tokenContract: string;
  readonly tokenFunderAccount: string;
}

/** Strict, side-effect-free preflight parser. It never reads or accepts signer secrets. */
export function loadTestnetReadinessConfig(
  env: NodeJS.ProcessEnv = process.env,
): TestnetReadinessConfig {
  if (env.NEAR_NETWORK !== "testnet") {
    throw new Error("Milestone 11 requires NEAR_NETWORK=testnet");
  }
  if (env.NEAR_RPC_ENDPOINT !== TESTNET_RPC) {
    throw new Error(`Milestone 11 requires NEAR_RPC_ENDPOINT=${TESTNET_RPC}`);
  }
  if (env.NEAR_DATA_ENDPOINT !== TESTNET_NEAR_DATA) {
    throw new Error(
      `Milestone 11 requires NEAR_DATA_ENDPOINT=${TESTNET_NEAR_DATA}`,
    );
  }

  const deploymentAccount = testnetAccount(
    env.NEAR_DEPLOYMENT_ACCOUNT,
    "NEAR_DEPLOYMENT_ACCOUNT",
  );
  const contractAccount = testnetAccount(
    env.DISBURSE_CONTRACT_ID,
    "DISBURSE_CONTRACT_ID",
  );
  const initializerAccount = testnetAccount(
    env.NEAR_INITIALIZER_ACCOUNT,
    "NEAR_INITIALIZER_ACCOUNT",
  );
  const expectedOwnerAccount = testnetAccount(
    env.NEAR_EXPECTED_OWNER_ACCOUNT,
    "NEAR_EXPECTED_OWNER_ACCOUNT",
  );
  const operatorAccount = testnetAccount(
    env.NEAR_OPERATOR_ACCOUNT,
    "NEAR_OPERATOR_ACCOUNT",
  );
  const verifierAccount = testnetAccount(
    env.NEAR_VERIFIER_ACCOUNT,
    "NEAR_VERIFIER_ACCOUNT",
  );
  const tokenContract = testnetAccount(
    env.TEST_TOKEN_CONTRACT,
    "TEST_TOKEN_CONTRACT",
  );
  const tokenFunderAccount = testnetAccount(
    env.TEST_TOKEN_FUNDER_ACCOUNT,
    "TEST_TOKEN_FUNDER_ACCOUNT",
  );

  if (initializerAccount !== expectedOwnerAccount) {
    throw new Error(
      "Expected owner must equal the initializer signer: new() assigns owner_id from the predecessor account",
    );
  }
  if (operatorAccount === initializerAccount) {
    throw new Error(
      "Operator must differ from the initializer/owner because the owner cannot self-grant a role",
    );
  }
  if (
    verifierAccount === initializerAccount ||
    verifierAccount === operatorAccount
  ) {
    throw new Error(
      "Verifier must be distinct from the owner and Operator identities",
    );
  }

  return {
    networkId: "testnet",
    rpcEndpoint: TESTNET_RPC,
    nearDataEndpoint: TESTNET_NEAR_DATA,
    deploymentAccount,
    contractAccount,
    initializerAccount,
    expectedOwnerAccount,
    operatorAccount,
    verifierAccount,
    tokenContract,
    tokenFunderAccount,
  };
}

function testnetAccount(value: string | undefined, name: string): string {
  const account = value?.trim();
  if (
    !account ||
    account.length > 64 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(account)
  ) {
    throw new Error(
      `${name} must be a named NEAR testnet account ending in .testnet`,
    );
  }
  return account;
}
