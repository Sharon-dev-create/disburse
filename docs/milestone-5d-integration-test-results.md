# M5-D — Local integration and regression results

**PARTIAL overall: read-only reconciliation passed; authenticated on-chain recovery remains BLOCKED.** No proof verifier or approved recovery-attestation authority exists, so no recovery mutation was added.

The preceding [independent C re-review](milestone-5c-independent-implementation-rereview.md) passed for the pinned source/WASM with zero critical/high implementation findings. It is a separate adversarial pass by the same assistant, not third-party certification. D leaves that Rust source and artifact unchanged.

## Final exact results

| Check | Result |
| --- | --- |
| cargo fmt --all -- --check | PASS |
| cargo clippy --locked --all-targets -- -D warnings | PASS |
| cargo test --locked |146 passed,0 failed,0 ignored;0 doc tests |
| cargo near build non-reproducible-wasm --locked | PASS; C hash unchanged |
| pnpm format:check / typecheck / lint | All PASS |
| pnpm test |134 passed,0 failed/skipped (110 prior +24 new native tests) |
| pnpm test:postgres |27 passed,0 failed/skipped (21 prior +6 new native integration tests) |
| Explicit native-live.test.ts |8 passed,0 failed/skipped |
| Callback/observer overlap fixture | PASS; observer starts before settlement, C settles once |
| Migration reapplication | PASS; none applied, version0004 current |
| New Python harness syntax | PASS |
| git diff --check | PASS |

[Exact commands/logs](evidence/milestone-5/m5d/validation/) and [structured results](evidence/milestone-5/m5d-implementation-results.json) distinguish the layers. Final test runs used authorized local process/network access; restricted-runner per-file wrapper counts are not reported as subtests.

## Required scenario matrix

| Scenario | Evidence/result | Limits |
| --- | --- | --- |
| A normal success | Actual finalized token graph + native Succeeded, observed already-settled; no accounting mutation | Trusted reviewed local token; no new reconciliation settlement |
| B delivered / callback fails | Actual after-write panic and OOG receipts, token delivery; ObservedSucceededSettlementPending, reserve remains100000/spent0 | Fault artifacts are separate from production; no recovery mutation |
| C transfer failure | Actual rejection and insufficient-balance receipts; ObservedTransferFailed | Atomic reviewed fixture semantics; never authorizes retry/release |
| D missing receipt | Real local RPC with receipt lookup deliberately made unavailable; ManualReview, unchanged accounting | Injected response unavailability, not deletion of a real receipt |
| E conflicting RPC | Two individually acceptable captured graphs deliberately substituted; ManualReview/conflict | Mocked fork/equivocation, not actual consensus fork |
| F duplicate reconciliation | Repeated observations dedupe; concurrent same-fence completion has one winner | PostgreSQL fencing supplements, never replaces, chain lock |
| G callback / observer overlap | Observer begins before C settles, waits FINAL, persists observed already-settled result; exact source/recipient100000 movement asserted | Only C is a monetary completion path; no recovery mutation race falsely claimed |
| H process restart | Real SIGKILL after lease commit, fresh process completes same DB job; prior observations survive, stale old fence rejects | DB repository test uses labeled unresolved fixture decisions; not a new transfer |
| I forged evidence | Token/recipient/amount/campaign/payout/attempt/executor/network/binding/receipt/action/dependency/code/finality substitutions reject | Unit mutations over captured actual graphs |
| J migration | Two real old-deployed/B-WASM→C upgrades rerun with preserved state/custody | Synthetic populated history, authentic bytecode; D changes no Rust layout |

The fresh retained-history suite passed all three C phases and20 real receipt scenario groups. Six D graph fixtures were collected through actual finalized RPC, not synthesized transaction outcomes. Eight live-read subtests cover six cases, bounded discovery and missing-receipt handling. [Race evidence](evidence/milestone-5/m5d/callback-observer-race.json), [live results](evidence/milestone-5/m5d/live-reconciliation-tests.json), [durability evidence](evidence/milestone-5/m5d/postgres-durability.json) and raw retained suite evidence are preserved.

Local dual-source tests use two aliases of one synthetic node, not independently operated RPCs. Distinct-source conflict tests are mocks. PostgreSQL uses a fresh ephemeral local17 cluster and real transactions/processes. Nodes and test cluster were stopped after evidence export. No existing database or production service was used.

## Corrections and limitations

[Development notes](evidence/milestone-5/m5d/development-notes.json) record resolved runtime/typecheck/discovery/environment failures rather than silently skipping them. An unavailable older non-archival transaction remained unknown. A temporary archive-mode startup failed; a fresh node with extended GC retention was used instead. The actual ABI lacks a payout-count view, so discovery scans explicit bounded ID ranges and still requires indexed/submission transaction locators. No Rust ABI was added to hide this limitation.

The new convenience reproduction wrapper was syntax checked; its constituent generation, capture, service, PostgreSQL, live-read and race commands were executed. It was not run end-to-end again solely to repeat completed tests. Full streaming response memory limits, independent production RPC operators, actual Tidepool conformance, live recipient control, production locator indexing/API integration and authenticated on-chain recovery remain outside demonstrated scope. A failed collection records an unavailable observation; partial RPC responses before that failure are not separately journaled. No full failure-recovery PASS is claimed.

A separate independent M5-D security review is the next gate. No deployment, production worker, Testnet transaction, live payout, campaign/role/config change, Git commit or push was performed by this session.
