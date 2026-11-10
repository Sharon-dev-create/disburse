import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  PostgresQuery,
  PostgresQueryResult,
} from "./postgres-security-repositories.ts";
import type { PostgresRuntimeConfig } from "./postgres-config.ts";

export function createPostgresPool(config: PostgresRuntimeConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
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
