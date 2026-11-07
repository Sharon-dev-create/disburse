import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryJobRepository, newMemoryPersistenceState } from "../src/persistence/in-memory.ts";
import type { PayoutReservedEvent, PayoutSnapshot } from "../src/domain/payout.ts";
import type { ExecutionAttempt } from "../src/persistence/repository.ts";

test("duplicate discovery is idempotent and preserves the payout-to-job mapping", async () => {
  const repository = new InMemoryJobRepository();
  const first = await repository.enqueueDiscovered(event, payout, 10);
  const duplicate = await repository.enqueueDiscovered(event, payout, 11);

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.deepEqual(duplicate.job.key, {
    networkId: "near:testnet",
    contractId: "disburse.testnet",
    payoutId: "42"
  });
  assert.equal(duplicate.job.createdAtMs, 10);
});

test("concurrent workers cannot hold the same active lease", async () => {
  const repository = await queuedRepository();
  const [first, second] = await Promise.all([
    repository.claimNext("worker-a", 100, 50),
    repository.claimNext("worker-b", 100, 50)
  ]);

  assert.equal(Number(first !== null) + Number(second !== null), 1);
});

test("expired leases can be reclaimed with a fencing token and stale writes are rejected", async () => {
  const repository = await queuedRepository();
  const firstClaim = await repository.claimNext("worker-a", 100, 50);
  assert.ok(firstClaim?.lease);
  const firstLease = firstClaim.lease;
  const secondClaim = await repository.claimNext("worker-b", 151, 50);
  assert.ok(secondClaim?.lease);
  assert.ok(secondClaim.lease.fencingToken > firstLease.fencingToken);

  await assert.rejects(
    repository.appendAttempt(firstClaim.key, firstLease, attempt, 152),
    /stale or expired/
  );
  assert.equal(
    (await repository.renewLease(secondClaim.key, firstLease, 152, 50)),
    null
  );
});

test("duplicate execution attempts are rejected by key and sequence", async () => {
  const repository = await queuedRepository();
  const claim = await repository.claimNext("worker-a", 100, 50);
  assert.ok(claim?.lease);
  const preparing = await repository.transition(
    claim.key,
    claim.version,
    "Preparing",
    {},
    claim.lease,
    101
  );
  const started = await repository.appendAttempt(preparing.key, claim.lease, attempt, 102);
  await assert.rejects(
    repository.appendAttempt(started.key, claim.lease, attempt, 103),
    /Duplicate execution attempt key/
  );
});

test("a new repository instance recovers durable job state after worker restart", async () => {
  const storage = newMemoryPersistenceState();
  const firstProcess = new InMemoryJobRepository(storage);
  await firstProcess.enqueueDiscovered(event, payout, 10);
  await firstProcess.transition(
    { networkId: "near:testnet", contractId: "disburse.testnet", payoutId: "42" },
    0,
    "Queued",
    { contractPayoutStatus: "Reserved" },
    null,
    11
  );

  const restartedProcess = new InMemoryJobRepository(storage);
  const recovered = await restartedProcess.get({
    networkId: "near:testnet",
    contractId: "disburse.testnet",
    payoutId: "42"
  });
  assert.equal(recovered?.state, "Queued");
  assert.equal(recovered?.version, 1);
});

async function queuedRepository(): Promise<InMemoryJobRepository> {
  const repository = new InMemoryJobRepository();
  await repository.enqueueDiscovered(event, payout, 10);
  await repository.transition(
    { networkId: "near:testnet", contractId: "disburse.testnet", payoutId: "42" },
    0,
    "Queued",
    { contractPayoutStatus: "Reserved" },
    null,
    11
  );
  return repository;
}

const event: PayoutReservedEvent = {
  event: "payout_reserved",
  payoutId: "42",
  campaignId: "7",
  contractStatus: "Reserved",
  identity: {
    networkId: "near:testnet",
    contractId: "disburse.testnet",
    transactionHash: "near-tx-1",
    eventIndex: 0,
    blockHeight: "100"
  }
};

const payout: PayoutSnapshot = {
  payoutId: "42",
  campaignId: "7",
  inputAmount: { tokenId: "token:near", atomicAmount: "100", decimals: 6 },
  destinationChainId: "chain:test",
  recipientAddress: "recipient:test",
  expectedOutput: { tokenId: "token:external", atomicAmount: "100", decimals: 6 },
  contractStatus: "Reserved",
  executionReference: null,
  settlementEvidenceReference: null
};

const attempt: ExecutionAttempt = {
  attemptKey: "submit:1",
  sequence: 1,
  phase: "submit",
  idempotencyKey: "disburse-submit:v1:test",
  startedAtMs: 100,
  outcome: "started"
};
