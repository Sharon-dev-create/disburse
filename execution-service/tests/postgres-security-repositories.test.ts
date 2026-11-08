import assert from "node:assert/strict";
import test from "node:test";

import {
  fingerprintRefundPolicy,
  type RefundPolicy,
} from "../src/providers/refund.ts";
import type { ExecutionOpportunity } from "../src/providers/quote.ts";
import {
  createExecutionAuthorization,
  type PayoutReservationSnapshot,
  type SigningPolicy,
  type SigningRequest,
} from "../src/providers/signing.ts";
import {
  PostgresAuthorizationRepository,
  PostgresRefundPolicyRepository,
  type PostgresQuery,
  type PostgresQueryResult,
} from "../src/persistence/postgres-security-repositories.ts";

const now = Date.parse("2026-11-08T12:00:00.000Z");

void test("PostgreSQL authorization adapter persists exact fields and survives repository recreation", async () => {
  const database = new MockPostgres(now);
  const repository = new PostgresAuthorizationRepository(database.query);
  const authorization = createExecutionAuthorization(
    signingRequest(),
    signingPolicy(),
    reservation(),
    quote(),
    now,
  );

  const created = await repository.create(authorization);
  assert.equal(created.lifecycle, "Created");
  assert.equal(created.approvedAt, null);
  assert.equal(created.maximumInputAtomicAmount, "4000");
  assert.equal(created.expectedOutputAtomicAmount, "300");
  assert.equal(created.quoteMinimumOutputAtomicAmount, "300");
  assert.match(created.quoteFingerprint, /^[a-f0-9]{64}$/);

  const largeAmount = "340282366920938463463374607431768211455";
  const largeAuthorization = createExecutionAuthorization(
    {
      ...signingRequest(),
      executionAttemptId: "large-amount",
      maximumInputAtomicAmount: largeAmount,
    },
    { ...signingPolicy(), maxInputAtomicAmount: largeAmount },
    {
      ...reservation(),
      inputAtomicAmount: largeAmount,
      campaignReservedAtomicAmount: largeAmount,
    },
    {
      ...quote(),
      quotedInputAtomicAmount: largeAmount,
      providerMetadata: {
        ...quote().providerMetadata,
        executionAttemptId: "large-amount",
      },
    },
    now,
  );
  const persistedLarge = await repository.create(largeAuthorization);
  assert.equal(persistedLarge.maximumInputAtomicAmount, largeAmount);
  assert.equal(persistedLarge.quoteRequiredInputAtomicAmount, largeAmount);

  const afterRestart = new PostgresAuthorizationRepository(database.query);
  assert.equal(
    (await afterRestart.get(authorization.authorizationId))?.authorizationHash,
    authorization.authorizationHash,
  );
  assert.equal(
    (await afterRestart.getByCampaignPayoutAttempt("42", "99", "attempt-1"))
      ?.authorizationId,
    authorization.authorizationId,
  );
  await assert.rejects(
    afterRestart.create({ ...authorization, payoutId: "100" }),
    /integrity/,
  );
});

