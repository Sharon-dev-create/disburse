# M5-D.4 independent final PostgreSQL lease-safety review

**PASS for reviewed revision `020cb7f79b5f86889f764f5dec2c8291e99094a3`. M5-E local operational hardening may begin under its existing restrictions.** All three historical lease defects are independently confirmed corrected. No unresolved critical/high implementation or material medium lease-safety finding was identified. This does not authorize deployment, public-chain transactions, live payouts or worker activation.

Review date: 2026-11-17. Initial worktree clean, branch main tracking origin/main. This is a separate adversarial review pass by the same assistant, not a third-party certification. [Exact baseline/source inventory](evidence/milestone-5/m5d4-independent-review/baseline.json), [structured result](evidence/milestone-5/m5d4-independent-review/results.json), and [integrity verification](evidence/milestone-5/m5d4-independent-review/final-integrity.json) identify the tested source. No application/test source, schema file, runtime configuration, commit or push was changed/issued by this review.

## Historical defect status

| Finding | Independently observed current behavior | Status |
|---|---|---|
| M5D-R01 native expired worker after row wait | 500 ms lease, actual 900 ms held row after blocking barrier; rejects after 909.47 ms; zero decisions/observations, unchanged Processing ownership. Valid short contention succeeds. Final UPDATE wait also rolls provisional decision back. | CLOSED for reviewed source |
| M5D2-01 legacy expired nonterminal transition | Final conditional UPDATE returns 0 after 904.63 ms; explicit stale failure; complete before/after snapshots identical. Existing lease-row/reclaimed-fence/concurrent tests also pass. | CLOSED for reviewed source |
| M5D2-02 legacy zero-row release/version bump | DELETE returns 0 after 903.11 ms; explicit failure before version bump; original lease/state/version unchanged. Valid/duplicate/reclaimed-owner release and rollback tests pass. | CLOSED for reviewed source |

The two expected D.1 narrative reports are absent following the earlier user-requested documentation cleanup: docs/milestone-5d1-lease-fencing-remediation.md and docs/milestone-5d1-concurrency-regression-results.md. Their structured remediation evidence and original native defect evidence remain available. Missing contents were not invented or recreated. Current source inspection and fresh independent verification provide the review basis. Existing D.2/D.3 narratives and all prior structured/raw evidence were preserved.

## Transaction correctness and cross-path review

Native completion locks the job, evaluates current time in a new statement, validates owner/fence/Processing/immutable identity, then transactionally inserts observations/receipt claims/decision and completes the job. Decision INSERT and final UPDATE repeat current deadline/identity predicates with mandatory rowCount 1. A later evidence/decision lock wait cannot rely only on initial validation; the final UPDATE is independently tested after decision insertion. Rollback covers provisional evidence and status.

Legacy paths consistently lock job before matching lease and evaluate current time after obtaining both. Protected transition UPDATE includes source state/version, job fencing counter and an existing matching unexpired worker/fence lease. Owner release must delete exactly one matching active lease before bumping the job version in the same transaction. Renewal and attempt/failure postchecks retain current-clock validation and rollback. Authorized expired cleanup/reclamation has separate state/fence/version checks; it is not stale-worker authority. Concurrent claims/transitions/releases and actual process restart remained safe in fresh tests.

The guarantee is valid authority at the protected SQL mutation, not completion acknowledgement before deadline. Job locks prevent a conforming takeover through commit. A valid release consumes authority at its successful deletion; its following atomic version bump cannot be used by another claimant. No reviewed trigger performs an external blocking action after the last predicate. Privileged direct SQL, future trigger changes and wall-clock corrections are explicit operational assumptions. PostgreSQL is not an on-chain settlement authority.

Full row/statement flows and scope limits: [native verification](milestone-5d4-native-lease-verification.md), [legacy verification](milestone-5d4-legacy-lease-verification.md).

## Remaining findings and operational prerequisites

### M5D2-03 — LOW, existing RPC resource-limit hardening

