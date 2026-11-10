import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import { assertPostgresMigrationsCurrent } from "../../src/persistence/postgres-migrations.ts";
import {
  createPostgresPool,
  createPostgresQuery,
} from "../../src/persistence/postgres-pool.ts";
import {
  PostgresAuthorizationRepository,
  PostgresRefundPolicyRepository,
} from "../../src/persistence/postgres-security-repositories.ts";
import { makeAuthorizationFixture } from "./postgres-fixtures.ts";

// This file is deliberately outside tests/*.test.ts. It runs only through
// `pnpm test:postgres` and never applies migrations or substitutes mocks.
const config = loadPostgresRuntimeConfig("test");
const pool = createPostgresPool(config);
const query = createPostgresQuery(pool);
const authorizations = new PostgresAuthorizationRepository(query);
const refundPolicies = new PostgresRefundPolicyRepository(query);
const seed = `pg-it-${randomUUID()}`;

before(async () => {
  await assertPostgresMigrationsCurrent(pool);
  const identity = await pool.query<{ database: string; role: string }>(
    "SELECT current_database() AS database, current_user AS role",
  );
  assert.equal(identity.rows[0]?.database, "disburse_test");
  assert.equal(identity.rows[0]?.role, "disburse_test");
});

after(async () => pool.end());

void test("persists complete authorization payload and safely parameterizes lookups", async () => {
  const fixture = makeAuthorizationFixture(`${seed}-roundtrip`);
  const stored = await authorizations.create(fixture.authorization);
  assert.equal(
    stored.authorizationHash,
    fixture.authorization.authorizationHash,
  );
  assert.deepEqual(await authorizations.get(stored.authorizationId), stored);
  assert.equal(await authorizations.get(`missing' OR '1'='1`), null);
  assert.deepEqual(
    await authorizations.getByCampaignPayoutAttempt(
      stored.campaignId,
      stored.payoutId,
      stored.executionAttemptId,
    ),
    stored,
  );
});

void test("concurrent discovery is idempotent and conflicting protected data is rejected", async () => {
  const fixture = makeAuthorizationFixture(`${seed}-duplicate`);
  const values = await Promise.all([
    authorizations.create(fixture.authorization),
    authorizations.create(fixture.authorization),
  ]);
  assert.equal(values[0]?.authorizationId, values[1]?.authorizationId);
  assert.equal(
    await countRows(
      "execution_authorizations",
      fixture.authorization.authorizationId,
    ),
    1,
  );
  await assert.rejects(
    () =>
      authorizations.create({
        ...fixture.authorization,
        authorizationHash: "0".repeat(64),
      }),
    /hash|protected fields/i,
  );
});

void test("database arbitrates concurrent one-time authorization consumption", async () => {
  const fixture = makeAuthorizationFixture(`${seed}-consume`);
  const created = await authorizations.create(fixture.authorization);
  await authorizations.approve(created.authorizationId, Date.now());
  const attempts = await Promise.allSettled([
    authorizations.consume(
      created.authorizationId,
      fixture.request,
      fixture.policy,
      fixture.reservation,
      fixture.quote,
      Date.now(),
    ),
    authorizations.consume(
      created.authorizationId,
      fixture.request,
      fixture.policy,
      fixture.reservation,
      fixture.quote,
      Date.now(),
    ),
  ]);
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    attempts.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal(
    (await authorizations.get(created.authorizationId))?.lifecycle,
    "Consumed",
  );
});

void test("database statement time expires an authorization after its deadline", async () => {
  const nowMs = Date.now() - 60 * 60 * 1000;
  const fixture = makeAuthorizationFixture(`${seed}-expired`, { nowMs });
  const created = await authorizations.create(fixture.authorization);
  await assert.rejects(
    () => authorizations.approve(created.authorizationId, Date.now()),
    /expired/i,
  );
  assert.equal(
    (await authorizations.get(created.authorizationId))?.lifecycle,
    "Expired",
  );
});

