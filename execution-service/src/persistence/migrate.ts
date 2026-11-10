import type { Pool } from "pg";
import {
  loadPostgresRuntimeConfig,
  type PostgresTarget,
} from "./postgres-config.ts";
import { applyPostgresMigrations } from "./postgres-migrations.ts";
import { createPostgresPool } from "./postgres-pool.ts";

const targetName = process.argv[2];
if (targetName !== "development" && targetName !== "test") {
  console.error("Usage: node src/persistence/migrate.ts <development|test>");
  process.exitCode = 2;
} else {
  await migrate(targetName);
}

async function migrate(
  target: Extract<PostgresTarget, "development" | "test">,
) {
  let config;
  try {
    config = loadPostgresRuntimeConfig(target);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Invalid database configuration",
    );
    process.exitCode = 2;
    return;
  }

  const pool: Pool = createPostgresPool(config);
  try {
    const result = await applyPostgresMigrations(pool);
    const applied = result.applied.length
      ? result.applied.join(", ")
      : "none (already current)";
    console.log(
      `PostgreSQL ${target} migrations complete; applied: ${applied}`,
    );
  } catch (error) {
    const code = isErrorCode(error) ? ` (database error ${error.code})` : "";
    console.error(
      `PostgreSQL ${target} migration failed${code}; no credentials were logged`,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function isErrorCode(
  value: unknown,
): value is Error & { readonly code: string } {
  return (
    value instanceof Error &&
    "code" in value &&
    typeof value.code === "string" &&
    /^[A-Z0-9]+$/.test(value.code)
  );
}
