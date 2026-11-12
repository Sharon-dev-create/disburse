import assert from "node:assert/strict";
import test from "node:test";
import { assertMigrationHistoryMatches } from "../src/persistence/postgres-migrations.ts";

const migration = {
  version: "0002",
  name: "execution_jobs",
  checksum: "a".repeat(64),
};

void test("migration history rejects checksum, name, missing, and unknown-version drift", () => {
  assert.doesNotThrow(() =>
    assertMigrationHistoryMatches([migration], [migration]),
  );
  assert.throws(
    () =>
      assertMigrationHistoryMatches(
        [migration],
        [{ ...migration, checksum: "b".repeat(64) }],
      ),
    /name or checksum mismatch/,
  );
  assert.throws(
    () =>
      assertMigrationHistoryMatches(
        [migration],
        [{ ...migration, name: "other_name" }],
      ),
    /name or checksum mismatch/,
  );
  assert.throws(
    () => assertMigrationHistoryMatches([migration], []),
    /has not been applied/,
  );
  assert.throws(
    () =>
      assertMigrationHistoryMatches(
        [migration],
        [migration, { ...migration, version: "0003" }],
      ),
    /unknown migration version/,
  );
});
