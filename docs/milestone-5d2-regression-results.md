# M5-D.2 fresh regression results

Inspection/test date: 2026-11-17. Initial revision `8b2c068bfb31eb47ec4ed61194a1a98c2ea5149a` plus D.1 working-tree fix/tests; later externally observed revision `24193abb93bcf4ca293179c6e5952ab3b87bf275`. Application source/WASM hashes stayed unchanged. Tests were run for this review; previous milestone logs are not substituted for fresh results.

| Supported command / verification | Completed result | Evidence under docs/evidence/milestone-5/m5d2 |
|---|---|---|
| cargo fmt --all -- --check | PASS | rust-fmt.log |
| cargo clippy --locked --all-targets -- -D warnings | PASS | clippy.log |
| cargo test --locked | 146 passed, 0 failed/ignored; 0 doc-tests | rust-tests.log |
| cargo near build non-reproducible-wasm --locked | PASS, expected 410611-byte WASM hash | wasm-build.log |
| execution-service: pnpm check | format/typecheck/lint PASS; 134 tests passed, 0 failed/skipped | service-check.log |
| execution-service: pnpm db:migrate:test | PASS, checksum/current-version/idempotency coverage | migrations.log; restarted-migrations.log; sandbox/test-migrations.log |
| execution-service: pnpm test:postgres | 32 passed, 0 failed/skipped | postgres-migrated-tests.log; independently rerun sandbox/postgres-tests.log |
| complete tests/sandbox/run_reconciliation.py wrapper | PASS, all three C phases and D receipt collection/tests/overlap completed | sandbox-run.log; sandbox/reproduction-result.json |
| local live-RPC reconciliation tests | 8 passed, 0 failed/skipped | sandbox/live-read-only-tests.log |
| callback/observer overlap | PASS, real synthetic transfer; observer launched before finality | sandbox/callback-observer-race.json |
| git diff --check and git diff --cached --check | PASS | final-integrity.json |

The first service attempt failed because the sandbox could not access the existing dependency store; rerunning with permitted access completed the supported pnpm check. The first PostgreSQL suite on an empty cluster had a setup race: the read-only test asserted current migrations before other files finished applying them. That failed log remains `postgres-tests.log`. Explicit migration setup before the supported integration suite produced the clean 32/32 result. No application change was made to mask either setup failure.

The host restarted during fixture preparation, deleting temporary tools/DB state and stopping that attempt. The completed Rust/service/PostgreSQL logs survived. A dedicated database and pinned tools were restored, and the complete asynchronous wrapper was then run to exit 0. The interrupted attempt is not counted as completed sandbox evidence.

## Receipt scenario count

The generated summaries contain **17 named payout scenarios**, not a single summary array of 20. There are 10 main cases and 7 fault cases. Add the historical-WASM migration, B-to-C migration and actual callback/observer overlap to obtain **20 completed receipt scenario groups** for this review. This explicit grouping avoids presenting the response-discard model as an actual process restart. External/private callback attacks and duplicate retries are additional assertions within the run, not extra entries in this count.

| Group | Completed scenarios |
|---|---|
| Main, 10 | successful transfer; missing recipient storage; definitive token rejection; concurrent duplicate execution; concurrent payout one; concurrent payout two; same-campaign concurrent payouts; minimum/insufficient gas; native NEAR headroom; external-callback payout success |
| Faults, 7 | pause after dispatch; scheduling panic; callback panic; callback OOG; incompatible upgrade between transfer and callback; delivered but unexpected return; insufficient token balance |
| Migration, 2 | authenticated historical deployed WASM to C; authenticated M5-B to C |
| Overlap, 1 | real callback settlement with independent read-only observer |

All used real private nearcore 2.14.0 action/data receipts under synthetic chain `disburse-m5c-local`, on loopback, with public deterministic fixture keys. No live account signing access was used. The download archive and binary were SHA-pinned; release-signature verification is not claimed. Fault hooks are isolated artifact copies and are absent from production WASM.

The discarded-response/fresh-client sandbox scenario is a restart **model**. The PostgreSQL suite separately kills a real child process with SIGKILL and starts a fresh worker to recover the persisted job and reject the old fence. These are distinct forms of coverage.

## Migration and provenance

Historical WASM SHA-256 `a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530` was retrieved through public read-only view_code and checked against the known identity. M5-B was rebuilt from unmodified repository revision fdd8b48 and matched `ad51f8bc061138013ff33620d33adff8dffacb4eaf1c06b09853c79b92c58e94`. Candidate C matched `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`.

The historical migration populates synthetic state under authenticated old bytecode; it is not a copy of all live contract state/history. It verifies state/accounting preservation, owner-only bootstrap and rejection of repeated bootstrap. B-to-C verifies existing approved attempt execution and preservation of the consumed orphan-preflight lock. That orphan remains frozen; no authenticated recovery is added. PostgreSQL migration 0004 remains additive and checksum-protected; only dedicated test databases received migration writes.

Fresh local read-only classifications: successful transfer → ObservedSucceededSettled; panic/OOG callback → ObservedSucceededSettlementPending; definitive rejection/insufficient token balance → ObservedTransferFailed; unexpected transfer return → ManualReview. Missing/forged/unavailable receipt evidence cannot establish payment. All receipt tests preserve the distinction between delivery and campaign settlement; the observer makes no on-chain change.

## Independent negative results

Original pre-fix class: expired decision accepted after 924.34 ms. Fixed class: rejected after 919.17 ms, no partial writes. Further native final-update contention: rejected with zero-row update after 908.40 ms. Reclaimed native workers racing completion: only current B commits. See lease-fencing verification report.

Legacy nonterminal transition: **required invariant violated**, accepted Preparing after 907.29 ms on 500 ms lease. Legacy release: **required invariant violated**, ignored zero-row DELETE after 909.79 ms and committed a version bump while retaining an expired lease. Legacy renewal under comparable contention rejected; no unsafe renewal success is claimed. These audit failures are outside the passing 32 existing PostgreSQL tests, and are why the overall security verdict is FAIL.

All retained old D.1 manifest hashes and the reviewed application source/WASM hashes matched at completion. The isolated sandbox repository used the exact current native fix and all five D.1 regression tests; its suite ran 32 PostgreSQL tests, unlike the earlier D.1 30-test intermediate snapshot. No previous milestone evidence was overwritten.
