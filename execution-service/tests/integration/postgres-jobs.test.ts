import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { PoolClient } from "pg";
import type {
  PayoutReservedEvent,
  PayoutSnapshot,
} from "../../src/domain/payout.ts";
import {
  applyPostgresMigrations,
  assertPostgresMigrationsCurrent,
} from "../../src/persistence/postgres-migrations.ts";
import {
  createPostgresPool,
  createPostgresQuery,
} from "../../src/persistence/postgres-pool.ts";
import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import {
  JobCreationConflictError,
  PostgresJobRepository,
  StaleExecutionJobError,
  type PostgresJobClient,
  type PostgresJobPool,
} from "../../src/persistence/postgres-job-repository.ts";
import type { ExecutionJobCreation } from "../../src/persistence/repository.ts";
import type { PostgresQuery } from "../../src/persistence/postgres-security-repositories.ts";

const config = loadPostgresRuntimeConfig("test");
const pool = createPostgresPool(config);
const seed = `jobs-${randomUUID()}`;
let nextId =
  BigInt(Date.now()) * 1_000_000n +
  BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 12)}`);

before(async () => {
  const identity = await pool.query<{ database: string; role: string }>(
    "SELECT current_database() AS database, current_user AS role",
  );
  assert.equal(identity.rows[0]?.database, "disburse_test");
  assert.equal(identity.rows[0]?.role, "disburse_test");
  await applyPostgresMigrations(pool);
  await assertPostgresMigrationsCurrent(pool);
  await repositoryForPool(pool).recoverExpiredLeases(Date.now());
  await pool.query(
    `UPDATE public.execution_jobs
     SET next_eligible_at = statement_timestamp() + interval '1 day'
     WHERE state = 'Queued'`,
  );
  const claimable = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM public.execution_jobs j
     LEFT JOIN public.job_leases l ON l.job_id = j.job_id
     WHERE j.state IN ('Queued', 'Leased')
       AND j.next_eligible_at <= statement_timestamp()
       AND (l.job_id IS NULL OR l.expires_at <= statement_timestamp())`,
  );
  assert.equal(claimable.rows[0]?.count, "0");
});

after(async () => pool.end());

void test("job migrations apply idempotently and record version 0004", async () => {
  const first = await applyPostgresMigrations(pool);
  const second = await applyPostgresMigrations(pool);
  assert.deepEqual(first.applied, []);
  assert.deepEqual(second.applied, []);
  assert.equal(first.currentVersion, "0004");
  assert.equal(second.currentVersion, "0004");
});

