-- Reference PostgreSQL schema only. This file is not run by package scripts.
-- Apply only after a separately reviewed, environment-specific migration plan.

CREATE TABLE execution_jobs (
    job_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    payout_id NUMERIC(20, 0) NOT NULL CHECK (payout_id >= 0),
    campaign_id NUMERIC(20, 0) NOT NULL CHECK (campaign_id >= 0),
    state TEXT NOT NULL CHECK (state IN (
        'Discovered', 'Queued', 'Leased', 'Preparing', 'SubmissionStarted',
        'SubmissionUnknown', 'Submitted', 'ConfirmationPending', 'VerificationPending',
        'SettlementReady', 'SettlementSubmitted', 'Completed', 'RetryableFailure',
        'ManualReview', 'Abandoned'
    )),
    contract_status TEXT NOT NULL,
    provider_id TEXT,
    execution_reference TEXT NOT NULL,
    provider_idempotency_key TEXT NOT NULL,
    payout_snapshot JSONB NOT NULL,
    state_version BIGINT NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    discovery_tx_hash TEXT NOT NULL,
    discovery_event_index INTEGER NOT NULL CHECK (discovery_event_index >= 0),
    discovery_block_height NUMERIC(20, 0) NOT NULL CHECK (discovery_block_height >= 0),
    last_reconciled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (network_id, contract_id, payout_id),
    UNIQUE (network_id, contract_id, execution_reference),
    UNIQUE (network_id, contract_id, provider_idempotency_key),
    UNIQUE (network_id, contract_id, discovery_tx_hash, discovery_event_index)
);

CREATE INDEX execution_jobs_claimable_idx
    ON execution_jobs (state, updated_at)
    WHERE state IN ('Queued', 'Leased');

CREATE TABLE execution_attempts (
    attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES execution_jobs(job_id),
    sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
    attempt_key TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN (
        'validate', 'quote', 'prepare', 'submit', 'confirm', 'verify', 'settle'
    )),
    provider_id TEXT,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'started', 'accepted', 'rejected', 'unknown', 'verified', 'failed'
    )),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    UNIQUE (job_id, sequence_number),
    UNIQUE (job_id, attempt_key)
);

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
    UNIQUE (
        provider_id,
        destination_chain_id,
        transaction_reference,
        event_identifier_key
    )
);

CREATE TABLE job_leases (
    job_id BIGINT PRIMARY KEY REFERENCES execution_jobs(job_id),
    worker_id TEXT NOT NULL,
    fencing_token BIGINT NOT NULL CHECK (fencing_token > 0),
    acquired_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    renewed_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > acquired_at)
);

CREATE INDEX job_leases_expiration_idx ON job_leases (expires_at);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settlement_submission_attempts (
    settlement_attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES execution_jobs(job_id),
    attempt_id BIGINT REFERENCES execution_attempts(attempt_id),
    signer_account_id TEXT NOT NULL,
    settlement_evidence_reference TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    transaction_hash TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'prepared', 'submitted', 'confirmed', 'definitively-failed', 'unknown'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, settlement_evidence_reference)
);

CREATE TABLE processing_errors (
    error_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT REFERENCES execution_jobs(job_id),
    attempt_id BIGINT REFERENCES execution_attempts(attempt_id),
    stage TEXT NOT NULL,
    classification TEXT NOT NULL,
    retryable BOOLEAN NOT NULL,
    message TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
