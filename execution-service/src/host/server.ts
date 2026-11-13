import type { Server } from "node:http";
import type { Pool } from "pg";
import { startExecutionApiServer } from "../api/http.ts";
import {
  HttpNearRpcTransport,
  NearContractReader,
  type NearRpcTransport,
} from "../near/rpc.ts";
import { applyPostgresMigrations } from "../persistence/postgres-migrations.ts";
import { PostgresJobRepository } from "../persistence/postgres-job-repository.ts";
import {
  createPostgresPool,
  createPostgresQuery,
} from "../persistence/postgres-pool.ts";
import { createDemoBearerAuthorizer } from "./auth.ts";
import type { ExecutionHostConfig } from "./config.ts";

export interface ExecutionHost {
  readonly server: Server;
  readonly pool: Pool;
  readonly config: ExecutionHostConfig;
  close(): Promise<void>;
}

export interface ExecutionHostLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface ExecutionHostDependencies {
  createPool(config: ExecutionHostConfig): Pool;
  applyMigrations(pool: Pool): Promise<unknown>;
  createJobsRepository(pool: Pool): PostgresJobRepository;
  createTransport(config: ExecutionHostConfig): NearRpcTransport;
  createReader(
    config: ExecutionHostConfig,
    transport: NearRpcTransport,
  ): NearContractReader;
}

const silentLogger: ExecutionHostLogger = {
  info() {},
  error() {},
};

const defaultDependencies: ExecutionHostDependencies = {
  createPool(config) {
    return createPostgresPool(config.postgres);
  },
  applyMigrations(pool) {
    return applyPostgresMigrations(pool);
  },
  createJobsRepository(pool) {
    return new PostgresJobRepository({
      connect: async () => {
        const client = await pool.connect();
        return {
          query: createPostgresQuery(client),
          release: () => client.release(),
        };
      },
    });
  },
  createTransport(config) {
    return new HttpNearRpcTransport(
      config.nearRpcEndpoint,
      config.nearRpcTimeoutMs,
    );
  },
  createReader(config, transport) {
    return new NearContractReader(
      {
        networkId: config.nearNetworkId,
        contractId: config.contractAccountId,
      },
      transport,
    );
  },
};

export async function startExecutionHost(
  config: ExecutionHostConfig,
  options: {
    readonly logger?: ExecutionHostLogger;
    readonly dependencies?: Partial<ExecutionHostDependencies>;
  } = {},
): Promise<ExecutionHost> {
  const logger = options.logger ?? silentLogger;
  const deps = { ...defaultDependencies, ...options.dependencies };
  const pool = deps.createPool(config);

  let server: Server | undefined;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      }).catch(() => undefined);
    }
    await pool.end().catch(() => undefined);
  };

  try {
    await pool.query("SELECT 1");
    const migration = (await deps.applyMigrations(pool)) as
      { applied?: readonly string[] } | undefined;
    logger.info(
      migration?.applied && migration.applied.length > 0
        ? `Applied PostgreSQL migrations: ${migration.applied.join(", ")}`
        : "PostgreSQL migrations are current.",
    );

    const jobs = deps.createJobsRepository(pool);
    const transport = deps.createTransport(config);
    const reader = deps.createReader(config, transport);

    // Enforce read-only contract condition for this milestone before binding.
    await reader.verifyNetwork();
    const paused = await reader.isPaused();
    if (paused !== true) {
      throw new Error(
        "Configured contract must be paused for read-only host startup.",
      );
    }

    server = await startExecutionApiServer(
      {
        reader,
        jobs,
        authorize: createDemoBearerAuthorizer(config.demoApiToken),
      },
      { host: config.httpHost, port: config.httpPort },
    );

    logger.info(
      `Execution service listening on http://${config.httpHost}:${boundPort(server)}`,
    );

    return Object.freeze({
      server,
      pool,
      config,
      close,
    });
  } catch (error) {
    await close();
    throw sanitizeHostStartupError(error);
  }
}

export async function runExecutionHost(
  config: ExecutionHostConfig,
  options: { readonly logger?: ExecutionHostLogger } = {},
): Promise<void> {
  const logger = options.logger ?? console;
  const host = await startExecutionHost(config, { logger });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}; shutting down execution service.`);
    void host.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

function boundPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Execution service did not bind to a TCP port.");
  }
  return address.port;
}

function sanitizeHostStartupError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message;
    const rawCode = (error as { code?: unknown }).code;
    const code = typeof rawCode === "string" ? rawCode : "";
    if (
      /postgres|database|password|credential|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|connection/i.test(
        `${message} ${code}`,
      ) ||
      /^28|^08|^3D|^57P/.test(code)
    ) {
      return new Error(
        "PostgreSQL startup failed; connection details are redacted.",
      );
    }
    if (/near|rpc|network-mismatch|paused|contract/i.test(message)) {
      return new Error(message);
    }
    return new Error("Execution service startup failed.");
  }
  return new Error("Execution service startup failed.");
}
