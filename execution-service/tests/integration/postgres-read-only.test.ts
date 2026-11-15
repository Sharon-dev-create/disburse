import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import { createPostgresPool } from "../../src/persistence/postgres-pool.ts";
import { assertPostgresMigrationsCurrent } from "../../src/persistence/postgres-migrations.ts";

void test("restricted pool enforces PostgreSQL read-only sessions even when URL requests read-write", async () => {
  const config = loadPostgresRuntimeConfig("test");
  const url = new URL(config.connectionString);
  url.searchParams.set("options", "-c default_transaction_read_only=off");
  const pool = createPostgresPool(
    { ...config, connectionString: url.toString() },
    { readOnly: true },
  );
  try {
    const identity = await pool.query(
      "SELECT current_database() AS db, current_user AS role",
    );
    assert.equal(identity.rows[0].db, "disburse_test");
    assert.equal(identity.rows[0].role, "disburse_test");
    await assertPostgresMigrationsCurrent(pool);
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      for (const client of clients) {
        const state = await client.query("SHOW default_transaction_read_only");
        assert.equal(state.rows[0].default_transaction_read_only, "on");
        await assert.rejects(
          client.query(
            "UPDATE public.execution_jobs SET state = state WHERE false",
          ),
          (e: unknown) => (e as { code: string }).code === "25006",
        );
      }
    } finally {
      for (const client of clients) client.release();
    }
  } finally {
    await pool.end();
  }
});
