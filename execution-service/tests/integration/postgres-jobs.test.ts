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

void test("job migration applies idempotently and records version 0002", async () => {
  const first = await applyPostgresMigrations(pool);
  const second = await applyPostgresMigrations(pool);
  assert.deepEqual(first.applied, []);
  assert.deepEqual(second.applied, []);
  assert.equal(first.currentVersion, "0002");
  assert.equal(second.currentVersion, "0002");
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

function makeCreation(suffix: string): ExecutionJobCreation {
  const id = String(++nextId);
  const event: PayoutReservedEvent = {
    event: "payout_reserved",
    payoutId: id,
    campaignId: "7",
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
    campaignId: "7",
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
