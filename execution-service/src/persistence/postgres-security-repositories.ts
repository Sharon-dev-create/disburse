import {
  bindRefundPolicy,
  fingerprintRefundPolicy,
  sameApprovedRefundPolicy,
  validateRefundPolicy,
  type ApprovedRefundPolicy,
  type RefundPolicy,
  type RefundPolicyRepository,
} from "../providers/refund.ts";
import {
  verifyAuthorizationHash,
  verifyExecutionAuthorization,
  type AuthorizationRepository,
  type ExecutionAuthorization,
  type PayoutReservationSnapshot,
  type SigningPolicy,
  type SigningRequest,
  type StoredExecutionAuthorization,
} from "../providers/signing.ts";
import type { ExecutionOpportunity } from "../providers/quote.ts";

/** Minimal adapter contract; callers can wrap an existing PostgreSQL pool/client without a new driver. */
export interface PostgresQueryResult {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly rowCount: number | null;
}

export type PostgresQuery = (
  statement: string,
  parameters: readonly unknown[],
) => Promise<PostgresQueryResult>;

const authorizationColumns = `
  authorization_id, campaign_id, payout_id, execution_attempt_id,
  policy_version, policy_fingerprint, authorization_hash,
  provider_id, quote_reference, quote_issued_at, quote_expires_at,
  quote_fingerprint, quote_fresh_until,
  quote_required_input_atomic_amount, quote_minimum_output_atomic_amount, reservation_identity,
  reservation_observed_at_block, near_network_id, contract_id,
  source_network_id, source_token_id, destination_network_id,
  destination_token_id, recipient_address, refund_address,
  refund_policy_fingerprint, maximum_input_atomic_amount,
  expected_output_atomic_amount, authorized_at,
  authorization_expires_at, lifecycle, approved_at, consumed_at,
  revoked_at, expired_at`;

export class PostgresAuthorizationRepository implements AuthorizationRepository {
  private readonly query: PostgresQuery;

  constructor(query: PostgresQuery) {
    this.query = query;
  }

  async create(
    authorization: ExecutionAuthorization,
  ): Promise<StoredExecutionAuthorization> {
    verifyAuthorizationHash(authorization);
    if (authorization.lifecycle !== "Created")
      throw new Error("Only Created authorizations can be persisted");
    const values = authorizationValues(authorization);
    const inserted = await this.query(
      `INSERT INTO execution_authorizations (
        authorization_id, campaign_id, payout_id, execution_attempt_id,
        policy_version, policy_fingerprint, authorization_hash,
        provider_id, quote_reference, quote_issued_at, quote_expires_at,
        quote_fingerprint, quote_fresh_until,
        quote_required_input_atomic_amount, quote_minimum_output_atomic_amount, reservation_identity,
        reservation_observed_at_block, near_network_id, contract_id,
        source_network_id, source_token_id, destination_network_id,
        destination_token_id, recipient_address, refund_address,
        refund_policy_fingerprint, maximum_input_atomic_amount,
        expected_output_atomic_amount, authorized_at,
        authorization_expires_at, lifecycle
      ) VALUES (
        ${values.map((_, index) => `$${index + 1}`).join(", ")}
      ) ON CONFLICT DO NOTHING RETURNING ${authorizationColumns}`,
      values,
    );
    if (inserted.rows[0]) return mapStoredAuthorization(inserted.rows[0]);

    const existing = await this.get(authorization.authorizationId);
    if (!existing)
      throw new Error(
        "Authorization conflicts with an existing payout attempt",
      );
    if (existing.authorizationHash !== authorization.authorizationHash)
      throw new Error(
        "Authorization ID already exists with different protected fields",
      );
    return existing;
  }

  async get(
    authorizationId: string,
  ): Promise<StoredExecutionAuthorization | null> {
    const result = await this.query(
      `SELECT ${authorizationColumns} FROM execution_authorizations WHERE authorization_id = $1`,
      [authorizationId],
    );
    return result.rows[0] ? mapStoredAuthorization(result.rows[0]) : null;
  }

  async getByCampaignPayoutAttempt(
    campaignId: string,
    payoutId: string,
    executionAttemptId: string,
  ): Promise<StoredExecutionAuthorization | null> {
    const result = await this.query(
      `SELECT ${authorizationColumns} FROM execution_authorizations
       WHERE campaign_id = $1 AND payout_id = $2 AND execution_attempt_id = $3`,
      [campaignId, payoutId, executionAttemptId],
    );
    return result.rows[0] ? mapStoredAuthorization(result.rows[0]) : null;
  }

