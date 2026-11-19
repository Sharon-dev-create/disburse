# M5-F.1D authorization concurrency verification

Authorization correction: PASS within the executed local scope. PostgreSQL regressions: PASS.

The materialized locked_authorization CTE obtains FOR UPDATE before its dependent authorization_decision evaluates clock_timestamp(). The consuming UPDATE uses that one sample for its exclusive expiry comparison and consumed timestamp, and retains Approved lifecycle and immutable hash predicates. Lock, decision and update form one SQL statement/transaction. Caller preflight time cannot override the database deadline. Approval, revocation and expiry marking use the same ordering. No schema or interface change was found.

Fresh PostgreSQL17 tests used verified database/role disburse_test at 127.0.0.1:19556. All 61 integration tests pass, including the 15 expiry regressions, concurrent consumers, revocation, rollback, exact boundary and durable restart. All 20 targeted lease/fencing tests pass (a subset, not additional unique coverage).

The historical independent B probe was copied into review evidence and augmented with explicit assertions of rejection, Expired lifecycle and null consumed_at. Three fresh synchronized runs use pg_blocking_pids to prove contention, wait against database expiry, release the blocker and inspect persisted state. This probe is separate from the implementation's fifteen tests. First fresh expiry: 2026-11-19T12:32:24.282Z; release: 12:32:24.586Z; actual result rejected, persisted Expired/null consumed_at. See independent-race*.json. Historical B evidence shows the same scenario accepted by the old statement_timestamp implementation; vulnerable production code was not restored.

Exact boundary tests use a test-only decision-clock substitution in real PostgreSQL; they do not prove natural microsecond scheduling. Protected decision time is after lock acquisition, not commit or later signing time. Database clock accuracy remains an operational dependency. No newly confirmed authorization or lease vulnerability was found. Review code changes no production logic.
