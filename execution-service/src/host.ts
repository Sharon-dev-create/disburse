import { pathToFileURL } from "node:url";
import { loadIsolatedTestnetConfig } from "./host/isolated-config.ts";
import { loadExecutionHostConfig, HostConfigError } from "./host/config.ts";
import { runExecutionHost } from "./host/server.ts";

export async function startExecutionHost(
  environment: NodeJS.ProcessEnv = process.env,
  run: typeof runExecutionHost = runExecutionHost,
): Promise<void> {
  const profile = environment.DISBURSE_EXECUTION_PROFILE;
  if (profile !== undefined && profile !== "isolated-testnet")
    throw new HostConfigError("Unsupported execution profile.");
  const config =
    profile === "isolated-testnet"
      ? loadIsolatedTestnetConfig(environment)
      : loadExecutionHostConfig(environment);
  await run(config, { logger: console });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startExecutionHost().catch((error: unknown) => {
    if (error instanceof HostConfigError) {
      console.error(`Configuration error: ${error.message}`);
    } else if (error instanceof Error) {
      console.error(`Startup error: ${error.message}`);
    } else {
      console.error("Startup error: execution service failed to start.");
    }
    process.exitCode = 1;
  });
