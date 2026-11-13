CREATE INDEX execution_jobs_campaign_read_idx
    ON public.execution_jobs (
        network_id,
        contract_id,
        campaign_id,
        created_at DESC,
        job_id DESC
    );