void test("creation is durable, idempotent, payout-unique, and preserves exact amounts", async () => {
  const repository = repositoryForPool(pool);
  const creation = makeCreation("creation");
  const created = await repository.createIdempotent(creation);
  const duplicate = await repository.createIdempotent(creation);
  const samePayoutNewKey = await repository.createIdempotent({
    ...creation,
    idempotencyKey: `${creation.idempotencyKey}-retry`,
  });

  assert.equal(created.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(samePayoutNewKey.created, false);
  assert.equal(created.job.jobId, duplicate.job.jobId);
  assert.equal(created.job.jobId, samePayoutNewKey.job.jobId);
  assert.equal(
    created.job.payout.inputAmount.atomicAmount,
    creation.payout.inputAmount.atomicAmount,
  );
  assert.equal(
    created.job.payout.expectedOutput.atomicAmount,
    creation.payout.expectedOutput.atomicAmount,
  );
  assert.match(created.job.jobId, /^[1-9]\d*$/);

  const restarted = repositoryForPool(pool);
  assert.deepEqual(await restarted.getById(created.job.jobId), created.job);
  assert.deepEqual(await restarted.getByPayout(created.job.key), created.job);
  assert.equal(await restarted.getById("9223372036854775807"), null);
  await assert.rejects(() => restarted.getById("90071992547409930000.5"));
});

void test("campaign job listing is scoped to the configured contract and campaign", async () => {
  const repository = repositoryForPool(pool);
  const campaignId = String(++nextId);
  const matching = makeCreation("campaign-list-match", campaignId);
  const otherCampaign = makeCreation(
    "campaign-list-other",
    String(BigInt(campaignId) + 1n),
  );
  const matchingJob = await repository.createIdempotent(matching);
  await repository.createIdempotent(otherCampaign);

  const listed = await repository.listByCampaign(
    { networkId: "near:testnet", contractId: "disburse.testnet" },
    campaignId,
    101,
  );
  assert.deepEqual(
    listed.map((job) => job.jobId),
    [matchingJob.job.jobId],
  );
});

void test("same idempotency key or payout identity rejects conflicting protected payloads", async () => {
  const repository = repositoryForPool(pool);
  const creation = makeCreation("conflict");
  await repository.createIdempotent(creation);
  await assert.rejects(
    () =>
      repository.createIdempotent({
        ...creation,
        payout: {
          ...creation.payout,
          expectedOutput: {
            ...creation.payout.expectedOutput,
            atomicAmount: "900719925474099312346",
          },
        },
      }),
    JobCreationConflictError,
  );
  await assert.rejects(
    () =>
      repository.createIdempotent({
        ...makeCreation("different-payout"),
        idempotencyKey: creation.idempotencyKey,
      }),
    JobCreationConflictError,
  );
});

void test("concurrent job creation on independent connections has one database winner", async () => {
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
    const queries = barrierQueries(
      clients.map(createPostgresQuery),
      "INSERT INTO execution_jobs",
    );
    const repositories = queries.map((query) => repositoryForClient(query));
    const creation = makeCreation("concurrent-create");
    const results = await Promise.all(
      repositories.map((repository) => repository.createIdempotent(creation)),
    );
    assert.equal(results.filter((item) => item.created).length, 1);
    assert.equal(results[0]?.job.jobId, results[1]?.job.jobId);
  } finally {
    clients.forEach((client) => client.release());
  }
});

void test("concurrent workers claim one queued job and stale lease writes are fenced", async () => {
  const creation = makeCreation("claim-race");
  const setup = repositoryForPool(pool);
  await enqueueQueued(setup, creation);
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
    const queries = barrierQueries(
      clients.map(createPostgresQuery),
      "j.job_id::text AS job_id, j.state, j.state_version",
    );
    const [left, right] = queries.map(repositoryForClient);
    const claims = await Promise.all([
      left!.claimNext("worker-left", Date.now(), 60_000),
      right!.claimNext("worker-right", Date.now(), 60_000),
    ]);
    assert.equal(claims.filter((job) => job !== null).length, 1);
    const claim = claims.find((job) => job !== null);
    assert.ok(claim?.lease);

    const preparing = await setup.transition(
      claim.key,
      claim.version,
      "Preparing",
      {},
      claim.lease,
      Date.now(),
    );
    assert.equal(preparing.lease?.stateVersion, preparing.version);
    await assert.rejects(
      () =>
        setup.recordFailure(
          claim.key,
          claim.lease!,
          { code: "stale-worker", description: "must not write" },
          Date.now(),
        ),
      StaleExecutionJobError,
    );
  } finally {
    clients.forEach((client) => client.release());
  }
});

void test("lease renewal, expiry replacement, and fencing counters survive repository restart", async () => {
  const repository = repositoryForPool(pool);
  const queued = await enqueueQueued(repository, makeCreation("lease-expiry"));
  const first = await repository.claimNext("worker-one", Date.now(), 1_000);
  assert.ok(first?.lease);
  const renewed = await repository.renewLease(
    first.key,
    first.lease,
    Date.now(),
    2_000,
  );
  assert.ok(renewed);
  assert.ok(renewed.stateVersion > first.version);
  await assert.rejects(
    () => repository.releaseLease(first.key, first.lease!, Date.now()),
    StaleExecutionJobError,
  );

  await new Promise((resolve) => setTimeout(resolve, 2_100));
  const second = await repository.claimNext("worker-two", Date.now(), 60_000);
  assert.ok(second?.lease);
  assert.equal(
    BigInt(second.lease.fencingToken),
    BigInt(renewed.fencingToken) + 1n,
  );
  await assert.rejects(
    () =>
      repository.appendAttempt(
        first.key,
        first.lease!,
        makeAttempt(1),
        Date.now(),
      ),
    StaleExecutionJobError,
  );
  assert.equal(
    (await repositoryForPool(pool).getById(queued.job.jobId))?.lease?.workerId,
    "worker-two",
  );
});

