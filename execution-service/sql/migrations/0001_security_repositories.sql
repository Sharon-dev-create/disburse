-- Versioned equivalent of the security repository DDL in sql/schema.sql.
-- This migration is intentionally additive and refuses pre-existing unversioned objects.
DO $$
BEGIN
    IF to_regclass('public.execution_authorizations') IS NOT NULL
       OR to_regclass('public.payout_refund_policies') IS NOT NULL
       OR to_regprocedure('public.disburse_validate_authorization_update()') IS NOT NULL
       OR to_regprocedure('public.disburse_deny_refund_policy_mutation()') IS NOT NULL THEN
        RAISE EXCEPTION 'unversioned Disburse security objects already exist';
    END IF;
END;
$$;

CREATE TABLE public.execution_authorizations (
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
    ON public.execution_authorizations (lifecycle, authorization_expires_at);

CREATE FUNCTION public.disburse_validate_authorization_update() RETURNS trigger
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
    BEFORE INSERT OR UPDATE OR DELETE ON public.execution_authorizations
    FOR EACH ROW EXECUTE FUNCTION public.disburse_validate_authorization_update();

CREATE TABLE public.payout_refund_policies (
    campaign_id TEXT NOT NULL CHECK (campaign_id ~ '^(0|[1-9][0-9]{0,19})$' AND campaign_id::numeric <= 18446744073709551615),
    payout_id TEXT NOT NULL CHECK (payout_id ~ '^(0|[1-9][0-9]{0,19})$' AND payout_id::numeric <= 18446744073709551615),
    source_network_id TEXT NOT NULL,
    source_token_id TEXT NOT NULL,
    refund_address TEXT NOT NULL,
    policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 64),
    approved_at TIMESTAMPTZ NOT NULL,
    approved_at_iso TEXT NOT NULL,
    policy_fingerprint CHAR(64) NOT NULL CHECK (policy_fingerprint ~ '^[a-f0-9]{64}$'),
    PRIMARY KEY (campaign_id, payout_id),
    UNIQUE (campaign_id, payout_id, policy_fingerprint)
);

CREATE FUNCTION public.disburse_deny_refund_policy_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'approved payout refund policies are immutable';
END;
$$;

CREATE TRIGGER payout_refund_policies_immutable
    BEFORE UPDATE OR DELETE ON public.payout_refund_policies
    FOR EACH ROW EXECUTE FUNCTION public.disburse_deny_refund_policy_mutation();
