-- Local-only M5-D evidence subsystem. No on-chain authorization or execution jobs are modified.
CREATE TABLE public.native_reconciliation_jobs (
  job_key CHAR(64) PRIMARY KEY CHECK (job_key ~ '^[a-f0-9]{64}$'),
  identity JSONB NOT NULL CHECK (jsonb_typeof(identity) = 'object'),
  locator JSONB NOT NULL CHECK (jsonb_typeof(locator) = 'object'),
  state TEXT NOT NULL DEFAULT 'Queued' CHECK (state IN ('Queued','Processing','Done','ManualReview')),
  fence BIGINT NOT NULL DEFAULT 0 CHECK (fence >= 0),
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  semantic_digest CHAR(64),
  conflicted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

CREATE UNIQUE INDEX native_reconciliation_identity_uq ON public.native_reconciliation_jobs
 ((identity->>'chainId'),(identity->>'contractId'),(identity->>'payoutId'),(identity->>'attemptId'));
CREATE TABLE public.native_receipt_observations (
  job_key CHAR(64) NOT NULL REFERENCES public.native_reconciliation_jobs(job_key),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 512),
  content_digest CHAR(64) NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (job_key,source_id,content_digest)
);
CREATE TABLE public.native_reconciliation_decisions (
  decision_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_key CHAR(64) NOT NULL REFERENCES public.native_reconciliation_jobs(job_key),
  fence BIGINT NOT NULL,
  decision JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (job_key,fence)
);
CREATE TABLE public.native_reconciliation_receipt_claims (
  chain_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  job_key CHAR(64) NOT NULL REFERENCES public.native_reconciliation_jobs(job_key),
  PRIMARY KEY (chain_id,contract_id,receipt_id)
);
CREATE TABLE public.native_reconciliation_transaction_claims (
  chain_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  job_key CHAR(64) NOT NULL REFERENCES public.native_reconciliation_jobs(job_key),
  PRIMARY KEY (chain_id,contract_id,transaction_hash)
);
CREATE FUNCTION public.disburse_native_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Native reconciliation historical evidence is immutable';
END;
$$;
CREATE TRIGGER native_observation_immutable BEFORE UPDATE OR DELETE ON public.native_receipt_observations
 FOR EACH ROW EXECUTE FUNCTION public.disburse_native_evidence_immutable();
CREATE TRIGGER native_decision_immutable BEFORE UPDATE OR DELETE ON public.native_reconciliation_decisions
 FOR EACH ROW EXECUTE FUNCTION public.disburse_native_evidence_immutable();
CREATE TRIGGER native_receipt_claim_immutable BEFORE UPDATE OR DELETE ON public.native_reconciliation_receipt_claims
 FOR EACH ROW EXECUTE FUNCTION public.disburse_native_evidence_immutable();
CREATE TRIGGER native_transaction_claim_immutable BEFORE UPDATE OR DELETE ON public.native_reconciliation_transaction_claims
 FOR EACH ROW EXECUTE FUNCTION public.disburse_native_evidence_immutable();
CREATE FUNCTION public.disburse_native_job_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.job_key IS DISTINCT FROM OLD.job_key OR NEW.identity IS DISTINCT FROM OLD.identity
 OR NEW.locator IS DISTINCT FROM OLD.locator OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.fence < OLD.fence OR (OLD.conflicted AND NOT NEW.conflicted) THEN
 RAISE EXCEPTION 'Native reconciliation identity, fencing and conflict lock are immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER native_job_identity_immutable BEFORE UPDATE ON public.native_reconciliation_jobs
 FOR EACH ROW EXECUTE FUNCTION public.disburse_native_job_identity_immutable();
