import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import {
  applyPostgresMigrations,
  assertPostgresMigrationsCurrent,
} from "../../src/persistence/postgres-migrations.ts";
import {
  createPostgresPool,
  createPostgresQuery,
} from "../../src/persistence/postgres-pool.ts";
import {
  PostgresAuthorizationRepository,
  PostgresRefundPolicyRepository,
  type PostgresQuery,
} from "../../src/persistence/postgres-security-repositories.ts";
import { makeAuthorizationFixture } from "./postgres-fixtures.ts";
import { createExecutionAuthorization } from "../../src/providers/signing.ts";
import { fingerprintRefundPolicy } from "../../src/providers/refund.ts";

// This file is deliberately outside tests/*.test.ts. It runs only through
// `pnpm test:postgres` and never applies migrations or substitutes mocks.
const config = loadPostgresRuntimeConfig("test");
const pool = createPostgresPool(config);
const query = createPostgresQuery(pool);
const authorizations = new PostgresAuthorizationRepository(query);
const refundPolicies = new PostgresRefundPolicyRepository(query);
const seed = `pg-it-${randomUUID()}`;

before(async () => {
  const identity = await pool.query<{ database: string; role: string }>(
    "SELECT current_database() AS database, current_user AS role",
  );
  assert.equal(identity.rows[0]?.database, "disburse_test");
  assert.equal(identity.rows[0]?.role, "disburse_test");
  await applyPostgresMigrations(pool);
  await assertPostgresMigrationsCurrent(pool);
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
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  let values;
  try {
    const [queryA, queryB] = barrierQueries(
      clients.map(createPostgresQuery),
      "INSERT INTO execution_authorizations",
    );
    values = await Promise.all([
      new PostgresAuthorizationRepository(queryA!).create(
        fixture.authorization,
      ),
      new PostgresAuthorizationRepository(queryB!).create(
        fixture.authorization,
      ),
    ]);
  } finally {
    clients.forEach((client) => client.release());
  }
  assert.equal(values[0]?.authorizationId, values[1]?.authorizationId);
  assert.equal(
    await countRows(
      "execution_authorizations",
      fixture.authorization.authorizationId,
    ),
    1,
  );
  const changedRequest = {
    ...fixture.request,
    quoteReference: `${fixture.request.quoteReference}-conflict`,
  };
  const changedQuote = {
    ...fixture.quote,
    quoteReference: changedRequest.quoteReference,
  };
  const conflictingAuthorization = createExecutionAuthorization(
    changedRequest,
    fixture.policy,
    fixture.reservation,
    changedQuote,
  );
  const conflictClients = await Promise.all([pool.connect(), pool.connect()]);
  let conflictingResults;
  try {
    const [queryA, queryB] = barrierQueries(
      conflictClients.map(createPostgresQuery),
      "INSERT INTO execution_authorizations",
    );
    conflictingResults = await Promise.allSettled([
      new PostgresAuthorizationRepository(queryA!).create(
        fixture.authorization,
      ),
      new PostgresAuthorizationRepository(queryB!).create(
        conflictingAuthorization,
      ),
    ]);
  } finally {
    conflictClients.forEach((client) => client.release());
  }
  assert.equal(
    conflictingResults.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    conflictingResults.filter((result) => result.status === "rejected").length,
    1,
  );
});

