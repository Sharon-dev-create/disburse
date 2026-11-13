-- Reference PostgreSQL schema only. This file is not run by package scripts.
-- Apply only after a separately reviewed, environment-specific migration plan.

-- Durable job foundation only: these three tables are applied by migration 0002.
-- Security tables near the end are applied by migration 0001; other future tables are reference-only.
CREATE TABLE execution_jobs (
    job_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network_id TEXT NOT NULL CHECK (
        length(btrim(network_id)) BETWEEN 1 AND 256 AND network_id !~ '[[:cntrl:]]'
    ),
    contract_id TEXT NOT NULL CHECK (
        length(btrim(contract_id)) BETWEEN 1 AND 256 AND contract_id !~ '[[:cntrl:]]'
    ),
    payout_id NUMERIC(20, 0) NOT NULL
        CHECK (payout_id BETWEEN 0 AND 18446744073709551615),
    campaign_id NUMERIC(20, 0) NOT NULL
        CHECK (campaign_id BETWEEN 0 AND 18446744073709551615),
    job_creation_idempotency_key TEXT NOT NULL
        CHECK (
            length(job_creation_idempotency_key) BETWEEN 1 AND 256
            AND job_creation_idempotency_key !~ '[[:cntrl:]]'
        ),
    snapshot_digest CHAR(64) NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
    payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
    payout_snapshot JSONB NOT NULL CHECK (jsonb_typeof(payout_snapshot) = 'object'),
    input_atomic_amount NUMERIC(39, 0) NOT NULL
        CHECK (input_atomic_amount BETWEEN 1 AND 340282366920938463463374607431768211455),
    expected_output_atomic_amount NUMERIC(39, 0) NOT NULL
        CHECK (expected_output_atomic_amount BETWEEN 1 AND 340282366920938463463374607431768211455),
    observed_contract_status TEXT NOT NULL CHECK (observed_contract_status = 'Reserved'),
    state TEXT NOT NULL CHECK (state IN (
        'Discovered', 'Queued', 'Leased', 'Preparing', 'SubmissionStarted',
        'SubmissionUnknown', 'Submitted', 'ConfirmationPending', 'VerificationPending',
        'SettlementReady', 'SettlementSubmitted', 'Completed', 'RetryableFailure',
        'ManualReview', 'Abandoned'
    )),
    execution_reference TEXT NOT NULL,
    state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    fencing_counter NUMERIC(39, 0) NOT NULL DEFAULT 0
        CHECK (fencing_counter BETWEEN 0 AND 999999999999999999999999999999999999999),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_eligible_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    failure_code TEXT CHECK (
        failure_code IS NULL OR failure_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ),
    failure_description TEXT CHECK (
        failure_description IS NULL OR
        (length(failure_description) <= 1000 AND failure_description !~ '[[:cntrl:]]')
    ),
    discovery_tx_hash TEXT NOT NULL CHECK (
        length(btrim(discovery_tx_hash)) BETWEEN 1 AND 512
        AND discovery_tx_hash !~ '[[:cntrl:]]'
    ),
    discovery_block_hash TEXT NOT NULL CHECK (
        length(btrim(discovery_block_hash)) BETWEEN 1 AND 512
        AND discovery_block_hash !~ '[[:cntrl:]]'
    ),
    discovery_receipt_id TEXT NOT NULL CHECK (
        length(btrim(discovery_receipt_id)) BETWEEN 1 AND 512
        AND discovery_receipt_id !~ '[[:cntrl:]]'
    ),
    discovery_event_index INTEGER NOT NULL CHECK (discovery_event_index >= 0),
    discovery_block_height NUMERIC(20, 0) NOT NULL
        CHECK (discovery_block_height BETWEEN 0 AND 18446744073709551615),
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    CONSTRAINT execution_jobs_payout_identity_uq
        UNIQUE (network_id, contract_id, payout_id),
    CONSTRAINT execution_jobs_idempotency_uq
        UNIQUE (network_id, contract_id, job_creation_idempotency_key),
    CONSTRAINT execution_jobs_discovery_event_uq
        UNIQUE (
            network_id, contract_id, discovery_tx_hash, discovery_block_hash,
            discovery_receipt_id, discovery_event_index
        ),
    CONSTRAINT execution_jobs_execution_reference_uq
        UNIQUE (network_id, contract_id, execution_reference)
);