void test("attempts and safe failures are atomic and duplicate attempt idempotency rolls back", async () => {
  const repository = repositoryForPool(pool);
  const queued = await enqueueQueued(repository, makeCreation("attempts"));
  const claim = await repository.claimNext(
    "attempt-worker",
    Date.now(),
    60_000,
  );
  assert.ok(claim?.lease);
  const failed = await repository.recordFailure(
    claim.key,
    claim.lease,
    { code: "quote-unavailable", description: "Quote provider timed out" },
    Date.now(),
  );
  assert.equal(failed.failure?.code, "quote-unavailable");
  assert.equal(failed.lease?.stateVersion, failed.version);

  const firstAttempt = makeAttempt(1);
  await repository.appendAttempt(
    failed.key,
    failed.lease!,
    firstAttempt,
    Date.now(),
  );
  const afterAttempt = await repository.getById(queued.job.jobId);
  assert.ok(afterAttempt);
  assert.equal(afterAttempt.attemptCount, 1);
  assert.equal(afterAttempt.attempts.length, 1);
  const beforeConflict = afterAttempt;
  await assert.rejects(
    () =>
      repository.appendAttempt(
        afterAttempt.key,
        afterAttempt.lease!,
        { ...makeAttempt(2), idempotencyKey: firstAttempt.idempotencyKey },
        Date.now(),
      ),
    /Duplicate execution attempt/,
  );
  const afterRollback = await repository.getById(queued.job.jobId);
  assert.equal(afterRollback?.attemptCount, beforeConflict.attemptCount);
  assert.equal(afterRollback?.version, beforeConflict.version);
  assert.equal(afterRollback?.attempts.length, 1);
});

void test("expired ambiguous submission moves to manual review without releasing payout state", async () => {
  const repository = repositoryForPool(pool);
  const queued = await enqueueQueued(repository, makeCreation("recovery"));
  const claimed = await repository.claimNext(
    "recovery-worker",
    Date.now(),
    1_000,
  );
  assert.ok(claimed?.lease);
  const preparing = await repository.transition(
    claimed.key,
    claimed.version,
    "Preparing",
    {},
    claimed.lease,
    Date.now(),
  );
  const submissionStarted = await repository.transition(
    preparing.key,
    preparing.version,
    "SubmissionStarted",
    {},
    preparing.lease,
    Date.now(),
  );
  await repository.transition(
    submissionStarted.key,
    submissionStarted.version,
    "SubmissionUnknown",
    { providerOutcome: "unknown" },
    submissionStarted.lease,
    Date.now(),
  );

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const recovered = await repository.recoverExpiredLeases(Date.now());
  const persisted = await repository.getById(queued.job.jobId);
  assert.equal(recovered.recovered, 1);
  assert.equal(recovered.manualReview, 1);
  assert.equal(persisted?.state, "ManualReview");
  assert.equal(persisted?.lease, null);
  assert.equal(persisted?.payout.contractStatus, "Reserved");
});

void test("snapshot identity cannot be changed and job creation never mutates payout accounting", async () => {
  const repository = repositoryForPool(pool);
  const creation = makeCreation("immutable");
  const created = await repository.createIdempotent(creation);
  await assert.rejects(() =>
    pool.query(
      "UPDATE public.execution_jobs SET payout_snapshot = '{}'::jsonb WHERE job_id = $1::bigint",
      [created.job.jobId],
    ),
  );
  assert.equal(
    (await repository.getById(created.job.jobId))?.payout.expectedOutput
      .atomicAmount,
    creation.payout.expectedOutput.atomicAmount,
  );
});

