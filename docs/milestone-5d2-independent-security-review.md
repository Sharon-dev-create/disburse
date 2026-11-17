# M5-D.2 independent security re-review

**Overall verdict: FAIL.** The original native reconciliation lease defect M5D-R01 is independently confirmed fixed. The review also demonstrably violates the required unexpired-worker write invariant in two separate legacy job paths. Those MEDIUM findings prevent a clean all-path approval. No unresolved CRITICAL or HIGH implementation finding was identified. This verdict does not indicate that the native transfer contract failed its regression suite.

Reviewed 2026-11-17. Initial HEAD: `8b2c068bfb31eb47ec4ed61194a1a98c2ea5149a`, with a staged native repository fix and untracked D.1 tests/evidence. During review, HEAD advanced externally to `24193abb93bcf4ca293179c6e5952ab3b87bf275`. No Git write command was issued by this reviewer. The relevant source and WASM hashes remained identical to the initial reviewed working tree; that later revision incorporates the D.1 fix/tests and some interim audit evidence. [Baseline](evidence/milestone-5/m5d2/baseline.json) and [integrity check](evidence/milestone-5/m5d2/final-integrity.json) preserve the distinction. This is a separate adversarial pass by the same assistant, not a third-party audit.

Candidate WASM SHA-256: `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`; NEAR code hash: `4mBF2J6mE22XrTrSNo8x7xSLhzUSfNS9HkzHJeaxqwk4`. Locked rebuild matched. The native repository SHA-256 is `7e0ac2351e01b362eb9d8e01c94dad7a071ed726d415b758186c838f6b191ced`.

## M5D-R01 closure: original native row-lock race fixed

The pristine baseline accepted a 500 ms lease after a measured 924.34 ms contended completion and committed one decision. Current source rejected after 919.17 ms and retained no partial evidence/decision/claim or status update. A further wait at the final UPDATE, after the decision INSERT, affected zero rows and rolled back the decision. The fresh PostgreSQL tests include a later receipt-claim lock wait that rolls back provisional observations. [Detailed SQL, timings, A–H tests and write-path classifications](milestone-5d2-lease-fencing-verification.md).

Row ownership is retained through commit; clock_timestamp predicates and affected-row checks enforce the last write boundary. Commit acknowledgement can arrive after expiry. No takeover/double payment is inferred from expiry alone. Native observations remain off-chain evidence and cannot authorize settlement.

## M5D2-01 — Legacy nonterminal transition can persist after lease expiry

- Severity: **MEDIUM**, confirmed; implementation vulnerability.
- Location: `execution-service/src/persistence/postgres-job-repository.ts:333` (`transition`), helper `updateJobState` at line 1046.
- Root cause: ownership is checked before the update, but nonterminal transitions have no final expiry predicate/check. Only the Queued/Completed/Abandoned branch calls deleteCurrentLease afterward. Job version checking preserves generations but does not enforce a current deadline after a later lock wait.
- Reproduction: [script](evidence/milestone-5/m5d2/legacy-transition-reproduction.mjs), [result](evidence/milestone-5/m5d2/legacy-transition-reproduction.json). Actual repository call obtains a 500 ms lease. A test client wrapper acquires SHARE on execution_jobs immediately before forwarding the unchanged UPDATE. It proves actual blocking using pg_blocking_pids, waits 900 ms, then releases. The repository accepts and commits Preparing/version 3 after a measured 907.29 ms wait. Lease expiry was `2026-11-17T06:45:03.813Z`; observed DB time after update was `06:45:04.227Z`.
- Impact: expired worker can advance a legacy execution job; the all-write-path lease invariant fails. The job row remains locked, so this does not prove overwrite of a newer claimant. No token send or on-chain double settlement occurred. A database SHARE lock is an audit stress fixture; production DDL/table-lock activity can cause comparable waits, but no unprivileged remote trigger was demonstrated.
- Recommended remediation: separately approve a narrow change that enforces current owner/fence/version/state/expiry at the last mutation boundary for every leased transition, checks affected rows and rolls back all provisional work. Add deterministic post-validation contention tests. Do not authorize live execution based on earlier tests alone.
- Progression: blocks approval to enable affected execution paths; repair and re-review locally. Does not require changing the already-fixed native reconciliation method.

## M5D2-02 — Legacy lease release ignores a failed conditional DELETE

