# M5-D — PostgreSQL evidence persistence

For current implementation findings and readiness, see the [latest security review](milestone-5d2-independent-security-review.md). Historical milestone statements below describe their original scope and do not authorize execution.

Migration0004 is additive and uses the existing checksum/advisory-lock migration runner. Earlier migration files, tables, jobs, authorizations and refund policies are unchanged. Only a newly initialized PostgreSQL17 cluster under /tmp, listening on127.0.0.1:19543, was used. Repository operations verify current database/role are both disburse_test and server address is local. There is no production repository composition or running-host import.

Tables added:

- native_reconciliation_jobs: one immutable attempt identity and transaction locator, job status, monotonic fence, worker/expiry and persistent conflict flag.
- native_receipt_observations: source, captured verification-policy snapshot, complete bundle or unavailable-observation result, content hash, server timestamp; unique job/source/content ingestion.
- native_reconciliation_decisions: append-only classification/uncertainty/conflict history and verified lease worker identity, unique job/fence.
- native_reconciliation_receipt_claims and native_reconciliation_transaction_claims: one owner per chain/contract/receipt or transaction, preventing evidence reuse across attempt jobs.

Identity/locator conflicts reject without replacing the original job. Enqueue is idempotent under concurrency. Claim is one atomic FOR UPDATE SKIP LOCKED + UPDATE statement using PostgreSQL clock and increasing fencing token. Expired Processing jobs can be reclaimed. Read-only recheck explicitly requeues Done/ManualReview without clearing a persistent conflict. Counter overflow fails closed.

No transaction stays open during RPC calls. Completion takes a row lock, checks current worker/fence/unexpired lease and immutable payload, inserts observations idempotently, arbitrates receipt/transaction claims, appends a decision and updates job status in one transaction. Any error rolls back all completion writes. An expired worker cannot complete after another worker reclaims the job, and a second completion using the same fence rejects.

SQL triggers prevent updates/deletes to observation, decision and evidence-claim rows and prevent job identity/locator rewrite, fence decrease or conflict clearing. History reads recompute payload hashes. This is integrity against ordinary repository operations, not protection against a PostgreSQL superuser/table owner dropping triggers or a compromised privileged process inserting fabricated observations. The database is never settlement authority.

Real tests exercise duplicate concurrent enqueue/claim, content dedupe, immutable history, identity/locator conflicts, expiry/fencing, rollback, sticky conflicting/reused evidence and a worker SIGKILL followed by a fresh process recovering the same database job. Restart testing preserves an existing observation/decision, kills a process after its next lease commits, then completes an unresolved decision in a new process; no transaction resubmission or transfer occurs. Repository-only fixtures do not claim to be RPC-verified transfers. Separate integration tests persist actual local receipt observations.

Production schema application, credentials, workers and read-only settings were not changed. Future deployment of the package needs a separately approved0004 migration plan; no production migration was attempted.
