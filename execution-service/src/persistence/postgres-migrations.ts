import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Pool, type PoolClient } from "pg";

interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly url: URL;
}

interface LoadedMigration extends MigrationFile {
  readonly checksum: string;
  readonly sql: string;
}

const migrations: readonly MigrationFile[] = [
  {
    version: "0001",
    name: "security_repositories",
    url: new URL(
      "../../sql/migrations/0001_security_repositories.sql",
      import.meta.url,
    ),
  },
  {
    version: "0002",
    name: "execution_jobs",
    url: new URL(
      "../../sql/migrations/0002_execution_jobs.sql",
      import.meta.url,
    ),
  },
];

const migrationTable = "public.disburse_schema_migrations";
const migrationLockKey = "disburse.execution-service.schema-migrations";

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly currentVersion: string | null;
}

export interface PostgresMigrationIdentity {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

export async function applyPostgresMigrations(
  pool: Pool,
): Promise<MigrationResult> {
  const loaded = await Promise.all(migrations.map(loadMigration));
  const applied: string[] = [];

  for (const migration of loaded) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        migrationLockKey,
      ]);
      await ensureMigrationTable(client);
      const recorded = await client.query<{
        version: string;
        name: string;
        checksum: string;
      }>(
        `SELECT version, name, checksum FROM ${migrationTable} ORDER BY version`,
      );
      const unknownVersion = recorded.rows.find(
        (row) => !loaded.some((item) => item.version === row.version),
      );
      if (unknownVersion)
        throw new Error(
          `Database has unknown migration version ${unknownVersion.version}`,
        );

      const existing = recorded.rows.find(
        (row) => row.version === migration.version,
      );
      if (existing) {
        if (
          existing.name !== migration.name ||
          existing.checksum !== migration.checksum
        ) {
          throw new Error(
            `Applied migration ${migration.version} does not match the local migration file`,
          );
        }
        await client.query("COMMIT");
        continue;
      }

      if (migration.version === "0001")
        await refuseUnversionedSecurityObjects(client);
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO ${migrationTable} (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum],
      );
      await client.query("COMMIT");
      applied.push(migration.version);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    applied,
    currentVersion: loaded.at(-1)?.version ?? null,
  };
}

export async function assertPostgresMigrationsCurrent(
  pool: Pool,
): Promise<void> {
  const loaded = await Promise.all(migrations.map(loadMigration));
  const table = await pool.query<{ table_name: string | null }>(
    "SELECT to_regclass($1)::text AS table_name",
    [migrationTable],
  );
  if (!table.rows[0]?.table_name)
    throw new Error("PostgreSQL migrations have not been applied");
  const result = await pool.query<PostgresMigrationIdentity>(
    `SELECT version, name, checksum FROM ${migrationTable} ORDER BY version`,
  );
  assertMigrationHistoryMatches(loaded, result.rows);
}

export function assertMigrationHistoryMatches(
  expected: readonly PostgresMigrationIdentity[],
  recorded: readonly PostgresMigrationIdentity[],
): void {
  for (const row of recorded) {
    if (!expected.some((migration) => migration.version === row.version))
      throw new Error(
        `PostgreSQL contains unknown migration version ${row.version}`,
      );
  }
  for (const migration of expected) {
    const row = recorded.find((item) => item.version === migration.version);
    if (!row)
      throw new Error(
        `PostgreSQL migration ${migration.version} has not been applied`,
      );
    if (row.name !== migration.name || row.checksum !== migration.checksum)
      throw new Error(
        `PostgreSQL migration ${migration.version} name or checksum mismatch`,
      );
  }
  if (recorded.length !== expected.length)
    throw new Error("PostgreSQL contains an unknown migration version");
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  const existing = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass($1)::text AS table_name",
    [migrationTable],
  );
  if (!existing.rows[0]?.table_name) {
    await client.query(`
      CREATE TABLE ${migrationTable} (
        version TEXT PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
        name TEXT NOT NULL,
        checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
      )
    `);
    return;
  }

  const columns = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'disburse_schema_migrations'`,
  );
  const expected = ["applied_at", "checksum", "name", "version"];
  if (
    expected.some(
      (column) => !columns.rows.some((row) => row.column_name === column),
    )
  ) {
    throw new Error(
      "Existing disburse_schema_migrations table has an incompatible schema",
    );
  }
}

async function refuseUnversionedSecurityObjects(
  client: PoolClient,
): Promise<void> {
  const result = await client.query<{
    authorization_table: string | null;
    refund_table: string | null;
    authorization_function: string | null;
    refund_function: string | null;
  }>(`
    SELECT
      to_regclass('public.execution_authorizations')::text AS authorization_table,
      to_regclass('public.payout_refund_policies')::text AS refund_table,
      to_regprocedure('public.disburse_validate_authorization_update()')::text AS authorization_function,
      to_regprocedure('public.disburse_deny_refund_policy_mutation()')::text AS refund_function
  `);
  const existing = Object.values(result.rows[0] ?? {}).filter(Boolean);
  if (existing.length > 0)
    throw new Error(
      "Found unversioned PostgreSQL security objects; refusing to adopt or modify them",
    );
}

async function loadMigration(file: MigrationFile): Promise<LoadedMigration> {
  const sql = await readFile(file.url, "utf8");
  return {
    ...file,
    sql,
    checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
  };
}