void test("revocation and consumption race has exactly one terminal winner", async () => {
  const fixture = makeAuthorizationFixture(`${seed}-revoke-race`);
  const created = await authorizations.create(fixture.authorization);
  await authorizations.approve(created.authorizationId, Date.now());
  const results = await Promise.allSettled([
    authorizations.consume(
      created.authorizationId,
      fixture.request,
      fixture.policy,
      fixture.reservation,
      fixture.quote,
      Date.now(),
    ),
    authorizations.revoke(created.authorizationId, Date.now()),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const final = await authorizations.get(created.authorizationId);
  assert.ok(final?.lifecycle === "Consumed" || final?.lifecycle === "Revoked");
});

void test("refund policy binds once, survives concurrent duplicate approval, and is immutable", async () => {
  const fixture = makeAuthorizationFixture(`${seed}-refund`);
  const [first, duplicate] = await Promise.all([
    refundPolicies.approve(fixture.refundPolicy),
    refundPolicies.approve(fixture.refundPolicy),
  ]);
  assert.equal(first.fingerprint, duplicate.fingerprint);
  assert.equal(
    (
      await refundPolicies.get(
        fixture.refundPolicy.campaignId,
        fixture.refundPolicy.payoutId,
      )
    )?.fingerprint,
    first.fingerprint,
  );
  await assert.rejects(
    () =>
      refundPolicies.approve({
        ...fixture.refundPolicy,
        refundAddress: "another-treasury.near",
      }),
    /immutable|already approved/i,
  );
  await assert.rejects(
    () =>
      pool.query(
        "UPDATE payout_refund_policies SET refund_address = $1 WHERE campaign_id = $2 AND payout_id = $3",
        [
          "changed.near",
          fixture.refundPolicy.campaignId,
          fixture.refundPolicy.payoutId,
        ],
      ),
    /immutable/i,
  );
  await assert.rejects(
    () =>
      pool.query(
        "DELETE FROM payout_refund_policies WHERE campaign_id = $1 AND payout_id = $2",
        [fixture.refundPolicy.campaignId, fixture.refundPolicy.payoutId],
      ),
    /immutable/i,
  );
});

void test("a fresh process can read and consume durable authorization state", async () => {
  const { spawnSync } = await import("node:child_process");
  const nowMs = Date.now();
  const fixture = makeAuthorizationFixture(`${seed}-restart`, { nowMs });
  const script = new URL("./postgres-restart-child.ts", import.meta.url);
  const run = (mode: "write" | "read-consume") =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        script.pathname,
        mode,
        `${seed}-restart`,
        String(nowMs),
      ],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" },
    );

  const writer = run("write");
  assert.equal(writer.status, 0, `writer subprocess failed (${writer.status})`);
  const reader = run("read-consume");
  assert.equal(reader.status, 0, `reader subprocess failed (${reader.status})`);
  assert.equal(
    (await authorizations.get(fixture.authorization.authorizationId))
      ?.lifecycle,
    "Consumed",
  );
});

void test("transaction rollback removes writes and leaves the pooled connection usable", async () => {
  const fixture = makeAuthorizationFixture(`${seed}-rollback`);
  const client = await pool.connect();
  const transactionalRepository = new PostgresAuthorizationRepository(
    createPostgresQuery(client),
  );
  const transactionalRefundRepository = new PostgresRefundPolicyRepository(
    createPostgresQuery(client),
  );
  try {
    await client.query("BEGIN");
    await transactionalRepository.create(fixture.authorization);
    await transactionalRefundRepository.approve(fixture.refundPolicy);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  assert.equal(
    await authorizations.get(fixture.authorization.authorizationId),
    null,
  );
  assert.equal(
    await refundPolicies.get(
      fixture.refundPolicy.campaignId,
      fixture.refundPolicy.payoutId,
    ),
    null,
  );
  assert.equal((await pool.query("SELECT 1 AS ready")).rows[0]?.ready, 1);
});

void test("separate pool connections observe shared committed state", async () => {
  const secondPool = createPostgresPool(config);
  try {
    const [left, right] = await Promise.all([
      pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"),
      secondPool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"),
    ]);
    assert.notEqual(left.rows[0]?.pid, right.rows[0]?.pid);
    const fixture = makeAuthorizationFixture(`${seed}-multipool`);
    await authorizations.create(fixture.authorization);
    const remoteRepository = new PostgresAuthorizationRepository(
      createPostgresQuery(secondPool),
    );
    assert.equal(
      (await remoteRepository.get(fixture.authorization.authorizationId))
        ?.authorizationHash,
      fixture.authorization.authorizationHash,
    );
  } finally {
    await secondPool.end();
  }
});

async function countRows(
  table: string,
  authorizationId: string,
): Promise<number> {
  assert.equal(table, "execution_authorizations");
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM execution_authorizations WHERE authorization_id = $1",
    [authorizationId],
  );
  return Number(result.rows[0]?.count ?? "0");
}
