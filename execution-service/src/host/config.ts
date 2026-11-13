import {
  loadPostgresRuntimeConfig,
  type PostgresRuntimeConfig,
  type PostgresTarget,
} from "../persistence/postgres-config.ts";

export interface ExecutionHostConfig {
  readonly httpHost: string;
  readonly httpPort: number;
  readonly postgresTarget: PostgresTarget;
  readonly postgres: PostgresRuntimeConfig;
  readonly nearNetworkId: "mainnet" | "testnet";
  readonly nearRpcEndpoint: string;
  readonly contractAccountId: string;
  readonly demoApiToken: string;
  readonly nearRpcTimeoutMs: number;
}

export class HostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostConfigError";
  }
}

export function loadExecutionHostConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ExecutionHostConfig {
  const httpHost =
    readOptional(environment, "DISBURSE_API_HOST") ?? "127.0.0.1";
  if (httpHost.length === 0 || /[\s]/.test(httpHost)) {
    throw new HostConfigError(
      "DISBURSE_API_HOST must be a non-empty hostname or IP address.",
    );
  }

  const httpPort = parsePort(environment.DISBURSE_API_PORT ?? "4000");
  const postgresTarget = parsePostgresTarget(
    readOptional(environment, "DISBURSE_POSTGRES_TARGET") ?? "development",
  );
  const postgres = loadPostgresRuntimeConfig(postgresTarget, environment);

  const nearNetworkId = parseNearNetwork(
    readRequired(environment, "NEAR_NETWORK"),
  );
  const nearRpcEndpoint = parseHttpEndpoint(
    readRequired(environment, "NEAR_RPC_ENDPOINT"),
    "NEAR_RPC_ENDPOINT",
  );
  const contractAccountId = readRequired(environment, "DISBURSE_CONTRACT_ID");
  validateContractAccountId(nearNetworkId, contractAccountId);

  const demoApiToken = readRequired(
    environment,
    "DISBURSE_EXECUTION_API_DEMO_TOKEN",
  );
  if (demoApiToken.length < 16 || /[\r\n]/.test(demoApiToken)) {
    throw new HostConfigError(
      "DISBURSE_EXECUTION_API_DEMO_TOKEN must be at least 16 characters and must not contain line breaks.",
    );
  }

  const nearRpcTimeoutMs = parsePositiveInteger(
    environment.DISBURSE_NEAR_RPC_TIMEOUT_MS ?? "10000",
    "DISBURSE_NEAR_RPC_TIMEOUT_MS",
  );

  return Object.freeze({
    httpHost,
    httpPort,
    postgresTarget,
    postgres,
    nearNetworkId,
    nearRpcEndpoint,
    contractAccountId,
    demoApiToken,
    nearRpcTimeoutMs,
  });
}

function readRequired(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new HostConfigError(`${name} is required.`);
  }
  return value;
}

function readOptional(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = environment[name]?.trim();
  return value ? value : undefined;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new HostConfigError(
      "DISBURSE_API_PORT must be an integer from 0 to 65535.",
    );
  }
  return port;
}

function parsePostgresTarget(value: string): PostgresTarget {
  if (value === "production" || value === "development" || value === "test") {
    return value;
  }
  throw new HostConfigError(
    "DISBURSE_POSTGRES_TARGET must be one of: production, development, test.",
  );
}

function parseNearNetwork(value: string): "mainnet" | "testnet" {
  if (value === "mainnet" || value === "testnet") return value;
  throw new HostConfigError("NEAR_NETWORK must be 'mainnet' or 'testnet'.");
}

function parseHttpEndpoint(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HostConfigError(`${name} must be a valid HTTP(S) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HostConfigError(`${name} must use http or https.`);
  }
  if (url.username || url.password) {
    throw new HostConfigError(`${name} must not include credentials.`);
  }
  return url.toString();
}

function validateContractAccountId(
  networkId: "mainnet" | "testnet",
  value: string,
): void {
  const hasControlOrWhitespace = Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x20 || (code >= 0x7f && code <= 0x9f);
  });
  if (
    value.length === 0 ||
    value.length > 64 ||
    value !== value.trim() ||
    hasControlOrWhitespace
  ) {
    throw new HostConfigError(
      "DISBURSE_CONTRACT_ID must be a valid NEAR account ID.",
    );
  }
  const suffix = networkId === "testnet" ? ".testnet" : ".near";
  const base = value.slice(0, -suffix.length);
  if (
    !value.endsWith(suffix) ||
    base.length < 2 ||
    base.length > 64 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(base)
  ) {
    throw new HostConfigError(
      "DISBURSE_CONTRACT_ID must match the configured NEAR network.",
    );
  }
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HostConfigError(`${name} must be a positive integer.`);
  }
  return parsed;
}
