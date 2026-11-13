import { loadExecutionHostConfig, HostConfigError } from "./host/config.ts";
import { runExecutionHost } from "./host/server.ts";

async function main(): Promise<void> {
  const config = loadExecutionHostConfig(process.env);
  await runExecutionHost(config, { logger: console });
}

main().catch((error: unknown) => {
  if (error instanceof HostConfigError) {
    console.error(`Configuration error: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Startup error: ${error.message}`);
  } else {
    console.error("Startup error: execution service failed to start.");
  }
  process.exitCode = 1;
});
