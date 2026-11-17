# M5-D.1 concurrency regression results

Real PostgreSQL17 dedicated local test cluster, disburse_test role/database on loopback19544. No live database was accessed.

Five new regression tests supplement the previous27 PostgreSQL tests:

-500ms lease with a row lock held at least900ms: explicit rejection and zero decisions.
-Valid5000ms lease after short contention: acceptance.
-Wrong owner/fence: rejection, followed by successful current-owner completion and duplicate rejection.
-Same-owner/same-generation database fixture extension: completion after the original deadline succeeds. No native renewal API exists.
-Expiry during a subsequent receipt-claim lock wait: final conditional writes reject; provisional observations and decisions roll back.

The contention cases synchronize on pg_blocking_pids/pg_stat_activity to prove the repository operation is actually blocked before holding it past expiry; timed delay is used only after that barrier. Existing tests separately exercise reclaimed generations, concurrent claims, one-winner completion, conflicting evidence, rollback and real worker SIGKILL/fresh-process recovery. Repository-only decisions are explicitly fixtures, not payment evidence.

Final existing supported commands passed: pnpm check (format/typecheck/lint and134 service tests), pnpm test:postgres (32 passed,0 failed/skipped), cargo fmt, Clippy with warnings denied,146 Rust tests (0 failed/ignored) and locked WASM build. The original source comparison and corrected result are preserved with actual database timestamps and committed state in docs/evidence/milestone-5/m5d1/.

Sandbox results are recorded separately in the structured remediation evidence once the complete isolated rerun terminates; the previously interrupted audit rerun is not counted as completed evidence.

Completed isolated sandbox rerun:20 real receipt scenario groups, both historical/B migration paths,8 live read-only reconciliation tests and callback/observer overlap all passed. The isolated repository implementation hash equals the final working-tree implementation. Its PostgreSQL snapshot ran30 tests (first3 new cases); the final working-tree suite ran32 tests including all5 new cases. Existing implementation/review evidence was not overwritten.
