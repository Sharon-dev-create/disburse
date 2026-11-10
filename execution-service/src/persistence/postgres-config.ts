export type PostgresTarget = "production" | "development" | "test";

export interface PostgresRuntimeConfig {
  readonly target: PostgresTarget;
  readonly connectionString: string;
  readonly maxConnections: number;
  readonly connectionTimeoutMs: number;
  readonly queryTimeoutMs: number;
}

const targetSettings: Readonly<
  Record<
    PostgresTarget,
    {
      readonly variable: string;
      readonly database?: string;
      readonly role?: string;
    }
  >
> = {
  production: { variable: "DISBURSE_DATABASE_URL" },
  development: {
    variable: "DISBURSE_DEV_DATABASE_URL",
    database: "disburse_dev",
    role: "disburse_dev",
  },
  test: {
    variable: "DISBURSE_TEST_DATABASE_URL",
    database: "disburse_test",
    role: "disburse_test",
  },
};

export function loadPostgresRuntimeConfig(
  target: PostgresTarget,
  environment: NodeJS.ProcessEnv = process.env,
): PostgresRuntimeConfig {
  const settings = targetSettings[target];
  const connectionString = environment[settings.variable];
  if (!connectionString)
    throw new Error(
      `${settings.variable} is required for ${target} PostgreSQL`,
    );

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${settings.variable} must be a valid PostgreSQL URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `${settings.variable} must use postgres:// or postgresql://`,
    );
  }
  if (!url.hostname || !url.pathname || url.pathname === "/")
    throw new Error(
      `${settings.variable} must include a host and database name`,
    );

  if (settings.database) {
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    const username = decodeURIComponent(url.username);
    if (
      databaseName !== settings.database ||
      username !== settings.role ||
      !isLoopbackHost(url.hostname)
    ) {
      throw new Error(
        `${settings.variable} must target local database ${settings.database} as role ${settings.role}`,
      );
    }
  }

  return Object.freeze({
    target,
    connectionString,
    maxConnections: positiveInteger(environment.DISBURSE_DB_POOL_MAX, 10),
    connectionTimeoutMs: positiveInteger(
      environment.DISBURSE_DB_CONNECTION_TIMEOUT_MS,
      5_000,
    ),
    queryTimeoutMs: positiveInteger(
      environment.DISBURSE_DB_QUERY_TIMEOUT_MS,
      15_000,
    ),
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(value))
    throw new Error(
      "PostgreSQL pool and timeout settings must be positive integers",
    );
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(
      "PostgreSQL pool and timeout settings exceed the safe range",
    );
  return parsed;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname.toLowerCase() === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}
