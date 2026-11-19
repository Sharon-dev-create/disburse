import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  createPostgresPool,
  createPostgresQuery,
} from "../../src/persistence/postgres-pool.ts";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import {
  PostgresAuthorizationRepository,
  type PostgresQuery,
} from "../../src/persistence/postgres-security-repositories.ts";
import {
  makeAuthorizationFixture,
  type AuthorizationFixture,
} from "./postgres-fixtures.ts";
const config = loadPostgresRuntimeConfig("test");
const pool = createPostgresPool(config);
const query = createPostgresQuery(pool);
const repo = new PostgresAuthorizationRepository(query);
before(async () => {
  const row = (
    await pool.query(
      "SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host",
    )
  ).rows[0];
  assert.deepEqual(row, {
    db: "disburse_test",
    role: "disburse_test",
    host: "127.0.0.1",
  });
});
after(async () => pool.end());
async function fixture(ttlMs = 10000, approve = true) {
  const f = makeAuthorizationFixture(`expiry-${randomUUID()}`, { ttlMs });
  await repo.create(f.authorization);
  if (approve) await repo.approve(f.authorization.authorizationId, Date.now());
  return f;
}
function consume(f: AuthorizationFixture, repository = repo) {
  return repository.consume(
    f.authorization.authorizationId,
    f.request,
    f.policy,
    f.reservation,
    f.quote,
    Date.parse(f.authorization.authorizedAt),
  );
}
async function persisted(f: AuthorizationFixture) {
  return (
    await pool.query(
      "SELECT lifecycle,authorization_hash,authorization_expires_at,approved_at,consumed_at,revoked_at,expired_at FROM execution_authorizations WHERE authorization_id=$1",
      [f.authorization.authorizationId],
    )
  ).rows[0];
}
async function waitForExpiry(f: AuthorizationFixture) {
  await pool.query(
    "SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (authorization_expires_at-clock_timestamp())))+0.02) FROM execution_authorizations WHERE authorization_id=$1",
    [f.authorization.authorizationId],
  );
  assert.equal(
    (
      await pool.query(
        "SELECT authorization_expires_at<=clock_timestamp() AS expired FROM execution_authorizations WHERE authorization_id=$1",
        [f.authorization.authorizationId],
      )
    ).rows[0].expired,
    true,
  );
}
async function blockedDecision(
  f: AuthorizationFixture,
  action: () => Promise<unknown>,
  expire = true,
  revoke = false,
) {
  const blocker = await pool.connect();
  let pending: Promise<{ accepted: boolean; error?: string }> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT authorization_id FROM execution_authorizations WHERE authorization_id=$1 FOR UPDATE",
      [f.authorization.authorizationId],
    );
    const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    let complete = false;
    pending = action()
      .then(
        () => ({ accepted: true }),
        (e) => ({ accepted: false, error: String(e) }),
      )
      .finally(() => {
        complete = true;
      });
    let blocked = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !complete) {
      if (
        (
          await pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
            [pid],
          )
        ).rows[0].blocked
      ) {
        blocked = true;
        break;
      }
      await pool.query("SELECT pg_sleep(0.005)");
    }
    assert.ok(
      blocked,
      "decision must actually wait on the conflicting row lock",
    );
    if (expire) await waitForExpiry(f);
    if (revoke)
      await new PostgresAuthorizationRepository(
        createPostgresQuery(blocker),
      ).revoke(f.authorization.authorizationId, Date.now());
    const releasedAt = (await blocker.query("SELECT clock_timestamp() AS now"))
      .rows[0].now as Date;
    await blocker.query("COMMIT");
    return { blocked, releasedAt, ...(await pending) };
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending;
  }
}
void test("consumption before expiry records a valid single consumption", async () => {
  const f = await fixture();
  await consume(f);
  const row = await persisted(f);
  assert.equal(row.lifecycle, "Consumed");
  assert.ok(row.consumed_at < row.authorization_expires_at);
});
void test("expired before consumption rejects despite a stale caller clock", async () => {
  const f = await fixture(1000);
  await waitForExpiry(f);
  await assert.rejects(consume(f), /expired/i);
  const row = await persisted(f);
  assert.equal(row.lifecycle, "Expired");
  assert.equal(row.consumed_at, null);
  assert.equal(row.authorization_hash, f.authorization.authorizationHash);
});
void test("consumption rejects expiry during row-lock wait", async (t) => {
  const f = await fixture(2000);
  const result = await blockedDecision(f, () => consume(f));
  const row = await persisted(f);
  t.diagnostic(
    JSON.stringify({
      result,
      lifecycle: row.lifecycle,
      consumedAt: row.consumed_at,
      expiresAt: row.authorization_expires_at,
    }),
  );
  assert.equal(
    result.accepted,
    false,
    "authorization must not be consumed after lock-wait expiry",
  );
  assert.equal(row.lifecycle, "Expired");
  assert.equal(row.consumed_at, null);
});
void test("valid short lock wait samples consumption time after acquiring the lock", async () => {
  const f = await fixture();
  const result = await blockedDecision(f, () => consume(f), false);
  assert.equal(result.accepted, true);
  const row = await persisted(f);
  assert.ok(row.consumed_at >= result.releasedAt);
  assert.ok(row.consumed_at < row.authorization_expires_at);
});
void test("expiry immediately before the protected database decision rejects", async () => {
  const f = await fixture(1000);
  let delayed = false;
  const q: PostgresQuery = async (sql, args) => {
    if (sql.includes("SET lifecycle = 'Consumed'")) {
      await waitForExpiry(f);
      delayed = true;
    }
    return query(sql, args);
  };
  await assert.rejects(
    consume(f, new PostgresAuthorizationRepository(q)),
    /expired/i,
  );
  assert.ok(delayed);
  assert.equal((await persisted(f)).consumed_at, null);
});
void test("two current consumers have one winner", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([consume(f), consume(f)]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await persisted(f)).lifecycle, "Consumed");
});
void test("revocation during consumption lock contention wins without consumption", async () => {
  const f = await fixture();
  const result = await blockedDecision(f, () => consume(f), false, true);
  assert.equal(result.accepted, false);
  const row = await persisted(f);
  assert.equal(row.lifecycle, "Revoked");
  assert.equal(row.consumed_at, null);
});
void test("already consumed authorization rejects without changing stored state", async () => {
  const f = await fixture();
  await consume(f);
  const before = await persisted(f);
  await assert.rejects(consume(f));
  assert.deepEqual(await persisted(f), before);
});
void test("failed transaction rolls a successful consumption update back", async () => {
  const f = await fixture();
  const client = await pool.connect();
  const q = createPostgresQuery(client);
  try {
    await client.query("BEGIN");
    const broken: PostgresQuery = async (sql, args) => {
      const result = await q(sql, args);
      if (sql.includes("SET lifecycle = 'Consumed'"))
        throw new Error("injected failure after update");
      return result;
    };
    await assert.rejects(
      consume(f, new PostgresAuthorizationRepository(broken)),
      /injected failure/,
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  assert.equal((await persisted(f)).lifecycle, "Approved");
  assert.equal((await persisted(f)).consumed_at, null);
  await consume(f);
});
void test("consumption persists across pool and repository restart", async () => {
  const f = await fixture();
  await consume(f);
  const replacement = createPostgresPool(config);
  try {
    const restarted = new PostgresAuthorizationRepository(
      createPostgresQuery(replacement),
    );
    assert.equal(
      (await restarted.get(f.authorization.authorizationId))?.lifecycle,
      "Consumed",
    );
    await assert.rejects(consume(f, restarted));
  } finally {
    await replacement.end();
  }
});
for (const [offset, accepted] of [
  [-1, true],
  [0, false],
  [1, false],
] as const) {
  void test(`exclusive expiry boundary with controlled database decision clock offset ${offset} microseconds`, async () => {
    const f = await fixture();
    let substituted = false;
    // Execute the production SQL predicate in real PostgreSQL with an exact decision-time fixture.
    // This does not pretend a naturally sampled wall clock can deterministically hit one microsecond.
    const q: PostgresQuery = async (sql, args) => {
      if (sql.includes("SET lifecycle = 'Consumed'")) {
        assert.match(sql, /clock_timestamp\(\)/);
        sql = sql.replace(
          "clock_timestamp()",
          `(SELECT authorization_expires_at + interval '${offset} microseconds' FROM execution_authorizations WHERE authorization_id=$1)`,
        );
        substituted = true;
      }
      return query(sql, args);
    };
    const result = await consume(
      f,
      new PostgresAuthorizationRepository(q),
    ).then(
      () => true,
      () => false,
    );
    assert.ok(substituted);
    assert.equal(result, accepted);
    assert.equal(
      (await persisted(f)).lifecycle,
      accepted ? "Consumed" : "Approved",
    );
  });
}
void test("approval after expiry during row-lock wait becomes Expired", async () => {
  const f = await fixture(2000, false);
  const result = await blockedDecision(f, () =>
    repo.approve(f.authorization.authorizationId, Date.now()),
  );
  assert.equal(result.accepted, false);
  const row = await persisted(f);
  assert.equal(row.lifecycle, "Expired");
  assert.equal(row.approved_at, null);
});
void test("revocation after expiry during row-lock wait preserves expiry lifecycle", async () => {
  const f = await fixture(2000);
  const result = await blockedDecision(f, () =>
    repo.revoke(f.authorization.authorizationId, Date.now()),
  );
  assert.equal(result.accepted, true);
  const row = await persisted(f);
  assert.equal(row.lifecycle, "Expired");
  assert.equal(row.revoked_at, null);
});
