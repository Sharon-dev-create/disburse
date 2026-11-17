import { loadExecutionHostConfig, HostConfigError } from "./config.ts";
import { ACTIVE_TESTNET } from "../near/active-testnet.ts";
/** Explicit local preflight profile; never composes a signer or worker. */
export function loadIsolatedTestnetConfig(env: NodeJS.ProcessEnv) {
  if (env.DISBURSE_ACTIVE_TESTNET_READ_ONLY !== "true")
    throw new HostConfigError(
      "Isolated profile requires explicit read-only mode.",
    );
  const config = loadExecutionHostConfig(env);
  if (
    config.nearNetworkId !== "testnet" ||
    config.contractAccountId !== ACTIVE_TESTNET.contractId ||
    config.postgresTarget !== "test"
  )
    throw new HostConfigError(
      "Isolated profile requires pinned Testnet contract and test database.",
    );
  return config;
}