CREATE INDEX execution_jobs_claimable_idx
    ON execution_jobs (next_eligible_at, created_at, job_id)
    WHERE state = 'Queued';

CREATE INDEX execution_jobs_campaign_read_idx
    ON execution_jobs (
        network_id,
        contract_id,
        campaign_id,
        created_at DESC,
        job_id DESC
    );

CREATE TABLE execution_attempts (
    attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES execution_jobs(job_id),
    sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
    attempt_key TEXT NOT NULL CHECK (
        length(attempt_key) BETWEEN 1 AND 256 AND attempt_key !~ '[[:cntrl:]]'
    ),
    phase TEXT NOT NULL CHECK (phase IN (
        'validate', 'quote', 'prepare', 'submit', 'confirm', 'verify', 'settle'
    )),
    idempotency_key TEXT NOT NULL CHECK (
        length(idempotency_key) BETWEEN 1 AND 256
        AND idempotency_key !~ '[[:cntrl:]]'
    ),
    outcome TEXT NOT NULL CHECK (outcome IN (
        'started', 'accepted', 'rejected', 'unknown', 'verified', 'failed'
    )),
    started_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT execution_attempts_sequence_uq UNIQUE (job_id, sequence_number),
    CONSTRAINT execution_attempts_attempt_key_uq UNIQUE (job_id, attempt_key),
    CONSTRAINT execution_attempts_idempotency_uq UNIQUE (job_id, idempotency_key),
    CONSTRAINT execution_attempts_job_attempt_uq UNIQUE (job_id, attempt_id)
);

CREATE TABLE job_leases (
    job_id BIGINT PRIMARY KEY REFERENCES execution_jobs(job_id),
    worker_id TEXT NOT NULL CHECK (length(btrim(worker_id)) BETWEEN 1 AND 256),
    fencing_token NUMERIC(39, 0) NOT NULL CHECK (fencing_token > 0),
    acquired_at TIMESTAMPTZ NOT NULL,
    renewed_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > acquired_at),
    CHECK (renewed_at >= acquired_at)
);

CREATE INDEX job_leases_expiration_idx ON job_leases (expires_at);

CREATE FUNCTION public.disburse_prevent_execution_job_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
      NEW.job_id, NEW.network_id, NEW.contract_id, NEW.payout_id, NEW.campaign_id,
      NEW.job_creation_idempotency_key, NEW.snapshot_digest, NEW.payload_hash,
      NEW.payout_snapshot,
      NEW.input_atomic_amount, NEW.expected_output_atomic_amount,
      NEW.observed_contract_status, NEW.execution_reference,
      NEW.discovery_tx_hash, NEW.discovery_block_hash, NEW.discovery_receipt_id,
      NEW.discovery_event_index, NEW.discovery_block_height
    ) IS DISTINCT FROM ROW(
      OLD.job_id, OLD.network_id, OLD.contract_id, OLD.payout_id, OLD.campaign_id,
      OLD.job_creation_idempotency_key, OLD.snapshot_digest, OLD.payload_hash,
      OLD.payout_snapshot,
      OLD.input_atomic_amount, OLD.expected_output_atomic_amount,
      OLD.observed_contract_status, OLD.execution_reference,
      OLD.discovery_tx_hash, OLD.discovery_block_hash, OLD.discovery_receipt_id,
      OLD.discovery_event_index, OLD.discovery_block_height
    )
  THEN
    RAISE EXCEPTION 'Execution-job identity and payout snapshot are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER execution_jobs_snapshot_immutable
    BEFORE UPDATE ON execution_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.disburse_prevent_execution_job_snapshot_mutation();

-- Reference-only provider and verification tables below are not currently migrated.
CREATE TABLE provider_references (
    provider_reference_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES execution_jobs(job_id),
    attempt_id BIGINT REFERENCES execution_attempts(attempt_id),
    provider_id TEXT NOT NULL,
    provider_execution_reference TEXT NOT NULL,
    destination_chain_id TEXT,
    transaction_reference TEXT,
    event_identifier TEXT,
    event_identifier_key TEXT NOT NULL DEFAULT '',
    first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider_id, provider_execution_reference),
    FOREIGN KEY (job_id, attempt_id)
        REFERENCES execution_attempts(job_id, attempt_id)
);