- File/line: execution-service/src/reconciliation/rpc.ts:74.
- Expected: a resource-protection byte cap should bound reading/allocation, not only reject afterward.
- Observed: response.text() materializes the body before checking 4 MiB. Source inspection confirms the ordering; no OOM attack was executed.
- Evidence: reviewed source SHA in baseline inventory; original M5-D.2 report/evidence unchanged.
- Impact: a faulty/malicious configured RPC can exceed the intended memory bound. This grants no lease ownership, transfer or settlement authority.
- Recommendation: bounded streaming read/cancellation and deterministic oversized-response tests in M5-E, alongside bounded requests/retries/concurrency.
- M5-E entry: **does not block local hardening**; it is an explicit hardening objective. It remains relevant before operational deployment.

### M5D4-I01 — INFORMATIONAL, delayed claim return can already be expired

- File/line: execution-service/src/persistence/postgres-job-repository.ts:253–264.
- Expected: an expired returned lease must not authorize a subsequent write.
- Observed: a controlled 902.33 ms delay after a successful 500 ms lease INSERT returns expired ownership; its protected transition rejects.
- Evidence: acquisition-delayed-return-model in adversarial-results.json. This is a scheduling model, not a physical acquisition-lock race; the initial invalid lock fixture is documented separately.
- Impact: possible claim/renewal liveness overhead, no material lease-safety or payment violation demonstrated.
- Recommendation: callers must respect current ownership and handle stale results; consider lease budgets/latency visibility during operational hardening. Do not resubmit an external payment because a lease or response expired.
- M5-E entry: **does not block**.

Deployment prerequisites remain separate: actual Tidepool semantics, live recipient control/storage, signer custody and role separation, pinned deployment/migration plan, limits/monitoring/incident controls. Authenticated on-chain recovery remains blocked. Current local sandbox/token success cannot establish live compatibility or production readiness.

## Native payout compatibility

Reviewed Rust source and regenerated WASM match baseline. begin_native_preflight requires explicit Executor, independent Approver/reserver separation, immutable binding/current attempt and unexpired authorization; it consumes approval once. Storage callback rechecks dispatch policy and atomically records TransferPending before scheduling the exact bound NEP-141 transfer plus private callback. Callback authenticates self and current attempt/outcome; success checks reserved-to-spent arithmetic using current campaign state. Panic/OOG preserves the committed token receipt and unresolved reserve/TransferPending lock; unknown results remain locked/ManualReview. All eight legacy payout lifecycle guards remain.

Read-only reconciliation validates finalized receipt graphs and immutable identities through trusted configured RPC observations, not authenticated on-chain proofs. Its repository/worker has no signer, transaction broadcast, approval-consumption, payout release, automatic resend or on-chain settlement capability. Overlap tests prove the callback settles once while the observer only records evidence. No recovery function was introduced.

## Fresh validation and M5-E gate

All completed: **146 Rust tests, 134 service tests, 46 PostgreSQL tests, eight local RPC tests, 20 receipt groups**, plus six independent audit checks. Formatting, Clippy, typecheck, lint, locked WASM build and integrity checks pass. The first invalid extra acquisition fixture timed out; it is disclosed and is not counted as a completed successful run. The corrected full audit and complete sandbox wrapper both exited 0. [Exact regression evidence and count definitions](milestone-5d4-concurrency-and-regression-results.md).

Candidate SHA-256 `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9` matched the historical candidate identity; no mismatch accepted. Code hash `4mBF2J6mE22XrTrSNo8x7xSLhzUSfNS9HkzHJeaxqwk4`.

**M5-E entry gate: PASS.** Native and legacy persistence, the D.1 native fix, both D.3 legacy fixes, independent contention/rollback/fencing verification, and native payout compatibility have been reviewed. Local operational hardening may proceed under the existing M5-E local/read-only restrictions. Controlled Testnet deployment, live payout execution and production remain unapproved. Stop after this review; M5-E implementation was not begun.
