# M5-D.3 concurrency regression results

Real PostgreSQL 17, dedicated temporary `disburse_test` role/database on loopback port 19546. Existing guarded configuration and pool are reused. No live/development database is used. Tests extend `execution-service/tests/integration/postgres-jobs.test.ts` rather than creating another persistence implementation or test framework.

## Before and after

The two original tests failed against the unchanged vulnerable class with actual unsafe success (2 failed assertions), then passed against the corrected class without relaxing their assertions. [Before](evidence/milestone-5/m5d3/before-regressions-confirmed.log), [after](evidence/milestone-5/m5d3/after-two-regressions.log). Both preserve exact persisted snapshots and row counts. Earlier first-attempt logs contain a fixture idempotency collision; only the repeat with unique synthetic job keys counts as the completed before-fix demonstration.

An additional replay against an isolated pristine baseline copy reproduced unsafe success after waiting on the actual lease row FOR UPDATE. This replay occurred after remediation without reverting the working source; it supplements the two mandatory pre-implementation reproductions. See [baseline row-lock replay](evidence/milestone-5/m5d3/pristine-baseline-lease-row-regression.log). The first copy lacked migration files; that setup failure is retained and is not counted as a vulnerability reproduction.

## Fourteen new tests

| Coverage | Verified result |
|---|---|
| Expiry during final transition UPDATE lock wait | Explicit stale failure; complete persisted snapshot unchanged |
| Zero-row release after expiry during DELETE wait | rowCount 0; explicit failure; version/state/lease unchanged |
| Waiting for the lease row before initial validation | Expiry rechecked after actual row lock; rejected |
| Valid owner after bounded write contention | Preparing committed; exactly one version increment |
| Wrong owner, stale fence and old version | Both transition and release reject; snapshots unchanged |
| Reclaimed generation with simultaneous old/new transitions | Old owner cannot release or transition; only new owner wins |
| Valid release followed by duplicate release | First deletes lease and increments once; second rejects unchanged |
| Concurrent release and transition | Exactly one winner/version increment; lease/state consistent with winner |
| Failure after successful lease deletion | Injected failure rolls deletion/version back atomically |
| Expired cleanup through existing recovery API | Stale release rejects; legitimate recovery removes lease and queues job once |
| Renewal expiry at its later UPDATE | Provisional job version update rolls back |
| Attempt expiry at job UPDATE | Provisional attempt insertion rolls back |
| Failure-record expiry at job UPDATE | Failure metadata/version roll back |
| Terminal transition expiry at lease DELETE | Provisional state/version change rolls back |

The complete PostgreSQL suite passed **46 tests, 0 failures, 0 skips**: 32 existing plus 14 new. Existing native row-lock/evidence-claim expiry, fencing, sticky-conflict, duplicate writer and actual SIGKILL/fresh-process recovery tests remain green. Current-source results from the complete sandbox wrapper are recorded in the validation report.

## Determinism and boundaries

The test client wrapper forwards the real, unchanged SQL on a real connection. Before forwarding the selected mutation it obtains a compatible SHARE relation lock on an independent connection; actual blocking is established through pg_blocking_pids/pg_stat_activity. A separate case holds the actual lease row FOR UPDATE. Only after the barrier is observed does pg_sleep hold contention for 900 ms across a 500 ms lease. This is a deterministic database interleaving, not a fake affected-row response or a sleep-only race.

New tests have 10-second timeouts; the contention connections set 5-second statement timeouts and use finally rollback/release/reset. The test database role/host checks and existing additive migration runner remain intact. The fixtures isolate claimable synthetic jobs; they never target production records. Snapshot comparisons cover version, state, lease, attempts, failure metadata and protected payout/event data.

Row locks and fencing prevent old generations from overwriting a reclaimed owner. Database state is operational evidence only. These tests schedule no token transfers and establish no on-chain settlement authority.