CREATE UNIQUE INDEX provider_external_identity_uq
    ON provider_references (
        provider_id,
        destination_chain_id,
        transaction_reference,
        event_identifier_key
    )
    WHERE destination_chain_id IS NOT NULL AND transaction_reference IS NOT NULL;

CREATE TABLE verification_records (
    verification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES execution_jobs(job_id),
    attempt_id BIGINT REFERENCES execution_attempts(attempt_id),
    outcome TEXT NOT NULL CHECK (outcome IN ('verified', 'insufficient', 'mismatch')),
    verifier_component TEXT NOT NULL,
    verification_method TEXT NOT NULL,
    verifier_account_id TEXT,
    evidence_reference TEXT,
    content_hash TEXT,
    normalized_claims JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (job_id, attempt_id)
        REFERENCES execution_attempts(job_id, attempt_id)
);

CREATE TABLE settlement_submission_attempts (
    settlement_attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES execution_jobs(job_id),
    attempt_id BIGINT REFERENCES execution_attempts(attempt_id),
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    signer_account_id TEXT NOT NULL,
    settlement_evidence_reference TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    transaction_hash TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'prepared', 'submitted', 'confirmed', 'definitively-failed', 'unknown'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, settlement_evidence_reference),
    UNIQUE (network_id, contract_id, settlement_evidence_reference),
    FOREIGN KEY (job_id, attempt_id)
        REFERENCES execution_attempts(job_id, attempt_id)
);

CREATE TABLE processing_errors (
    error_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT REFERENCES execution_jobs(job_id),
    attempt_id BIGINT REFERENCES execution_attempts(attempt_id),
    stage TEXT NOT NULL,
    classification TEXT NOT NULL,
    retryable BOOLEAN NOT NULL,
    message TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (job_id, attempt_id)
        REFERENCES execution_attempts(job_id, attempt_id)
);

