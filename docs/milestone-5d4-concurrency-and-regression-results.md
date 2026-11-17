# M5-D.4 fresh concurrency and regression results

Reviewed and tested on 2026-11-17, revision `020cb7f79b5f86889f764f5dec2c8291e99094a3`, initially clean `main...origin/main`. These results were executed during this review; earlier D.3 counts are not substituted for fresh evidence.

| Supported command / check | Completed result | Evidence under evidence/milestone-5/m5d4-independent-review |
|---|---|---|
| cargo fmt --all -- --check | exit 0 | rust-fmt.log; rust-commands.json |
| cargo clippy --locked --all-targets -- -D warnings | exit 0 | clippy.log |
| cargo test --locked | 146 passed, 0 failed/ignored; 0 doc-tests | rust-tests.log |
| cargo near build non-reproducible-wasm --locked | exit 0; unchanged expected artifact | wasm-build.log |
| execution-service pnpm check | format/typecheck/lint and 134 tests passed, 0 failed/skipped | service-check.log |
| execution-service pnpm db:migrate:test | existing additive test migrations/checks complete | migrations.log; sandbox/test-migrations.log |
| execution-service pnpm test:postgres | 46 passed, 0 failed/skipped | postgres-tests.log; sandbox/postgres-tests.log |
| complete tests/sandbox/run_reconciliation.py | exit 0; three receipt/migration phases plus reconciliation and overlap finished | sandbox-run.log; sandbox/reproduction-result.json |
| Local finalized-RPC tests | 8 passed, 0 failed/skipped | sandbox/live-read-only-tests.log |
| Additional independent audit script | 6 completed checks, exit 0 | adversarial.mjs; adversarial-results.json |

The six extra audit checks are separate from the existing 46 tests: native expired row contention, native valid short contention, native expiry at final UPDATE after decision insertion, legacy final transition expiry, legacy zero-row release, and a delayed acquisition-return model. The first five use real row/relation lock contention and pg_blocking_pids barriers. The last deliberately delays the return after insertion; it is not a physical acquisition-lock proof. An initial invalid acquisition fixture timed out after requesting an incompatible lock; its source and explanation remain in adversarial-first-fixture.mjs and fixture-development-notes.json. No overall PASS is claimed for that initial run; the corrected complete script finished successfully. No application code was changed to make any check pass.

## Twelve concurrency requirements

| Case | Independently verified coverage |
|---|---|
| Expiry during contention | Native row and final-update audit; legacy transition/deletion audit; lease-row and later-write regressions |
| Valid lease under short contention | Native 5000 ms lease / 50 ms held lock; valid legacy owner regression |
| Reclamation by another worker | Fresh native and legacy stale/current-owner tests |
| Stale fencing generation | Owner/fence/version rejection, monotonic replacement, old/new concurrent transitions |
| Duplicate release | First succeeds once; repeat rejects with unchanged snapshot |
| Zero-row deletion | Fresh independent DELETE rowCount 0; no version/state change |
| Release versus transition | Existing fresh race requires exactly one version winner |
| Concurrent native decisions | Live-RPC tests race two complete calls; exactly one fulfills |
| Rollback | Native provisional decision/observation rollback; legacy deletion, attempt, failure and terminal-state rollback |
| Authorized expired cleanup | Existing recovery queues Leased jobs or preserves ManualReview policy; stale worker release remains rejected |
| Worker interruption | Actual child process receives SIGKILL in the PostgreSQL suite |
| Process restart | Distinct fresh worker recovers persisted ownership, larger fence and history; old fence rejects |

The sandbox's discarded-response/fresh-client case remains a model, distinct from real SIGKILL/fresh-worker coverage. No physical database-server crash or distributed consensus failure was tested.

## Twenty completed receipt groups

Count: 10 named main payout cases + 7 named fault cases + authenticated historical-WASM migration + M5-B-to-current migration + callback/reconciliation overlap = **20**. Authentication/retry subchecks are not inflated into extra group counts.

The run covers success, failure, unregistered storage, duplicate/concurrent requests, shared-campaign accounting, gas/headroom, private/stale callbacks, pause after dispatch, scheduling panic, callback panic/OOG, in-flight incompatible callback upgrade, unexpected token result and insufficient balance. The observer reports committed delivery separately from settlement; missing/unknown evidence remains ManualReview. Overlap proves one actual synthetic transfer and exactly-once callback settlement while the observer only records evidence.

All transactions occurred on private nearcore 2.14.0 synthetic chain disburse-m5c-local, loopback endpoints, deterministic public fixture keys. Two localhost aliases are not independent RPC operators. Historical old WASM and M5-B fixtures were cached authenticated artifacts; synthetic populated migration state is not an authentic populated live snapshot. Consumed orphan B preflight remains frozen; no recovery/reset was added.

Candidate C SHA-256: `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`, 410611 bytes; code hash `4mBF2J6mE22XrTrSNo8x7xSLhzUSfNS9HkzHJeaxqwk4`. Fresh locked rebuild matched. Historical migration fixture SHA-256: `a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530`; M5-B: `ad51f8bc061138013ff33620d33adff8dffacb4eaf1c06b09853c79b92c58e94`.

Existing migration files were not modified. Only the fresh dedicated local test database was initialized using the repository's existing migrations. The sandbox ran from a separate copy with initially empty evidence folders and identical reviewed source/test hashes. Earlier evidence was not overwritten. The private node and dedicated test database were stopped after verification. See final-integrity.json for source/evidence hashes, diff checks and final worktree status.