function repositoryForPool(target: typeof pool): PostgresJobRepository {
  const pgPool: PostgresJobPool = {
    connect: async () => {
      const client = await target.connect();
      return clientAdapter(client);
    },
  };
  return new PostgresJobRepository(pgPool);
}

function repositoryForClient(query: PostgresQuery): PostgresJobRepository {
  const pgPool: PostgresJobPool = {
    connect: async () => ({ query, release: () => undefined }),
  };
  return new PostgresJobRepository(pgPool);
}

function clientAdapter(client: PoolClient): PostgresJobClient {
  return {
    query: createPostgresQuery(client),
    release: () => client.release(),
  };
}

function barrierQueries(
  queries: readonly PostgresQuery[],
  matchingSql: string,
): PostgresQuery[] {
  let arrived = 0;
  let openGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  return queries.map((query) => async (statement, parameters) => {
    if (statement.includes(matchingSql)) {
      arrived += 1;
      if (arrived === queries.length) openGate?.();
      await gate;
    }
    return query(statement, parameters);
  });
}

async function enqueueQueued(
  repository: PostgresJobRepository,
  creation: ExecutionJobCreation,
) {
  const created = await repository.createIdempotent(creation);
  const queued = await repository.transition(
    created.job.key,
    created.job.version,
    "Queued",
    { contractPayoutStatus: "Reserved" },
    null,
    Date.now(),
  );
  return { job: created.job, queued };
}

function makeCreation(suffix: string, campaignId = "7"): ExecutionJobCreation {
  const id = String(++nextId);
  const event: PayoutReservedEvent = {
    event: "payout_reserved",
    payoutId: id,
    campaignId,
    contractStatus: "Reserved",
    identity: {
      networkId: "near:testnet",
      contractId: "disburse.testnet",
      transactionHash: `${seed}-${suffix}-tx`,
      blockHash: `${seed}-${suffix}-block`,
      receiptId: `${seed}-${suffix}-receipt`,
      eventIndex: 0,
      blockHeight: "123456",
    },
  };
  const payout: PayoutSnapshot = {
    payoutId: id,
    campaignId,
    inputAmount: {
      tokenId: "near",
      atomicAmount: "900719925474099312345",
      decimals: 24,
    },
    destinationChainId: "near:testnet",
    recipientAddress: "recipient.near",
    expectedOutput: {
      tokenId: "wrap.near",
      atomicAmount: "900719925474099312345",
      decimals: 24,
    },
    contractStatus: "Reserved",
    executionReference: null,
    settlementEvidenceReference: null,
  };
  return { event, payout, idempotencyKey: `${seed}-${suffix}-idem` };
}

function makeAttempt(sequence: number) {
  return {
    attemptKey: `${seed}-attempt-${sequence}`,
    sequence,
    phase: "prepare" as const,
    idempotencyKey: `${seed}-attempt-idem-${sequence}`,
    startedAtMs: Date.now(),
    outcome: "started" as const,
  };
}

// M5-D.3: contention after initial lease validation, using the existing guarded test pool.
async function leaseFixture(ttlMs = 5000) {
  const repository = repositoryForPool(pool);
  const { job } = await enqueueQueued(
    repository,
    makeCreation(`lease-boundary-${randomUUID()}`),
  );
  await pool.query(
    "UPDATE public.execution_jobs SET next_eligible_at=clock_timestamp()+interval '1 day' WHERE job_id<>$1 AND state IN ('Queued','Leased')",
    [job.jobId],
  );
  const claim = await repository.claimNext("boundary-A", Date.now(), ttlMs);
  assert.ok(claim?.lease);
  assert.deepEqual(claim.key, job.key);
  return { repository, claim: { ...claim, jobId: job.jobId } };
}