CREATE TABLE reconciliation_history (
    reconciliation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES execution_jobs(job_id),
    observed_contract_status TEXT,
    observed_provider_status TEXT,
    observed_execution_reference TEXT,
    action TEXT NOT NULL,
    source TEXT NOT NULL,
    actor_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Milestone 9 read-only NEAR discovery tables. These are reference definitions only.
-- The NEAR contract remains authoritative; these rows are operational observations.
CREATE TABLE near_discovered_payouts (
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    payout_id NUMERIC(20, 0) NOT NULL CHECK (payout_id >= 0),
    campaign_id NUMERIC(20, 0) NOT NULL CHECK (campaign_id >= 0),
    latest_contract_status TEXT NOT NULL,
    payout_snapshot JSONB NOT NULL,
    discovered_event_key TEXT NOT NULL,
    last_observed_at TIMESTAMPTZ NOT NULL,
    reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN (
        'current', 'stale', 'missing', 'discrepant', 'rpc-error'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (network_id, contract_id, payout_id)
);

CREATE TABLE near_indexed_events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    block_height NUMERIC(20, 0) NOT NULL CHECK (block_height >= 0),
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    receipt_id TEXT NOT NULL,
    event_index INTEGER NOT NULL CHECK (event_index >= 0),
    event_name TEXT,
    event_version TEXT,
    decode_status TEXT NOT NULL CHECK (decode_status IN ('known', 'unknown', 'malformed')),
    payout_id NUMERIC(20, 0),
    campaign_id NUMERIC(20, 0),
    raw_log TEXT NOT NULL,
    canonical_payload_hash TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decoded_payload JSONB,
    source_cursor TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (network_id, contract_id, block_hash, transaction_hash, receipt_id, event_index)
);

CREATE TABLE near_discovery_blocks (
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    block_height NUMERIC(20, 0) NOT NULL CHECK (block_height >= 0),
    block_hash TEXT NOT NULL,
    parent_block_hash TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    contract_receipt_count INTEGER NOT NULL CHECK (contract_receipt_count >= 0),
    contract_log_count INTEGER NOT NULL CHECK (contract_log_count >= 0),
    canonical_payload_hash TEXT NOT NULL,
    first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (network_id, contract_id, block_height)
);

CREATE TABLE near_discovery_incidents (
    incident_id TEXT PRIMARY KEY,
    incident_type TEXT NOT NULL,
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    block_height NUMERIC(20, 0),
    event_key TEXT,
    expected_values JSONB,
    observed_values JSONB,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'unverifiable')),
    action_required TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE near_discovery_recoveries (
    recovery_id TEXT PRIMARY KEY,
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    start_block_height NUMERIC(20, 0) NOT NULL CHECK (start_block_height >= 0),
    end_block_height NUMERIC(20, 0) NOT NULL CHECK (end_block_height >= start_block_height),
    status TEXT NOT NULL CHECK (status IN ('running', 'validated', 'conflict', 'unavailable')),
    cursor_value TEXT,
    blocks_checked BIGINT NOT NULL DEFAULT 0 CHECK (blocks_checked >= 0),
    events_checked BIGINT NOT NULL DEFAULT 0 CHECK (events_checked >= 0),
    summary TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX near_indexed_events_payout_idx
    ON near_indexed_events (network_id, contract_id, payout_id, block_height, event_index);

CREATE TABLE near_event_cursors (
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    cursor_value TEXT NOT NULL,
    cursor_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_successful_event_key TEXT,
    PRIMARY KEY (network_id, contract_id, source_id)
);

CREATE TABLE near_discovery_errors (
    error_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    event_key TEXT,
    payout_id NUMERIC(20, 0),
    stage TEXT NOT NULL,
    classification TEXT NOT NULL,
    retryable BOOLEAN NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    next_retry_at TIMESTAMPTZ,
    message TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE near_reconciliation_history (
    reconciliation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    payout_id NUMERIC(20, 0) NOT NULL CHECK (payout_id >= 0),
    indexed_status TEXT,
    observed_status TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'matched', 'refreshed', 'missing', 'discrepant', 'rpc-error'
    )),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Security repository tables applied by migration 0001; this file remains reference DDL.
-- Application code uses conditional UPDATE ... WHERE lifecycle = ... RETURNING statements so
-- PostgreSQL row-level update locking admits only one competing lifecycle transition.
CREATE TABLE execution_authorizations (
    authorization_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL CHECK (campaign_id ~ '^(0|[1-9][0-9]{0,19})$' AND campaign_id::numeric <= 18446744073709551615),
    payout_id TEXT NOT NULL CHECK (payout_id ~ '^(0|[1-9][0-9]{0,19})$' AND payout_id::numeric <= 18446744073709551615),
    execution_attempt_id TEXT NOT NULL CHECK (length(execution_attempt_id) BETWEEN 1 AND 128),
    policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 64),
    policy_fingerprint CHAR(64) NOT NULL CHECK (policy_fingerprint ~ '^[a-f0-9]{64}$'),
    authorization_hash CHAR(64) NOT NULL CHECK (authorization_hash ~ '^[a-f0-9]{64}$'),
    provider_id TEXT NOT NULL,
    quote_reference TEXT NOT NULL,
    quote_issued_at TEXT NOT NULL,
    quote_expires_at TEXT NOT NULL,
    quote_fingerprint CHAR(64) NOT NULL CHECK (quote_fingerprint ~ '^[a-f0-9]{64}$'),
    quote_fresh_until TEXT NOT NULL,
    quote_required_input_atomic_amount TEXT NOT NULL CHECK (quote_required_input_atomic_amount ~ '^(0|[1-9][0-9]{0,38})$' AND quote_required_input_atomic_amount::numeric <= 340282366920938463463374607431768211455),
    quote_minimum_output_atomic_amount TEXT NOT NULL CHECK (quote_minimum_output_atomic_amount ~ '^(0|[1-9][0-9]{0,38})$' AND quote_minimum_output_atomic_amount::numeric <= 340282366920938463463374607431768211455),
    reservation_identity TEXT NOT NULL,
    reservation_observed_at_block TEXT NOT NULL CHECK (reservation_observed_at_block ~ '^(0|[1-9][0-9]{0,19})$' AND reservation_observed_at_block::numeric <= 18446744073709551615),
    near_network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    source_network_id TEXT NOT NULL,
    source_token_id TEXT NOT NULL,
    destination_network_id TEXT NOT NULL,
    destination_token_id TEXT NOT NULL,
    recipient_address TEXT NOT NULL,
    refund_address TEXT NOT NULL,
    refund_policy_fingerprint CHAR(64) NOT NULL CHECK (refund_policy_fingerprint ~ '^[a-f0-9]{64}$'),
    maximum_input_atomic_amount TEXT NOT NULL CHECK (maximum_input_atomic_amount ~ '^(0|[1-9][0-9]{0,38})$' AND maximum_input_atomic_amount::numeric <= 340282366920938463463374607431768211455),
    expected_output_atomic_amount TEXT NOT NULL CHECK (expected_output_atomic_amount ~ '^(0|[1-9][0-9]{0,38})$' AND expected_output_atomic_amount::numeric <= 340282366920938463463374607431768211455),
    authorized_at TIMESTAMPTZ NOT NULL,
    authorization_expires_at TIMESTAMPTZ NOT NULL,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Created', 'Approved', 'Consumed', 'Expired', 'Revoked')),
    approved_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    CHECK (authorization_expires_at > authorized_at),
    CHECK (authorization_id = 'auth:' || campaign_id || ':' || payout_id || ':' || execution_attempt_id),
    UNIQUE (campaign_id, payout_id, execution_attempt_id)
);