- Severity: **MEDIUM**, confirmed; implementation vulnerability.
- Location: `execution-service/src/persistence/postgres-job-repository.ts:422` through 429.
- Root cause: releaseLease ignores DELETE rowCount and unconditionally bumps the job version. Expiry after initial validation can make DELETE affect zero rows, yet release reports success and leaves the expired lease present.
- Reproduction: [script](evidence/milestone-5/m5d2/legacy-related-reproduction.mjs), invoked with `release`; [precise row-count evidence](evidence/milestone-5/m5d2/legacy-release-rowcount.json). The unchanged DELETE waits on a SHARE lock on job_leases across a 500 ms lease. After 909.79 ms it returns rowCount 0; the method accepts, returns Leased/version 3 with the expired lease still attached, and commits that job version. Earlier release results are retained; the corrected repeat explicitly asserts the claimed job matches the prepared target.
- Impact: misleading successful release and mutation by an expired lease holder. This can disrupt recovery/worker coordination; no new owner was overwritten and no on-chain transfer was scheduled in this test.
- Recommended remediation: verify conditional DELETE affects exactly one row; enforce the same final ownership/deadline invariant transactionally for the associated version update. Regression-test rollback and the returned release state under contention. Review statement_timestamp use for waits; do not merely add an application clock check.
- Progression: blocks enabling the affected worker path until independently re-reviewed. No fix was implemented.

## M5D2-03 — RPC response limit applies after materializing the body

- Severity: **LOW**, source-confirmed hardening limitation.
- Location: `execution-service/src/reconciliation/rpc.ts:74`.
- Root cause: response.text() allocates the complete body before the 4 MiB test.
- Evidence: source inspection; no OOM/load attack was executed. The timeout bounds duration, not a hard maximum allocation from a fast configured endpoint.
- Impact: faulty/malicious RPC endpoint can consume more memory than the advertised evidence bound. It does not grant settlement authority.
- Recommendation: separately approve streaming byte caps with cancellation and resource-bound tests, before an exposed/long-running observer rollout.
- Progression: hardening prerequisite for operational deployment; does not reopen M5D-R01.

## Deployment prerequisites, not newly demonstrated high-severity bugs

Interactive mutations lack user identity/authorization workflows and server mutation routes; current demo authentication is intentionally local/read-only. Native receipt history is not exposed by the running API/dashboard. Real Tidepool semantics and a controlled live recipient remain unverified. Authenticated recovery is deliberately absent. These are readiness blockers, not claims of a current live exploit. [Full readiness matrix](milestone-5d2-testnet-readiness.md).

## Native payout safety and regressions

Source hash comparison confirms no Rust change from the reviewed baseline. `src/native/execution.rs:19` binds the approved attempt to the explicit Executor, independent Approver and immutable reservation binding before consuming approval. The storage callback rechecks recipient evidence, roles, pause/lifecycle, token and expiry before atomically writing TransferPending and scheduling one exact ft_transfer with 1 yoctoNEAR. Private callbacks authenticate self, validate attempt/outcome identity and reject stale/duplicate calls. Success uses current campaign accounting, checked subtraction/addition and reserved+spent <= funded <= budget. Callback panic/OOG rolls back callback accounting while preserving the prior token receipt and TransferPending lock. ManualReview/AttemptFailed cannot authorize a resend or release. All eight legacy payout lifecycle guards remain; native payouts cannot use legacy settlement/release APIs.

The reconciliation transport allows only status, tx_status, block, receipt retrieval and pinned known views. Its worker collects two configured sources, validates receipt/action/dependency/code/binding/accounting evidence, then writes local observations. It has no signer, broadcast, duplicate transfer, approval-consumption, reservation-release or on-chain settlement API. RPC observations remain a trust assumption; local aliases do not establish independent operators. PostgreSQL owner privileges can bypass immutability triggers and are not a chain trust anchor.

Fresh results: 146 Rust tests, 134 service tests, 32 PostgreSQL tests, eight local live-RPC reconciliation tests and the complete asynchronous/migration wrapper passed. [Regression details and exact scenario counting](milestone-5d2-regression-results.md). Passing existing tests did not catch the new legacy findings; independent audit reproductions establish those failures separately.

No application source was changed, no live database was written, no public transaction signed/submitted, no deployment occurred and no production worker was started. Only synthetic local sandbox signatures/transfers and dedicated test-database writes occurred. Historical bytecode retrieval was read-only. Previous reports/evidence were preserved.

Stop here. Recommended next implementation milestone: separately authorized local remediation of M5D2-01/02, with adversarial all-path lease tests and another review. Keep the application read-only; controlled Testnet execution and deployment require separate recipient/token/role/configuration/monitoring gates.