  async approve(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization> {
    void nowMs; // PostgreSQL statement time is authoritative for durable lifecycle expiry.
    const updated = await this.query(
      `UPDATE execution_authorizations
       SET lifecycle = CASE
             WHEN authorization_expires_at <= statement_timestamp() THEN 'Expired'
             ELSE 'Approved'
           END,
           approved_at = CASE
             WHEN authorization_expires_at > statement_timestamp() THEN statement_timestamp()
             ELSE approved_at
           END,
           expired_at = CASE
             WHEN authorization_expires_at <= statement_timestamp() THEN statement_timestamp()
             ELSE expired_at
           END
       WHERE authorization_id = $1 AND lifecycle = 'Created'
       RETURNING ${authorizationColumns}`,
      [authorizationId],
    );
    if (updated.rows[0]) {
      const authorization = mapStoredAuthorization(updated.rows[0]);
      if (authorization.lifecycle !== "Approved")
        throw new Error("Authorization has expired");
      return authorization;
    }
    const existing = await requireAuthorization(this, authorizationId);
    if (existing.lifecycle === "Approved") return existing;
    throw new Error(
      `Authorization is ${existing.lifecycle} and cannot be approved`,
    );
  }

  async consume(
    authorizationId: string,
    request: SigningRequest,
    policy: SigningPolicy,
    reservation: PayoutReservationSnapshot,
    quote: ExecutionOpportunity,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization> {
    const current = await requireAuthorization(this, authorizationId);
    if (current.lifecycle !== "Approved")
      throw new Error(
        `Authorization is ${current.lifecycle} and cannot be consumed`,
      );
    verifyExecutionAuthorization(
      current,
      request,
      policy,
      reservation,
      quote,
      nowMs,
    );
    const updated = await this.query(
      `UPDATE execution_authorizations
       SET lifecycle = 'Consumed', consumed_at = statement_timestamp()
       WHERE authorization_id = $1 AND lifecycle = 'Approved'
         AND authorization_hash = $2
         AND authorization_expires_at > statement_timestamp()
       RETURNING ${authorizationColumns}`,
      [authorizationId, current.authorizationHash],
    );
    if (updated.rows[0]) return mapStoredAuthorization(updated.rows[0]);

    await this.expireIfDue(authorizationId);
    const afterRace = await requireAuthorization(this, authorizationId);
    if (afterRace.lifecycle === "Expired")
      throw new Error("Authorization has expired");
    throw new Error(
      `Authorization is ${afterRace.lifecycle} and cannot be consumed`,
    );
  }

  async revoke(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization> {
    void nowMs; // PostgreSQL statement time is authoritative for durable lifecycle expiry.
    const updated = await this.query(
      `UPDATE execution_authorizations
       SET lifecycle = CASE
             WHEN authorization_expires_at <= statement_timestamp() THEN 'Expired'
             ELSE 'Revoked'
           END,
           revoked_at = CASE
             WHEN authorization_expires_at > statement_timestamp() THEN statement_timestamp()
             ELSE revoked_at
           END,
           expired_at = CASE
             WHEN authorization_expires_at <= statement_timestamp() THEN statement_timestamp()
             ELSE expired_at
           END
       WHERE authorization_id = $1 AND lifecycle IN ('Created', 'Approved')
       RETURNING ${authorizationColumns}`,
      [authorizationId],
    );
    if (updated.rows[0]) return mapStoredAuthorization(updated.rows[0]);
    const existing = await requireAuthorization(this, authorizationId);
    if (existing.lifecycle === "Revoked" || existing.lifecycle === "Expired")
      return existing;
    throw new Error(
      `Authorization is ${existing.lifecycle} and cannot be revoked`,
    );
  }

  async expire(
    authorizationId: string,
    nowMs: number,
  ): Promise<StoredExecutionAuthorization> {
    void nowMs; // PostgreSQL statement time is authoritative for durable lifecycle expiry.
    const expired = await this.expireIfDue(authorizationId);
    if (expired) return expired;
    const existing = await requireAuthorization(this, authorizationId);
    if (existing.lifecycle === "Expired") return existing;
    if (existing.lifecycle === "Created" || existing.lifecycle === "Approved")
      throw new Error("Authorization has not expired");
    throw new Error(`Authorization is ${existing.lifecycle} and cannot expire`);
  }

  private async expireIfDue(
    authorizationId: string,
  ): Promise<StoredExecutionAuthorization | null> {
    const result = await this.query(
      `UPDATE execution_authorizations
       SET lifecycle = 'Expired', expired_at = statement_timestamp()
       WHERE authorization_id = $1
         AND lifecycle IN ('Created', 'Approved')
         AND authorization_expires_at <= statement_timestamp()
       RETURNING ${authorizationColumns}`,
      [authorizationId],
    );
    return result.rows[0] ? mapStoredAuthorization(result.rows[0]) : null;
  }
}

export class PostgresRefundPolicyRepository implements RefundPolicyRepository {
  private readonly query: PostgresQuery;

  constructor(query: PostgresQuery) {
    this.query = query;
  }

  async approve(policy: RefundPolicy): Promise<ApprovedRefundPolicy> {
    const validation = validateRefundPolicy(policy);
    if (!validation.valid)
      throw new Error(`Invalid refund policy: ${validation.errors.join(", ")}`);
    const fingerprint = fingerprintRefundPolicy(policy);
    const result = await this.query(
      `INSERT INTO payout_refund_policies (
         campaign_id, payout_id, source_network_id, source_token_id,
         refund_address, policy_version, approved_at, approved_at_iso,
         policy_fingerprint
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $7, $8)
       ON CONFLICT (campaign_id, payout_id) DO NOTHING
       RETURNING campaign_id, payout_id, source_network_id, source_token_id,
         refund_address, policy_version, approved_at_iso, policy_fingerprint`,
      [
        policy.campaignId,
        policy.payoutId,
        policy.sourceNetworkId,
        policy.sourceTokenId,
        policy.refundAddress,
        policy.policyVersion,
        policy.approvedAt,
        fingerprint,
      ],
    );
    if (result.rows[0]) return mapRefundPolicy(result.rows[0]);

    const existing = await this.get(policy.campaignId, policy.payoutId);
    if (!existing)
      throw new Error(
        "Refund policy insert conflicted without a readable record",
      );
    const requested = { ...policy, fingerprint };
    if (!sameApprovedRefundPolicy(existing, requested))
      throw new Error(
        "Refund policy already approved; immutable policy cannot be replaced",
      );
    return existing;
  }

  async get(
    campaignId: string,
    payoutId: string,
  ): Promise<ApprovedRefundPolicy | null> {
    const result = await this.query(
      `SELECT campaign_id, payout_id, source_network_id, source_token_id,
         refund_address, policy_version, approved_at, approved_at_iso,
         policy_fingerprint
       FROM payout_refund_policies WHERE campaign_id = $1 AND payout_id = $2`,
      [campaignId, payoutId],
    );
    if (!result.rows[0]) return null;
    return mapRefundPolicy(result.rows[0]);
  }
}

async function requireAuthorization(
  repository: PostgresAuthorizationRepository,
  authorizationId: string,
): Promise<StoredExecutionAuthorization> {
  const authorization = await repository.get(authorizationId);
  if (!authorization) throw new Error("Authorization does not exist");
  return authorization;
}

function authorizationValues(
  authorization: ExecutionAuthorization,
): readonly unknown[] {
  return [
    authorization.authorizationId,
    authorization.campaignId,
    authorization.payoutId,
    authorization.executionAttemptId,
    authorization.policyVersion,
    authorization.policyFingerprint,
    authorization.authorizationHash,
    authorization.providerId,
    authorization.quoteReference,
    authorization.quoteIssuedAt,
    authorization.quoteExpiresAt,
    authorization.quoteFingerprint,
    authorization.quoteFreshUntil,
    authorization.quoteRequiredInputAtomicAmount,
    authorization.quoteMinimumOutputAtomicAmount,
    authorization.reservationIdentity,
    authorization.reservationObservedAtBlock,
    authorization.nearNetworkId,
    authorization.contractId,
    authorization.sourceNetworkId,
    authorization.sourceTokenId,
    authorization.destinationNetworkId,
    authorization.destinationTokenId,
    authorization.recipientAddress,
    authorization.refundAddress,
    authorization.refundPolicyFingerprint,
    authorization.maximumInputAtomicAmount,
    authorization.expectedOutputAtomicAmount,
    authorization.authorizedAt,
    authorization.authorizationExpiresAt,
    authorization.lifecycle,
  ];
}

function mapStoredAuthorization(
  row: Readonly<Record<string, unknown>>,
): StoredExecutionAuthorization {
  const authorization: StoredExecutionAuthorization = {
    authorizationId: requiredText(row, "authorization_id"),
    campaignId: requiredText(row, "campaign_id"),
    payoutId: requiredText(row, "payout_id"),
    executionAttemptId: requiredText(row, "execution_attempt_id"),
    policyVersion: requiredText(row, "policy_version"),
    policyFingerprint: requiredText(row, "policy_fingerprint"),
    authorizationHash: requiredText(row, "authorization_hash"),
    providerId: requiredText(row, "provider_id"),
    quoteReference: requiredText(row, "quote_reference"),
    quoteIssuedAt: requiredText(row, "quote_issued_at"),
    quoteExpiresAt: requiredText(row, "quote_expires_at"),
    quoteFingerprint: requiredText(row, "quote_fingerprint"),
    quoteFreshUntil: requiredText(row, "quote_fresh_until"),
    quoteRequiredInputAtomicAmount: requiredText(
      row,
      "quote_required_input_atomic_amount",
    ),
    quoteMinimumOutputAtomicAmount: requiredText(
      row,
      "quote_minimum_output_atomic_amount",
    ),
    reservationIdentity: requiredText(row, "reservation_identity"),
    reservationObservedAtBlock: requiredText(
      row,
      "reservation_observed_at_block",
    ),
    nearNetworkId: requiredText(row, "near_network_id"),
    contractId: requiredText(row, "contract_id"),
    sourceNetworkId: requiredText(row, "source_network_id"),
    sourceTokenId: requiredText(row, "source_token_id"),
    destinationNetworkId: requiredText(row, "destination_network_id"),
    destinationTokenId: requiredText(row, "destination_token_id"),
    recipientAddress: requiredText(row, "recipient_address"),
    refundAddress: requiredText(row, "refund_address"),
    refundPolicyFingerprint: requiredText(row, "refund_policy_fingerprint"),
    maximumInputAtomicAmount: requiredText(row, "maximum_input_atomic_amount"),
    expectedOutputAtomicAmount: requiredText(
      row,
      "expected_output_atomic_amount",
    ),
    authorizedAt: timestampText(row, "authorized_at"),
    authorizationExpiresAt: timestampText(row, "authorization_expires_at"),
    lifecycle: lifecycleValue(row),
    approvedAt: nullableTimestampText(row, "approved_at"),
    consumedAt: nullableTimestampText(row, "consumed_at"),
    revokedAt: nullableTimestampText(row, "revoked_at"),
    expiredAt: nullableTimestampText(row, "expired_at"),
  };
  verifyAuthorizationHash(authorization);
  return Object.freeze(authorization);
}

function lifecycleValue(
  row: Readonly<Record<string, unknown>>,
): ExecutionAuthorization["lifecycle"] {
  const lifecycle = requiredText(row, "lifecycle");
  if (
    lifecycle !== "Created" &&
    lifecycle !== "Approved" &&
    lifecycle !== "Consumed" &&
    lifecycle !== "Expired" &&
    lifecycle !== "Revoked"
  )
    throw new Error("Persisted authorization has an unknown lifecycle state");
  return lifecycle;
}

function mapRefundPolicy(
  row: Readonly<Record<string, unknown>>,
): ApprovedRefundPolicy {
  const approvedAt = requiredText(row, "approved_at_iso");
  if (timestampText(row, "approved_at") !== new Date(approvedAt).toISOString())
    throw new Error("Persisted refund policy approval timestamp mismatch");
  const policy: ApprovedRefundPolicy = {
    campaignId: requiredText(row, "campaign_id"),
    payoutId: requiredText(row, "payout_id"),
    sourceNetworkId: requiredText(row, "source_network_id"),
    sourceTokenId: requiredText(row, "source_token_id"),
    refundAddress: requiredText(row, "refund_address"),
    policyVersion: requiredText(row, "policy_version"),
    approvedAt,
    fingerprint: requiredText(row, "policy_fingerprint"),
  };
  const validation = validateRefundPolicy(policy);
  if (!validation.valid)
    throw new Error(
      `Persisted refund policy is invalid: ${validation.errors.join(", ")}`,
    );
  const recomputed = fingerprintRefundPolicy(policy);
  if (recomputed !== policy.fingerprint)
    throw new Error("Persisted refund policy fingerprint mismatch");
  return bindRefundPolicy(policy, policy);
}

function requiredText(
  row: Readonly<Record<string, unknown>>,
  column: string,
): string {
  const value = row[column];
  if (typeof value !== "string")
    throw new Error(`Persisted ${column} is missing or not text`);
  return value;
}

function timestampText(
  row: Readonly<Record<string, unknown>>,
  column: string,
): string {
  const value = row[column];
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime()))
    throw new Error(`Persisted ${column} is not a valid timestamp`);
  return date.toISOString();
}

function nullableTimestampText(
  row: Readonly<Record<string, unknown>>,
  column: string,
): string | null {
  return row[column] === null || row[column] === undefined
    ? null
    : timestampText(row, column);
}