void test("database arbitrates concurrent one-time authorization consumption", async () => {
  const fixture = makeAuthorizationFixture(`${seed}-consume`);
  const created = await authorizations.create(fixture.authorization);
  await authorizations.approve(created.authorizationId, Date.now());
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  let attempts;
  try {
    const [queryA, queryB] = barrierQueries(
      clients.map(createPostgresQuery),
      "SET lifecycle = 'Consumed'",
    );
    attempts = await Promise.allSettled([
      new PostgresAuthorizationRepository(queryA!).consume(
        created.authorizationId,
        fixture.request,
        fixture.policy,
        fixture.reservation,
        fixture.quote,
        Date.now(),
      ),
      new PostgresAuthorizationRepository(queryB!).consume(
        created.authorizationId,
        fixture.request,
        fixture.policy,
        fixture.reservation,
        fixture.quote,
        Date.now(),
      ),
    ]);
  } finally {
    clients.forEach((client) => client.release());
  }
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
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  let results;
  try {
    const [queryA, queryB] = barrierQueries(
      clients.map(createPostgresQuery),
      "SET lifecycle =",
    );
    const consumer = new PostgresAuthorizationRepository(queryA!);
    const revoker = new PostgresAuthorizationRepository(queryB!);
    results = await Promise.allSettled([
      consumer.consume(
        created.authorizationId,
        fixture.request,
        fixture.policy,
        fixture.reservation,
        fixture.quote,
        Date.now(),
      ),
      revoker.revoke(created.authorizationId, Date.now()),
    ]);
  } finally {
    clients.forEach((client) => client.release());
  }
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
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    const pids = await Promise.all(
      clients.map(async (client) => {
        const result = await client.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        return result.rows[0]?.pid;
      }),
    );
    assert.notEqual(pids[0], pids[1]);
    const [queryA, queryB] = barrierQueries(
      clients.map(createPostgresQuery),
      "INSERT INTO payout_refund_policies",
    );
    const [first, duplicate] = await Promise.all([
      new PostgresRefundPolicyRepository(queryA!).approve(fixture.refundPolicy),
      new PostgresRefundPolicyRepository(queryB!).approve(fixture.refundPolicy),
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
  } finally {
    clients.forEach((client) => client.release());
  }
});

void test("concurrent conflicting refund bindings retain one authoritative policy", async () => {
  const fixture = makeAuthorizationFixture(`${seed}-refund-race`);
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  const [queryA, queryB] = barrierQueries(
    clients.map(createPostgresQuery),
    "INSERT INTO payout_refund_policies",
  );
  const repositoryA = new PostgresRefundPolicyRepository(queryA!);
  const repositoryB = new PostgresRefundPolicyRepository(queryB!);
  const alternate = {
    ...fixture.refundPolicy,
    refundAddress: "alternate-treasury.near",
  };
  let results;
  try {
    results = await Promise.allSettled([
      repositoryA.approve(fixture.refundPolicy),
      repositoryB.approve(alternate),
    ]);
  } finally {
    clients.forEach((client) => client.release());
  }
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const persisted = await refundPolicies.get(
    fixture.refundPolicy.campaignId,
    fixture.refundPolicy.payoutId,
  );
  assert.ok(persisted);
  assert.ok(
    persisted.fingerprint === fingerprintRefundPolicy(fixture.refundPolicy) ||
      persisted.fingerprint === fingerprintRefundPolicy(alternate),
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
  const committed = makeAuthorizationFixture(`${seed}-commit`);
  const commitClient = await pool.connect();
  const commitAuthorizationRepository = new PostgresAuthorizationRepository(
    createPostgresQuery(commitClient),
  );
  const commitRefundRepository = new PostgresRefundPolicyRepository(
    createPostgresQuery(commitClient),
  );
  try {
    await commitClient.query("BEGIN");
    await commitAuthorizationRepository.create(committed.authorization);
    await commitRefundRepository.approve(committed.refundPolicy);
    await commitClient.query("COMMIT");
  } finally {
    commitClient.release();
  }
  assert.equal(
    (await authorizations.get(committed.authorization.authorizationId))
      ?.authorizationHash,
    committed.authorization.authorizationHash,
  );
  assert.equal(
    (
      await refundPolicies.get(
        committed.refundPolicy.campaignId,
        committed.refundPolicy.payoutId,
      )
    )?.fingerprint,
    fingerprintRefundPolicy(committed.refundPolicy),
  );

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
    throw new Error("injected application failure after both writes");
  } catch (error) {
    await client.query("ROLLBACK");
    assert.match(String(error), /injected application failure/);
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

  const constraintFixture = makeAuthorizationFixture(
    `${seed}-constraint-rollback`,
  );
  const constraintClient = await pool.connect();
  const constraintRepository = new PostgresAuthorizationRepository(
    createPostgresQuery(constraintClient),
  );
  try {
    await constraintClient.query("BEGIN");
    await constraintRepository.create(constraintFixture.authorization);
    await assert.rejects(() =>
      constraintClient.query(
        "INSERT INTO execution_authorizations (authorization_id, campaign_id, payout_id) VALUES ($1, 'invalid-id', '1')",
        [`bad-${seed}`],
      ),
    );
    await constraintClient.query("ROLLBACK");
  } finally {
    constraintClient.release();
  }
  assert.equal(
    await authorizations.get(constraintFixture.authorization.authorizationId),
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

function barrierQueries(
  queries: readonly PostgresQuery[],
  matchingSql: string,
): PostgresQuery[] {
  const parties = queries.length;
  let arrived = 0;
  let openGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  return queries.map((query) => async (statement, parameters) => {
    if (statement.includes(matchingSql)) {
      arrived += 1;
      if (arrived === parties) openGate?.();
      await gate;
    }
    return query(statement, parameters);
  });
}
