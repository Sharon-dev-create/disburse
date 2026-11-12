DO $$
BEGIN
  IF to_regclass('public.execution_jobs') IS NOT NULL
     OR to_regclass('public.execution_attempts') IS NOT NULL
     OR to_regclass('public.job_leases') IS NOT NULL
     OR to_regclass('public.execution_jobs_job_id_seq') IS NOT NULL
     OR to_regclass('public.execution_attempts_attempt_id_seq') IS NOT NULL
     OR to_regclass('public.execution_jobs_payout_identity_uq') IS NOT NULL
     OR to_regclass('public.execution_jobs_idempotency_uq') IS NOT NULL
     OR to_regclass('public.execution_jobs_discovery_event_uq') IS NOT NULL
     OR to_regclass('public.execution_jobs_claimable_idx') IS NOT NULL
     OR to_regclass('public.execution_jobs_execution_reference_uq') IS NOT NULL
     OR to_regclass('public.execution_jobs_pkey') IS NOT NULL
     OR to_regclass('public.execution_attempts_pkey') IS NOT NULL
     OR to_regclass('public.job_leases_pkey') IS NOT NULL
     OR to_regclass('public.execution_attempts_attempt_key_uq') IS NOT NULL
     OR to_regclass('public.execution_attempts_idempotency_uq') IS NOT NULL
     OR to_regclass('public.execution_attempts_sequence_uq') IS NOT NULL
     OR to_regclass('public.execution_attempts_job_attempt_uq') IS NOT NULL
     OR to_regclass('public.job_leases_expiration_idx') IS NOT NULL
     OR to_regclass('public.execution_jobs_snapshot_immutable') IS NOT NULL
     OR to_regprocedure('public.disburse_prevent_execution_job_snapshot_mutation()') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Found unversioned execution-job objects; refusing to adopt or modify them';
  END IF;
END;
$$;

CREATE TABLE public.execution_jobs (
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

CREATE INDEX public.execution_jobs_claimable_idx
    ON public.execution_jobs (next_eligible_at, created_at, job_id)
    WHERE state = 'Queued';

CREATE TABLE public.execution_attempts (
    attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES public.execution_jobs(job_id),
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

CREATE TABLE public.job_leases (
    job_id BIGINT PRIMARY KEY REFERENCES public.execution_jobs(job_id),
    worker_id TEXT NOT NULL CHECK (length(btrim(worker_id)) BETWEEN 1 AND 256),
    fencing_token NUMERIC(39, 0) NOT NULL CHECK (fencing_token > 0),
    acquired_at TIMESTAMPTZ NOT NULL,
    renewed_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > acquired_at),
    CHECK (renewed_at >= acquired_at)
);

CREATE INDEX public.job_leases_expiration_idx ON public.job_leases (expires_at);

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
    BEFORE UPDATE ON public.execution_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.disburse_prevent_execution_job_snapshot_mutation();
