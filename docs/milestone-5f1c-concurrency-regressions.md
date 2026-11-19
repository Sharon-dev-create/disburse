# M5-F.1C concurrency regressions

Fresh local PostgreSQL 17 cluster, loopback `127.0.0.1:19555`, database and role `disburse_test`. Physical database identity was queried before migrations/test writes; see `evidence/milestone-5/m5f1c/database-identity.log`. No production database was used.

Before production changes, three targeted tests failed against the original implementation: consumption, approval and revocation after expiry during a confirmed row-lock wait. All pass after the fix.

New integration tests: **15 passed, zero failed/skipped**:

1. Valid consumption before expiry.
2. Already expired, despite a stale caller clock: rejected, Expired, no consumed timestamp, hash retained.
3. Expiry during confirmed row-lock wait: rejected, Expired, no consumed timestamp.
4. Valid short lock wait: accepted, consumed timestamp after blocker release and before expiry.
5. Expiry immediately before the SQL decision: rejected.
6. Concurrent consumers: one winner.
7. Concurrent revocation while consumer waits: Revoked, never Consumed.
8. Already consumed: rejected with unchanged stored state.
9. Injected failure after a successful SQL update in a caller transaction: rollback restores Approved and a later legitimate consumption succeeds.
10. Durable result across fresh pool/repository construction: replay rejected.
11. Decision one microsecond before expiry: accepted.
12. Decision exactly at expiry: rejected.
13. Decision one microsecond after expiry: rejected.
14. Approval crossing expiry during lock wait: Expired, no approval timestamp.
15. Revocation crossing expiry during lock wait: Expired, no revocation timestamp.

Lock contention uses separate clients and `pg_blocking_pids`, with a bounded observation deadline. Deadline waits derive from PostgreSQL `clock_timestamp()` and the stored expiry. Short polling is used only to observe the barrier. Exact microsecond boundary tests replace the decision clock expression through the injected query adapter in test code; the conditional SQL executes in real PostgreSQL. These are controlled-clock predicate tests, not claims of naturally scheduling an operation at an exact wall-clock microsecond. No test hooks were added to production. The pool/repository restart test is distinct from the existing child-process restart regression, which also passes in the full suite.

Full PostgreSQL suite: **61 passed** = existing 46 plus new 15. Existing targeted lease/fencing suite: **20 passed**; these are a subset, not 20 additional distinct tests. Full suite includes an actual child-process durable authorization restart, rollback, concurrent refund binding and native reconciliation fencing. No schema or migration changes.

Reproduce from `execution-service` with an explicitly verified dedicated local `DISBURSE_TEST_DATABASE_URL`:

```sh
pnpm db:migrate:test
node --experimental-strip-types --test tests/integration/postgres-authorization-expiry.test.ts
pnpm test:postgres
node --experimental-strip-types --test --test-name-pattern='legacy|expiry|fenc|lease|restart' tests/integration/postgres-jobs.test.ts tests/integration/postgres-native-lease-race.test.ts tests/integration/postgres-native-reconciliation.test.ts
```

Logs: `authorization-regressions.log`, `postgres.log`, `targeted-lease.log`, `migrations.log` under `evidence/milestone-5/m5f1c/`. Test files create unique fixture IDs; they must only run against the dedicated test database.