void test("PostgreSQL conditional lifecycle updates admit one concurrent consumer", async () => {
  const database = new MockPostgres(now);
  const repository = new PostgresAuthorizationRepository(database.query);
  const request = signingRequest();
  const policy = signingPolicy();
  const reservationSnapshot = reservation();
  const opportunity = quote();
  const authorization = createExecutionAuthorization(
    request,
    policy,
    reservationSnapshot,
    opportunity,
    now,
  );
  await repository.create(authorization);
  const [approvedA, approvedB] = await Promise.all([
    repository.approve(authorization.authorizationId, now),
    repository.approve(authorization.authorizationId, now),
  ]);
  assert.equal(approvedA.lifecycle, "Approved");
  assert.equal(approvedB.lifecycle, "Approved");
  assert.ok(approvedA.approvedAt);

  const results = await Promise.allSettled([
    repository.consume(
      authorization.authorizationId,
      request,
      policy,
      reservationSnapshot,
      opportunity,
      now,
    ),
    repository.consume(
      authorization.authorizationId,
      request,
      policy,
      reservationSnapshot,
      opportunity,
      now,
    ),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal(
    (await repository.get(authorization.authorizationId))?.lifecycle,
    "Consumed",
  );
  await assert.rejects(
    repository.approve(authorization.authorizationId, now),
    /Consumed/,
  );

  assert.match(database.statements.join("\n"), /lifecycle = 'Approved'/);
  assert.match(database.statements.join("\n"), /lifecycle = 'Consumed'/);
  assert.match(
    database.statements.join("\n"),
    /authorization_expires_at > statement_timestamp\(\)/,
  );
});

void test("PostgreSQL refund repository verifies immutable payout-bound policies", async () => {
  const database = new MockPostgres(now);
  const repository = new PostgresRefundPolicyRepository(database.query);
  const policy = refundPolicy();
  const approved = await repository.approve(policy);
  assert.equal(approved.fingerprint, fingerprintRefundPolicy(policy));

  const afterRestart = new PostgresRefundPolicyRepository(database.query);
  assert.deepEqual(await afterRestart.get("42", "99"), approved);
  assert.deepEqual(await afterRestart.approve(policy), approved);
  await assert.rejects(
    afterRestart.approve({ ...policy, refundAddress: "other.near" }),
    /cannot be replaced/,
  );
  assert.equal(await afterRestart.get("42", "100"), null);
  database.corruptRefundFingerprint("42", "99");
  await assert.rejects(afterRestart.get("42", "99"), /fingerprint mismatch/);
});

void test("PostgreSQL adapter expires records by database time and keeps terminal states terminal", async () => {
  const database = new MockPostgres(now);
  const repository = new PostgresAuthorizationRepository(database.query);
  const authorization = createExecutionAuthorization(
    signingRequest(),
    signingPolicy(),
    reservation(),
    quote(),
    now,
  );
  await repository.create(authorization);
  await repository.approve(authorization.authorizationId, now);
  database.advanceTo(Date.parse(authorization.authorizationExpiresAt));
  const expired = await repository.expire(authorization.authorizationId, now);
  assert.equal(expired.lifecycle, "Expired");
  assert.ok(expired.expiredAt);
  assert.deepEqual(
    await repository.expire(authorization.authorizationId, now),
    expired,
  );
  await assert.rejects(
    repository.approve(authorization.authorizationId, now),
    /Expired/,
  );
});

const authorizationColumns = [
  "authorization_id",
  "campaign_id",
  "payout_id",
  "execution_attempt_id",
  "policy_version",
  "policy_fingerprint",
  "authorization_hash",
  "provider_id",
  "quote_reference",
  "quote_issued_at",
  "quote_expires_at",
  "quote_fingerprint",
  "quote_fresh_until",
  "quote_required_input_atomic_amount",
  "quote_minimum_output_atomic_amount",
  "reservation_identity",
  "reservation_observed_at_block",
  "near_network_id",
  "contract_id",
  "source_network_id",
  "source_token_id",
  "destination_network_id",
  "destination_token_id",
  "recipient_address",
  "refund_address",
  "refund_policy_fingerprint",
  "maximum_input_atomic_amount",
  "expected_output_atomic_amount",
  "authorized_at",
  "authorization_expires_at",
  "lifecycle",
];

class MockPostgres {
  readonly statements: string[] = [];
  private readonly authorizations = new Map<string, Record<string, unknown>>();
  private readonly refundPolicies = new Map<string, Record<string, unknown>>();
  private databaseNow: number;

  constructor(databaseNow: number) {
    this.databaseNow = databaseNow;
  }

  advanceTo(databaseNow: number): void {
    this.databaseNow = databaseNow;
  }

  corruptRefundFingerprint(campaignId: string, payoutId: string): void {
    const row = this.refundPolicies.get(`${campaignId}:${payoutId}`);
    if (row) row.policy_fingerprint = "0".repeat(64);
  }

  readonly query: PostgresQuery = async (
    statement: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult> => {
    this.statements.push(statement);
    if (statement.includes("INSERT INTO execution_authorizations"))
      return this.insertAuthorization(statement, parameters);
    if (statement.includes("FROM execution_authorizations"))
      return this.selectAuthorization(statement, parameters);
    if (statement.includes("UPDATE execution_authorizations"))
      return this.updateAuthorization(statement, parameters);
    if (statement.includes("INSERT INTO payout_refund_policies"))
      return this.insertRefundPolicy(parameters);
    if (statement.includes("FROM payout_refund_policies"))
      return this.selectRefundPolicy(parameters);
    throw new Error(`Mock PostgreSQL received unexpected SQL: ${statement}`);
  };

  private insertAuthorization(
    statement: string,
    parameters: readonly unknown[],
  ): PostgresQueryResult {
    const row = Object.fromEntries(
      authorizationColumns.map((column, index) => [column, parameters[index]]),
    );
    const existingByAttempt = [...this.authorizations.values()].some(
      (existing) =>
        existing.campaign_id === row.campaign_id &&
        existing.payout_id === row.payout_id &&
        existing.execution_attempt_id === row.execution_attempt_id,
    );
    if (
      this.authorizations.has(String(row.authorization_id)) ||
      existingByAttempt
    )
      return result([]);
    row.authorized_at = new Date(String(row.authorized_at));
    row.authorization_expires_at = new Date(
      String(row.authorization_expires_at),
    );
    row.approved_at = null;
    row.consumed_at = null;
    row.revoked_at = null;
    row.expired_at = null;
    this.authorizations.set(String(row.authorization_id), row);
    assert.match(statement, /ON CONFLICT DO NOTHING/);
    return result([copy(row)]);
  }

  private selectAuthorization(
    statement: string,
    parameters: readonly unknown[],
  ): PostgresQueryResult {
    const row = statement.includes("WHERE authorization_id = $1")
      ? this.authorizations.get(String(parameters[0]))
      : [...this.authorizations.values()].find(
          (item) =>
            item.campaign_id === parameters[0] &&
            item.payout_id === parameters[1] &&
            item.execution_attempt_id === parameters[2],
        );
    return result(row ? [copy(row)] : []);
  }

  private updateAuthorization(
    statement: string,
    parameters: readonly unknown[],
  ): PostgresQueryResult {
    const row = this.authorizations.get(String(parameters[0]));
    if (!row) return result([]);
    const currentState = String(row.lifecycle);
    const timestamp = new Date(this.databaseNow);
    const isExpired =
      new Date(String(row.authorization_expires_at)).getTime() <=
      this.databaseNow;

    if (statement.includes("SET lifecycle = 'Consumed'")) {
      if (
        currentState !== "Approved" ||
        isExpired ||
        row.authorization_hash !== parameters[1]
      )
        return result([]);
      row.lifecycle = "Consumed";
      row.consumed_at = timestamp;
    } else if (statement.includes("SET lifecycle = 'Expired'")) {
      if (
        (currentState !== "Created" && currentState !== "Approved") ||
        !isExpired
      )
        return result([]);
      row.lifecycle = "Expired";
      row.expired_at = timestamp;
    } else if (statement.includes("revoked_at = CASE")) {
      if (currentState !== "Created" && currentState !== "Approved")
        return result([]);
      if (isExpired) {
        row.lifecycle = "Expired";
        row.expired_at = timestamp;
      } else {
        row.lifecycle = "Revoked";
        row.revoked_at = timestamp;
      }
    } else if (statement.includes("approved_at = CASE")) {
      if (currentState !== "Created") return result([]);
      if (isExpired) {
        row.lifecycle = "Expired";
        row.expired_at = timestamp;
      } else {
        row.lifecycle = "Approved";
        row.approved_at = timestamp;
      }
    } else {
      throw new Error(
        `Mock PostgreSQL received unexpected UPDATE: ${statement}`,
      );
    }
    return result([copy(row)]);
  }

  private insertRefundPolicy(
    parameters: readonly unknown[],
  ): PostgresQueryResult {
    const key = `${parameters[0]}:${parameters[1]}`;
    if (this.refundPolicies.has(key)) return result([]);
    const row = {
      campaign_id: parameters[0],
      payout_id: parameters[1],
      source_network_id: parameters[2],
      source_token_id: parameters[3],
      refund_address: parameters[4],
      policy_version: parameters[5],
      approved_at: new Date(String(parameters[6])),
      approved_at_iso: parameters[6],
      policy_fingerprint: parameters[7],
    };
    this.refundPolicies.set(key, row);
    return result([copy(row)]);
  }

  private selectRefundPolicy(
    parameters: readonly unknown[],
  ): PostgresQueryResult {
    const row = this.refundPolicies.get(`${parameters[0]}:${parameters[1]}`);
    return result(row ? [copy(row)] : []);
  }
}

function result(
  rows: readonly Readonly<Record<string, unknown>>[],
): PostgresQueryResult {
  return { rows, rowCount: rows.length };
}

function copy(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row };
}

function refundPolicy(): RefundPolicy {
  return {
    campaignId: "42",
    payoutId: "99",
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    refundAddress: "treasury.near",
    policyVersion: "refund-v1",
    approvedAt: "2026-11-08T12:00:00.000Z",
  };
}

function signingPolicy(): SigningPolicy {
  const approvedRefund = refundPolicy();
  return {
    policyVersion: "sign-v1",
    requireFreshQuote: true,
    maxQuoteAgeMs: 30_000,
    authorizationTtlMs: 45_000,
    maxInputAtomicAmount: "5000",
    allowedSourceNetworks: ["near:mainnet"],
    allowedSourceTokens: ["token:near-usdc"],
    allowedDestinationNetworks: ["eip155:1"],
    allowedDestinationTokens: ["token:eth-usdc"],
    approvedRecipient: "0x52908400098527886e0f7030069857d2e4169ee7",
    approvedRefundAddress: approvedRefund.refundAddress,
    approvedRefundPolicyFingerprint: fingerprintRefundPolicy(approvedRefund),
  };
}

function signingRequest(): SigningRequest {
  return {
    nearNetworkId: "near:mainnet",
    contractId: "disburse.near",
    campaignId: "42",
    payoutId: "99",
    executionAttemptId: "attempt-1",
    providerId: "near-intents-1click",
    quoteReference: "quote-1",
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    destinationNetworkId: "eip155:1",
    destinationTokenId: "token:eth-usdc",
    recipientAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
    refundAddress: "treasury.near",
    refundPolicyFingerprint: fingerprintRefundPolicy(refundPolicy()),
    maximumInputAtomicAmount: "4000",
    expectedOutputAtomicAmount: "300",
  };
}

function reservation(): PayoutReservationSnapshot {
  return {
    networkId: "near:mainnet",
    contractId: "disburse.near",
    observedAtBlock: "1234",
    campaignId: "42",
    payoutId: "99",
    status: "Reserved",
    inputTokenId: "token:near-usdc",
    inputAtomicAmount: "4000",
    campaignReservedAtomicAmount: "4000",
    expectedOutputTokenId: "token:eth-usdc",
    expectedOutputAtomicAmount: "300",
    destinationNetworkId: "eip155:1",
    recipientAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
  };
}

function quote(): ExecutionOpportunity {
  return {
    providerId: "near-intents-1click",
    sourceNetworkId: "near:mainnet",
    sourceTokenId: "token:near-usdc",
    quotedInputAtomicAmount: "4000",
    maximumInputAtomicAmount: null,
    destinationNetworkId: "eip155:1",
    destinationTokenId: "token:eth-usdc",
    recipientAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
    expectedOutputAtomicAmount: "300",
    minimumOutputAtomicAmount: "300",
    quoteReference: "quote-1",
    expiresAt: new Date(now + 60_000).toISOString(),
    freshUntil: new Date(now + 30_000).toISOString(),
    fees: [],
    estimatedExecutionSeconds: 60,
    providerMetadata: {
      responseTimestamp: new Date(now - 5_000).toISOString(),
      executionAttemptId: "attempt-1",
    },
  };
}
