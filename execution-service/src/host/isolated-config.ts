import { loadExecutionHostConfig, HostConfigError } from "./config.ts";
import { ACTIVE_TESTNET } from "../near/active-testnet.ts";
/** Explicit local preflight profile; never composes a signer or worker. */
export function loadIsolatedTestnetConfig(env: NodeJS.ProcessEnv) {
  if (env.DISBURSE_ACTIVE_TESTNET_READ_ONLY !== "true")
    throw new HostConfigError(
      "Isolated profile requires explicit read-only mode.",
    );
  for (const name of [
    "DISBURSE_EXECUTION_WORKER_ENABLED",
    "DISBURSE_PAYOUT_SUBMISSION_ENABLED",
  ]) {
    if (env[name] !== "false")
      throw new HostConfigError(
        `${name} must be explicitly false in the isolated profile.`,
      );
  }
  // This is a read-only profile: its enforced submission budget is zero.
  if (env.DISBURSE_MAX_PAYOUT_ATOMIC !== "0")
    throw new HostConfigError("Isolated payout cap must be exactly zero.");
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