async function contendLeaseWrite(
  match: string,
  table: "execution_jobs" | "job_leases",
  operation: (repository: PostgresJobRepository) => Promise<unknown>,
  rowLock = false,
) {
  const client = await pool.connect();
  const blocker = await pool.connect();
  let intercepted = false;
  let timing: Record<string, unknown> | undefined;
  try {
    await client.query("SET statement_timeout='5s'");
    await blocker.query("SET statement_timeout='5s'");
    const query = createPostgresQuery(client);
    const repository = repositoryForClient(async (sql, args) => {
      if (intercepted || !sql.includes(match)) return query(sql, args);
      intercepted = true;
      await blocker.query("BEGIN");
      // SHARE permits the preceding FOR UPDATE, but blocks the later mutation.
      if (rowLock) {
        await blocker.query(
          `SELECT job_id FROM public.${table} WHERE job_id=$1 FOR UPDATE`,
          [args[0]],
        );
      } else {
        await blocker.query(`LOCK TABLE public.${table} IN SHARE MODE`);
      }
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid"))
        .rows[0]!.pid as number;
      const start = performance.now();
      const settled = query(sql, args).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      let blocked = false;
      const deadline = Date.now() + 3000;
      try {
        while (Date.now() < deadline) {
          const r = await pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
            [pid],
          );
          if (r.rows[0]?.blocked) {
            blocked = true;
            break;
          }
          await pool.query("SELECT pg_sleep(0.01)");
        }
        assert.ok(blocked, "operation must actually wait on the held lock");
        await pool.query("SELECT pg_sleep(0.9)");
      } finally {
        await blocker.query("ROLLBACK");
      }
      const result = await settled;
      timing = {
        blocked,
        waitMs: performance.now() - start,
        rowCount: result.value?.rowCount,
        databaseTime: (await pool.query("SELECT clock_timestamp() AS t"))
          .rows[0]?.t,
      };
      if (result.error) throw result.error;
      return result.value!;
    });
    const outcome = await operation(repository).then(
      () => ({ accepted: true, error: null }),
      (error: unknown) => ({
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    assert.ok(intercepted, "test must reach the intended SQL boundary");
    return { ...outcome, timing };
  } finally {
    await blocker.query("ROLLBACK");
    await client.query("RESET statement_timeout");
    client.release();
    blocker.release();
  }
}

void test(
  "legacy transition rejects expiry during final write lock wait",
  { timeout: 10000 },
  async (t) => {
    const { repository, claim } = await leaseFixture(500);
    const before = await repository.getById(claim.jobId);
    const outcome = await contendLeaseWrite(
      "SET state = $4",
      "execution_jobs",
      (r) =>
        r.transition(
          claim.key,
          claim.version,
          "Preparing",
          {},
          claim.lease,
          Date.now(),
        ),
    );
    const after = await repository.getById(claim.jobId);
    t.diagnostic(
      JSON.stringify({ lease: claim.lease, before, outcome, after }),
    );
    assert.equal(outcome.accepted, false);
    assert.match(outcome.error!, /stale|expired/i);
    assert.deepEqual(after, before);
  },
);

void test(
  "legacy zero-row release cannot increment version",
  { timeout: 10000 },
  async (t) => {
    const { repository, claim } = await leaseFixture(500);
    const before = await repository.getById(claim.jobId);
    const outcome = await contendLeaseWrite(
      "DELETE FROM public.job_leases",
      "job_leases",
      (r) => r.releaseLease(claim.key, claim.lease!, Date.now()),
    );
    const after = await repository.getById(claim.jobId);
    t.diagnostic(
      JSON.stringify({
        expectedLease: claim.lease,
        initialVersion: before?.version,
        outcome,
        after,
      }),
    );
    assert.equal(outcome.timing?.rowCount, 0);
    assert.equal(outcome.accepted, false);
    assert.deepEqual(after, before);
  },
);

void test(
  "legacy validation rechecks fresh time after waiting for the lease row",
  { timeout: 10000 },
  async () => {
    const { repository, claim } = await leaseFixture(500);
    const before = await repository.getById(claim.jobId);
    const outcome = await contendLeaseWrite(
      "SELECT worker_id, fencing_token",
      "job_leases",
      (r) =>
        r.transition(
          claim.key,
          claim.version,
          "Preparing",
          {},
          claim.lease,
          Date.now(),
        ),
      true,
    );
    assert.equal(outcome.accepted, false);
    assert.deepEqual(await repository.getById(claim.jobId), before);
  },
);

void test(
  "legacy current worker can transition after bounded contention",
  { timeout: 10000 },
  async () => {
    const { repository, claim } = await leaseFixture();
    const outcome = await contendLeaseWrite(
      "SET state = $4",
      "execution_jobs",
      (r) =>
        r.transition(
          claim.key,
          claim.version,
          "Preparing",
          {},
          claim.lease,
          Date.now(),
        ),
    );
    assert.equal(outcome.accepted, true);
    const after = await repository.getById(claim.jobId);
    assert.equal(after?.state, "Preparing");
    assert.equal(after?.version, claim.version + 1);
    assert.equal(after?.lease?.fencingToken, claim.lease?.fencingToken);
  },
);

void test(
  "legacy wrong worker, fence and version cannot transition or release",
  { timeout: 10000 },
  async () => {
    const { repository, claim } = await leaseFixture();
    const before = await repository.getById(claim.jobId);
    for (const lease of [
      { ...claim.lease!, workerId: "not-owner" },
      {
        ...claim.lease!,
        fencingToken: String(BigInt(claim.lease!.fencingToken) - 1n),
      },
      { ...claim.lease!, stateVersion: claim.version - 1 },
    ]) {
      await assert.rejects(
        repository.transition(
          claim.key,
          claim.version,
          "Preparing",
          {},
          lease,
          Date.now(),
        ),
        StaleExecutionJobError,
      );
      await assert.rejects(
        repository.releaseLease(claim.key, lease, Date.now()),
        StaleExecutionJobError,
      );
      assert.deepEqual(await repository.getById(claim.jobId), before);
    }
  },
);

void test(
  "legacy reclaimed owner defeats stale transition and release including concurrent completion",
  { timeout: 10000 },
  async () => {
    const { repository, claim } = await leaseFixture(50);
    await pool.query("SELECT pg_sleep(0.1)");
    const fresh = await repository.claimNext("boundary-B", Date.now(), 5000);
    assert.ok(fresh?.lease);
    assert.deepEqual(fresh.key, claim.key);
    assert.ok(
      BigInt(fresh.lease.fencingToken) > BigInt(claim.lease!.fencingToken),
    );
    await assert.rejects(
      repository.releaseLease(claim.key, claim.lease!, Date.now()),
      StaleExecutionJobError,
    );
    assert.deepEqual(await repository.getById(claim.jobId), fresh);
    const results = await Promise.allSettled([
      repository.transition(
        claim.key,
        claim.version,
        "Preparing",
        {},
        claim.lease,
        Date.now(),
      ),
      repository.transition(
        fresh.key,
        fresh.version,
        "Preparing",
        {},
        fresh.lease,
        Date.now(),
      ),
    ]);
    assert.equal(results[0]!.status, "rejected");
    assert.equal(results[1]!.status, "fulfilled");
    const after = await repository.getById(claim.jobId);
    assert.equal(after?.version, fresh.version + 1);
    assert.equal(after?.lease?.workerId, "boundary-B");
  },
);

void test(
  "legacy valid release increments once and duplicate release changes nothing",
  { timeout: 10000 },
  async () => {
    const { repository, claim } = await leaseFixture();
    const released = await repository.releaseLease(
      claim.key,
      claim.lease!,
      Date.now(),
    );
    assert.equal(released.version, claim.version + 1);
    assert.equal(released.lease, null);
    assert.equal(released.state, claim.state);
    await assert.rejects(
      repository.releaseLease(claim.key, claim.lease!, Date.now()),
      StaleExecutionJobError,
    );
    assert.deepEqual(await repository.getById(claim.jobId), released);
  },
);

void test(
  "legacy concurrent release and transition have exactly one version winner",
  { timeout: 10000 },
  async () => {
    const { repository, claim } = await leaseFixture();
    const results = await Promise.allSettled([
      repository.releaseLease(claim.key, claim.lease!, Date.now()),
      repository.transition(
        claim.key,
        claim.version,
        "Preparing",
        {},
        claim.lease,
        Date.now(),
      ),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    const after = await repository.getById(claim.jobId);
    assert.equal(after?.version, claim.version + 1);
    if (results[0]!.status === "fulfilled") {
      assert.equal(after?.lease, null);
      assert.equal(after?.state, "Leased");
    } else {
      assert.equal(after?.state, "Preparing");
      assert.equal(after?.lease?.workerId, claim.lease?.workerId);
    }
  },
);

void test(
  "legacy failure after successful lease deletion rolls deletion and version back",
  { timeout: 10000 },
  async () => {
    const { repository, claim } = await leaseFixture();
    const before = await repository.getById(claim.jobId);
    const client = await pool.connect();
    let deleted = false;
    try {
      const query = createPostgresQuery(client);
      const failing = repositoryForClient(async (sql, args) => {
        if (sql.includes("SET state_version = state_version + 1")) {
          assert.ok(deleted);
          throw new Error("Injected post-deletion failure");
        }
        const result = await query(sql, args);
        if (sql.includes("DELETE FROM public.job_leases"))
          deleted = result.rowCount === 1;
        return result;
      });
      await assert.rejects(
        failing.releaseLease(claim.key, claim.lease!, Date.now()),
        /Injected post-deletion/,
      );
      assert.ok(deleted);
      assert.deepEqual(await repository.getById(claim.jobId), before);
    } finally {
      client.release();
    }
  },
);

void test(
  "legacy expired cleanup remains available without stale worker authority",
  { timeout: 10000 },
  async () => {
    const { repository, claim } = await leaseFixture(50);
    await pool.query("SELECT pg_sleep(0.1)");
    const before = await repository.getById(claim.jobId);
    await assert.rejects(
      repository.releaseLease(claim.key, claim.lease!, Date.now()),
      StaleExecutionJobError,
    );
    assert.deepEqual(await repository.getById(claim.jobId), before);
    const result = await repository.recoverExpiredLeases(Date.now());
    assert.ok(result.recovered >= 1);
    const after = await repository.getById(claim.jobId);
    assert.equal(after?.lease, null);
    assert.equal(after?.state, "Queued");
    assert.equal(after?.version, claim.version + 1);
    assert.deepEqual(after?.payout, claim.payout);
    await assert.rejects(
      repository.releaseLease(claim.key, claim.lease!, Date.now()),
      StaleExecutionJobError,
    );
    assert.deepEqual(await repository.getById(claim.jobId), after);
  },
);

for (const operation of [
  "renewal",
  "attempt",
  "failure",
  "terminal",
] as const) {
  void test(
    `legacy ${operation} rolls back expiry during its later write`,
    { timeout: 10000 },
    async () => {
      const { repository, claim } = await leaseFixture(500);
      const before = await repository.getById(claim.jobId);
      const match =
        operation === "renewal"
          ? "SET renewed_at"
          : operation === "terminal"
            ? "DELETE FROM public.job_leases"
            : "UPDATE public.execution_jobs";
      const table =
        operation === "renewal" || operation === "terminal"
          ? "job_leases"
          : "execution_jobs";
      const outcome = await contendLeaseWrite(match, table, (r) => {
        if (operation === "renewal")
          return r.renewLease(claim.key, claim.lease!, Date.now(), 5000);
        if (operation === "attempt")
          return r.appendAttempt(
            claim.key,
            claim.lease!,
            {
              ...makeAttempt(1),
              attemptKey: randomUUID(),
              idempotencyKey: randomUUID(),
            },
            Date.now(),
          );
        if (operation === "failure")
          return r.recordFailure(
            claim.key,
            claim.lease!,
            { code: "test", description: "Fixture failure" },
            Date.now(),
          );
        return r.transition(
          claim.key,
          claim.version,
          "Queued",
          {},
          claim.lease,
          Date.now(),
        );
      });
      assert.equal(outcome.accepted, false);
      assert.deepEqual(await repository.getById(claim.jobId), before);
    },
  );
}