CREATE INDEX execution_authorizations_lifecycle_idx
    ON execution_authorizations (lifecycle, authorization_expires_at);

CREATE FUNCTION disburse_validate_authorization_update() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'authorization records cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.lifecycle <> 'Created' OR NEW.approved_at IS NOT NULL
           OR NEW.consumed_at IS NOT NULL OR NEW.revoked_at IS NOT NULL
           OR NEW.expired_at IS NOT NULL THEN
            RAISE EXCEPTION 'authorizations must be inserted in Created state';
        END IF;
        RETURN NEW;
    END IF;

    IF ROW(
        NEW.authorization_id, NEW.campaign_id, NEW.payout_id,
        NEW.execution_attempt_id, NEW.policy_version, NEW.policy_fingerprint,
        NEW.authorization_hash, NEW.provider_id, NEW.quote_reference,
        NEW.quote_issued_at, NEW.quote_expires_at, NEW.quote_fingerprint,
        NEW.quote_fresh_until, NEW.quote_required_input_atomic_amount,
        NEW.quote_minimum_output_atomic_amount, NEW.reservation_identity,
        NEW.reservation_observed_at_block, NEW.near_network_id, NEW.contract_id,
        NEW.source_network_id, NEW.source_token_id, NEW.destination_network_id,
        NEW.destination_token_id, NEW.recipient_address, NEW.refund_address,
        NEW.refund_policy_fingerprint, NEW.maximum_input_atomic_amount,
        NEW.expected_output_atomic_amount, NEW.authorized_at,
        NEW.authorization_expires_at
    ) IS DISTINCT FROM ROW(
        OLD.authorization_id, OLD.campaign_id, OLD.payout_id,
        OLD.execution_attempt_id, OLD.policy_version, OLD.policy_fingerprint,
        OLD.authorization_hash, OLD.provider_id, OLD.quote_reference,
        OLD.quote_issued_at, OLD.quote_expires_at, OLD.quote_fingerprint,
        OLD.quote_fresh_until, OLD.quote_required_input_atomic_amount,
        OLD.quote_minimum_output_atomic_amount, OLD.reservation_identity,
        OLD.reservation_observed_at_block, OLD.near_network_id, OLD.contract_id,
        OLD.source_network_id, OLD.source_token_id, OLD.destination_network_id,
        OLD.destination_token_id, OLD.recipient_address, OLD.refund_address,
        OLD.refund_policy_fingerprint, OLD.maximum_input_atomic_amount,
        OLD.expected_output_atomic_amount, OLD.authorized_at,
        OLD.authorization_expires_at
    ) THEN
        RAISE EXCEPTION 'authorization payload is immutable';
    END IF;

    IF NOT (
        (OLD.lifecycle = 'Created' AND NEW.lifecycle IN ('Approved', 'Expired', 'Revoked'))
        OR (OLD.lifecycle = 'Approved' AND NEW.lifecycle IN ('Consumed', 'Expired', 'Revoked'))
    ) THEN
        RAISE EXCEPTION 'invalid authorization lifecycle transition: % -> %', OLD.lifecycle, NEW.lifecycle;
    END IF;
    IF OLD.lifecycle = 'Created' AND NEW.lifecycle = 'Approved'
       AND (NEW.approved_at IS NULL OR NEW.consumed_at IS NOT NULL
            OR NEW.revoked_at IS NOT NULL OR NEW.expired_at IS NOT NULL) THEN
        RAISE EXCEPTION 'approval lifecycle timestamps are inconsistent';
    ELSIF OLD.lifecycle = 'Created' AND NEW.lifecycle = 'Expired'
       AND (NEW.approved_at IS NOT NULL OR NEW.consumed_at IS NOT NULL
            OR NEW.revoked_at IS NOT NULL OR NEW.expired_at IS NULL) THEN
        RAISE EXCEPTION 'expiry lifecycle timestamps are inconsistent';
    ELSIF OLD.lifecycle = 'Created' AND NEW.lifecycle = 'Revoked'
       AND (NEW.approved_at IS NOT NULL OR NEW.consumed_at IS NOT NULL
            OR NEW.expired_at IS NOT NULL OR NEW.revoked_at IS NULL) THEN
        RAISE EXCEPTION 'revocation lifecycle timestamps are inconsistent';
    ELSIF OLD.lifecycle = 'Approved' AND NEW.lifecycle = 'Consumed'
       AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at
            OR NEW.consumed_at IS NULL OR NEW.revoked_at IS NOT NULL
            OR NEW.expired_at IS NOT NULL) THEN
        RAISE EXCEPTION 'consumption lifecycle timestamps are inconsistent';
    ELSIF OLD.lifecycle = 'Approved' AND NEW.lifecycle = 'Expired'
       AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at
            OR NEW.consumed_at IS NOT NULL OR NEW.revoked_at IS NOT NULL
            OR NEW.expired_at IS NULL) THEN
        RAISE EXCEPTION 'expiry lifecycle timestamps are inconsistent';
    ELSIF OLD.lifecycle = 'Approved' AND NEW.lifecycle = 'Revoked'
       AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at
            OR NEW.consumed_at IS NOT NULL OR NEW.expired_at IS NOT NULL
            OR NEW.revoked_at IS NULL) THEN
        RAISE EXCEPTION 'revocation lifecycle timestamps are inconsistent';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER execution_authorizations_transition_guard
    BEFORE INSERT OR UPDATE OR DELETE ON execution_authorizations
    FOR EACH ROW EXECUTE FUNCTION disburse_validate_authorization_update();

CREATE TABLE payout_refund_policies (
    campaign_id TEXT NOT NULL CHECK (campaign_id ~ '^(0|[1-9][0-9]{0,19})$' AND campaign_id::numeric <= 18446744073709551615),
    payout_id TEXT NOT NULL CHECK (payout_id ~ '^(0|[1-9][0-9]{0,19})$' AND payout_id::numeric <= 18446744073709551615),
    source_network_id TEXT NOT NULL,
    source_token_id TEXT NOT NULL,
    refund_address TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    approved_at TIMESTAMPTZ NOT NULL,
    approved_at_iso TEXT NOT NULL,
    policy_fingerprint CHAR(64) NOT NULL CHECK (policy_fingerprint ~ '^[a-f0-9]{64}$'),
    PRIMARY KEY (campaign_id, payout_id),
    UNIQUE (campaign_id, payout_id, policy_fingerprint)
);

CREATE FUNCTION disburse_deny_refund_policy_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'approved payout refund policies are immutable';
END;
$$;

CREATE TRIGGER payout_refund_policies_immutable
    BEFORE UPDATE OR DELETE ON payout_refund_policies
    FOR EACH ROW EXECUTE FUNCTION disburse_deny_refund_policy_mutation();
