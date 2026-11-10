import assert from "node:assert/strict";
import test from "node:test";
import { loadPostgresRuntimeConfig } from "../src/persistence/postgres-config.ts";

void test("PostgreSQL test configuration requires the isolated local test target", () => {
  const config = loadPostgresRuntimeConfig("test", {
    DISBURSE_TEST_DATABASE_URL:
      "postgresql://disburse_test:masked%40secret@127.0.0.1:5432/disburse_test",
  });
  assert.equal(config.target, "test");
  assert.equal(config.maxConnections, 10);
  assert.equal(config.connectionTimeoutMs, 5_000);
  assert.equal(config.queryTimeoutMs, 15_000);
});

void test("PostgreSQL test configuration fails closed for absent or unsafe targets", () => {
  assert.throws(
    () => loadPostgresRuntimeConfig("test", {}),
    /DISBURSE_TEST_DATABASE_URL is required/,
  );
  for (const connectionString of [
    "postgresql://disburse_test:secret@db.example:5432/disburse_test",
    "postgresql://disburse_test:secret@127.0.0.1:5432/disburse_dev",
    "postgresql://disburse_dev:secret@127.0.0.1:5432/disburse_test",
    "mysql://disburse_test:secret@127.0.0.1:5432/disburse_test",
  ]) {
    assert.throws(
      () =>
        loadPostgresRuntimeConfig("test", {
          DISBURSE_TEST_DATABASE_URL: connectionString,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes("secret"), false);
        return true;
      },
    );
  }
});

void test("development and test configuration cannot silently share a database", () => {
  assert.throws(
    () =>
      loadPostgresRuntimeConfig("development", {
        DISBURSE_DEV_DATABASE_URL:
          "postgresql://disburse_test:secret@127.0.0.1:5432/disburse_test",
      }),
    /must target local database disburse_dev as role disburse_dev/,
  );
});
