import type { Pool } from "pg";
import {
  PostgresAuthorizationRepository,
  PostgresRefundPolicyRepository,
} from "./postgres-security-repositories.ts";
import { PostgresJobRepository } from "./postgres-job-repository.ts";
import { assertPostgresMigrationsCurrent } from "./postgres-migrations.ts";
import { createPostgresPool, createPostgresQuery } from "./postgres-pool.ts";
import {
  loadPostgresRuntimeConfig,
  type PostgresRuntimeConfig,
  type PostgresTarget,
} from "./postgres-config.ts";

export interface PostgresSecurityComposition {
  readonly target: PostgresTarget;
  readonly authorizations: PostgresAuthorizationRepository;
  readonly refundPolicies: PostgresRefundPolicyRepository;
  readonly jobs: PostgresJobRepository;
  close(): Promise<void>;
}

export function createProductionPostgresSecurityComposition(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PostgresSecurityComposition> {
  return createComposition(
    loadPostgresRuntimeConfig("production", environment),
  );
}

export function createDevelopmentPostgresSecurityComposition(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PostgresSecurityComposition> {
  return createComposition(
    loadPostgresRuntimeConfig("development", environment),
  );
}

export function createTestPostgresSecurityComposition(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PostgresSecurityComposition> {
  return createComposition(loadPostgresRuntimeConfig("test", environment));
}

async function createComposition(
  config: PostgresRuntimeConfig,
): Promise<PostgresSecurityComposition> {
  const pool: Pool = createPostgresPool(config);
  try {
    await pool.query("SELECT 1");
    await assertPostgresMigrationsCurrent(pool);
  } catch {
    await pool.end().catch(() => undefined);
    throw new Error(
      `PostgreSQL ${config.target} security repository startup failed; connection details are redacted`,
    );
  }

  const query = createPostgresQuery(pool);
  let closed = false;
  return Object.freeze({
    target: config.target,
    authorizations: new PostgresAuthorizationRepository(query),
    refundPolicies: new PostgresRefundPolicyRepository(query),
    jobs: new PostgresJobRepository({
      connect: async () => {
        const client = await pool.connect();
        return {
          query: createPostgresQuery(client),
          release: () => client.release(),
        };
      },
    }),
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  });
}
