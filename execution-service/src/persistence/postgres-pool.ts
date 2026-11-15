import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  PostgresQuery,
  PostgresQueryResult,
} from "./postgres-security-repositories.ts";
import type { PostgresRuntimeConfig } from "./postgres-config.ts";

export function createPostgresPool(
  config: PostgresRuntimeConfig,
  options: { readOnly?: boolean } = {},
): Pool {
  const url = new URL(config.connectionString);
  if (options.readOnly)
    url.searchParams.set("options", "-c default_transaction_read_only=on");
  return new Pool({
    ...(options.readOnly
      ? { options: "-c default_transaction_read_only=on" }
      : {}),
    connectionString: options.readOnly
      ? url.toString()
      : config.connectionString,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    query_timeout: config.queryTimeoutMs,
    idleTimeoutMillis: 30_000,
    application_name: `disburse-execution-service-${config.target}`,
  });
}

export type PostgresExecutor = Pool | PoolClient;

export function createPostgresQuery(executor: PostgresExecutor): PostgresQuery {
  return async (
    statement: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult> => {
    const result = await executor.query<QueryResultRow>(statement, [
      ...parameters,
    ]);
    return {
      rows: result.rows as readonly Readonly<Record<string, unknown>>[],
      rowCount: result.rowCount,
    };
  };
}
