# Milestone 5-C — Independent security and correctness review

**BLOCKED — the requested M5-C implementation is absent.**

Revision `f37893e7a318e948e5e31b0634ee968247559c92`, clean `main...origin/main` at start; review date 2026-11-16 (Africa/Douala).

Both attached instructions have identical SHA256
`42eb3e1a0d014aee0c967cb78ce554c5b26d1e39c54cd0411dae56868736ec27`.
This is review only. No fixes, source/test changes, dependency installation,
signing, blockchain RPC queries, deployment, DB changes or fund movement occurred.
Local build artifacts and new review documentation/evidence were produced.
This is a fresh adversarial reinspection by the same assistant involved in B,
not a separately staffed third-party audit. Conclusions below depend on current
source/build/test evidence, not the earlier implementation's PASS assertion.

## Completeness and verdict rationale

Current `src/lib.rs`, `src/native.rs`, `src/state/native.rs`, native tests and
historical fixture match the recorded M5-B hashes. Fresh build yields the same
385351-byte WASM, SHA256
`ad51f8bc061138013ff33620d33adff8dffacb4eaf1c06b09853c79b92c58e94`.
Generated ABI has 49 contract methods, including 14 native foundation methods;
actual WASM exports corroborate their presence and missing transfer/callback API.
The prior 126 passing tests remain exactly **126 passed, 0 failed, 0 ignored**.
They establish B controls, not a newly implemented C execution path.

Actual lifecycle is Reserved→Approved→PreflightPending, with unused approval
revocation back to Reserved. At `src/native.rs:405`, the contract consumes consent
and writes its lock; line415 emits `native_preflight_locked`; the method ends.
There is no token/storage promise, transfer deposit, gas allocation, native
settlement callback, success/failure/release/retry implementation. TransferPending,
Succeeded, AttemptFailed, ManualReview and Released are enum variants only.

The attachments explicitly require BLOCKED if implementation is absent or
fundamentally incomplete. There is no demonstrated unauthorized transfer, double
payment or accounting invariant violation; therefore FAIL would overstate the
findings. Likewise, missing implementation is more fundamental than PARTIAL
validation of an existing executor. B's previous limited PASS is not contradicted.

## Verified existing controls

- Explicit native Approver/Executor, no implicit owner/Admin/Operator inheritance;
  no self-approval of original reservation, no same account holding both native
  roles, and live approver membership/expiry checks at B preflight.
- Immutable token/recipient/amount/network/campaign/payout binding, canonical digest,
  unique authorization IDs, monotonic checked attempt IDs and one consumed lock.
- Eight legacy payout mutation methods plus private release helper reject native
  marker **or** native record. Tests assert the actual guard reason, including
  privileged Verifier, paused/unpaused paths and missing/orphan metadata.
- Legacy `settle_payout` still trusts Verifier evidence, but begins with native-mode
  rejection. It is not a missing native callback or a valid native settlement path.
- Campaign cancellation changes lifecycle, not reserve/spent/token custody. It
  prevents new B initiation by Active-state checks, without freeing reservations.
- Checked reservation math and old fields are preserved. A local 100000 reservation
  leaves available900000/reserved100000/spent0; approval/revocation/preflight leave
  those amounts unchanged. No native reserved→spent transition exists to audit.

## Prioritized findings

| ID | Severity | Finding | Progression consequence |
| --- | --- | --- | --- |
| M5C-01 | HIGH | M5-C transfer, callback and settlement implementation is absent (src/native.rs:368) | Blocks closing C and advancing as though execution exists |
| M5C-02 | MEDIUM | Public preflight consumes approval into a lock with no continuation (src/native.rs:405) | Blocks closing C and advancing as though execution exists |
| M5C-03 | MEDIUM | No asynchronous receipt, callback-failure or gas validation exists (src/native/tests.rs:119) | Blocks closing C and advancing as though execution exists |
| M5C-04 | MEDIUM | Historical mock-state compatibility does not prove full WASM upgrade safety (src/native/tests.rs:714) | Mandatory later deployment/live gate |
| M5C-05 | INFORMATIONAL | Recipient approval is a governance attestation and token/root trust is unresolved (src/native.rs:119) | Mandatory later deployment/live gate |

The MEDIUM items distinguish known staged behavior and missing evidence from an
exploitable critical flaw. No CRITICAL exploit is asserted. Full reproduction,
impact, evidence and remediation for every finding follow.

### M5C-01 — M5-C transfer, callback and settlement implementation is absent

Severity: **HIGH**. Affected: `src/native.rs:368`; related: `src/native.rs:371`, `src/native.rs:405`, `src/state/native.rs:47`, `src/native/tests.rs:945`.

Current code is byte-identical to recorded M5-B. begin_native_preflight consumes consent and writes PreflightPending, but returns without any token/storage promise. No native dispatch, private callbacks, promise-result handling or reserved-to-spent completion exists. Enum variants alone do not implement transitions.

Reproduction:

1. Compare current source hashes to m5b-implementation-results.json: all native implementation/test files match.
2. Inspect src/native.rs:368-416 and search executable source for Promise construction, ft_transfer call, private callbacks and promise-result inspection. None exists.
3. Build candidate and inspect generated ABI and actual WASM exports: 14 native foundation methods; no transfer/callback/success method.
4. Run native::tests::independent_approval_preflight_consumption_and_no_accounting_or_promises: it passes by asserting zero receipts and spent0.

Impact: Native payouts cannot execute or settle. The M5-C security conclusion cannot be established; advancing as though C were complete would rely on nonexistent controls.

Evidence: `m5c-review/static-audit.json`, `m5c-review/tests.log`, `m5c-review/build.log`.

Recommended remediation: In a separately authorized local implementation stage, implement the approved storage-preflight→fixed ft_transfer→private callback graph, atomic locks, outcome handling and exactly-once settlement; then repeat adversarial review. Do not add a public manual-success override.

Blocks closing C: yes.

### M5C-02 — Public preflight consumes approval into a lock with no continuation

Severity: **MEDIUM**. Affected: `src/native.rs:405`; related: `src/native.rs:353`, `src/native/tests.rs:305`.

An authorized B preflight writes Consumed/PreflightPending with no promise and no public continuation, failure, release or retry path. This is intentional B staging, not a hidden token-transfer bug.

Reproduction:

1. Use local setup→create_native_payout→independent approve_native_execution→authorized begin_native_preflight.
2. Observe Consumed auth, native PreflightPending, legacy Reserved and reserved100000/spent0.
3. Try repeated preflight, new authorization and revocation: all reject; no receipt exists to finish execution. Existing test native::tests::duplicate_pending_attempts_unknown_payout_and_cross_payout_auth_reject covers these rejections.

Impact: If this foundation were deployed/used as an executor, the reservation would remain locked without delivery. This demonstrates missing liveness, not duplicate transfer or accounting corruption.

Evidence: `src/native.rs:368`, `src/native/tests.rs:119`, `src/native/tests.rs:305`, `m5c-review/tests.log`.

Recommended remediation: M5-C must join state consumption with storage-promise scheduling atomically. Keep uncertain attempts locked; do not solve liveness by enabling arbitrary reset/release or fake success.

Blocks closing C: yes.

### M5C-03 — No asynchronous receipt, callback-failure or gas validation exists

Severity: **MEDIUM**. Affected: `src/native/tests.rs:119`; related: `src/native/tests.rs:431`, `src/native/tests.rs:945`, `Cargo.toml:27`.

126 passing tests are direct Rust/SDK environment tests. There are no native callbacks, promise-result injection tests, sandbox harness, transfer receipts, callback OOG measurements or gas constants/guards. Future terminal phases are inserted directly into test storage, not reached via token execution.

Reproduction:

1. Inspect the tests and Cargo manifest; search for near-workspaces/sandbox/promise_result/PromiseResult/private callbacks/static gas.
2. Inspect native::tests::pending_manual_review_and_terminal_states_cannot_approve_revoke_or_restart: private test code seeds future states.
3. Inspect test-framework.json: no near-sandbox executable on PATH, no repository sandbox harness. No dependencies were installed or mocks substituted.

Impact: No evidence supports exactly-once delivery, callback authentication, failure atomicity, receipt interleaving, or sufficient nested gas budgets.

Evidence: `m5c-review/test-framework.json`, `m5c-review/static-audit.json`, `m5c-review/tests.log`.

Recommended remediation: After implementing C, add real local receipt execution with a conforming mock token and controlled failures, measure each receipt, and test successful transfer with callback panic/OOG and blocked resend. Distinguish mock-result unit tests from sandbox receipts.

Blocks closing C: yes.

### M5C-04 — Historical mock-state compatibility does not prove full WASM upgrade safety

Severity: **MEDIUM**. Affected: `src/native/tests.rs:714`; related: `src/native/tests.rs:817`, `tests/fixtures/m5b-deployed-state.json:1`.

Authentic fixture has zero payouts and is loaded into SDK mock storage. Nonempty settlement/failure/index state is locally generated with current legacy functions. No old-WASM→candidate-WASM sandbox upgrade, token custody migration or live migration was executed.

Reproduction:

1. Run authentic_deployed_bytes_deserialize_and_bootstrap_preserves_every_legacy_entry and inspect its explicit pause before byte-comparison baseline.
2. Inspect nonempty_legacy_payout_indexes_failure_settlement_and_resolution_survive_bootstrap: synthetic fixture strips new native namespaces, then bootstraps in Rust.
3. Verify no sandbox harness or live upgrade evidence exists in the current candidate.

Impact: Byte compatibility is supported, but protocol-level upgrade/receipt behavior and token preservation remain unproven. No demonstrated serialization corruption was found.

Evidence: `m5c-review/test-framework.json`, `m5c-review/tests.log`, `tests/fixtures/m5b-deployed-state.json`.

Recommended remediation: Keep M5-E as a mandatory deployment blocker: old/final candidate WASM, fresh authentic raw snapshot plus representative nonempty states, interrupted/unauthorized/repeated bootstrap, token custody and callback compatibility. Never assume older-WASM rollback is safe.

Blocks closing C: not independently; deployment/live gate remains.

### M5C-05 — Recipient approval is a governance attestation and token/root trust is unresolved

Severity: **INFORMATIONAL**. Affected: `src/native.rs:119`; related: `src/native.rs:535`, `src/state/native.rs:12`.

Recipient enrollment checks a 64-character digest and exclusions, not NEP413 control, account existence, token storage or balance. Token ID is fixed but its transfer implementation is not exercised. Role separation does not eliminate root/governance control.

Reproduction:

1. Read approve_native_recipient and its tests: local evidence hash is synthetic, no token call.
2. Inspect fixed token/domain and role setters: on-chain address separation exists, human independence is operational.

Impact: No actual controlled recipient or trustworthy live-delivery route is established. A future successful promise from a malicious/no-op token would not by itself prove economic delivery.

Evidence: `src/native.rs:119`, `src/native/tests.rs:533`, `src/state/native.rs:12`.

Recommended remediation: Before live gates, independently verify recipient control/key membership, storage and initial balance; review token code/governance/restrictions and root-key safeguards. Keep receipt/balance attribution independent. No changes authorized by this review.

Blocks closing C: not independently; deployment/live gate remains.

## Regression evidence and review boundaries

| Required command | Fresh result |
| --- | --- |
| `cargo fmt --all -- --check` | PASS, exit0 |
| `cargo clippy --locked --all-targets -- -D warnings` | PASS, exit0 |
| `cargo test --locked` | PASS, exit0;126 passed/0 failed/0 ignored;0 doc tests |
| `cargo near build non-reproducible-wasm --locked` | PASS, exit0; host build, not reproducible certification |
| `git diff --check` | PASS, exit0 |
| Initial status/diff | Clean main tracking origin/main; no uncommitted modifications |

[Baseline](evidence/milestone-5/m5c-review/baseline.json),
[command outcomes](evidence/milestone-5/m5c-review/regression-results.json),
[static/ABI/WASM audit](evidence/milestone-5/m5c-review/static-audit.json),
[test log](evidence/milestone-5/m5c-review/tests.log).
Source files, test files/fixtures, dependency inputs and pre-existing evidence are
hash-checked and unchanged. No fresh on-chain state assertion is made: this is a
local implementation review, and a Testnet read would not create missing C code.

## Required companion analyses

- [Promise and gas audit](milestone-5c-promise-and-gas-audit.md): actual methods,
  nonexistent promises/deposits/gas, required future atomicity.
- [Callback and recovery review](milestone-5c-callback-and-recovery-review.md):
  callback attack matrix, cases A–F, accounting and duplicate safety limits.
- [Migration compatibility](milestone-5c-migration-compatibility-review.md):
  authentic versus synthetic fixtures, no full WASM/live upgrade proof.
- [Asynchronous test matrix](milestone-5c-asynchronous-test-matrix.md): each required
  scenario, exact test/line/framework/result and absence of real receipts.
- [Structured review](evidence/milestone-5/m5c-independent-review.json).

## Smallest safe next milestone

A separately authorized **M5-C local implementation** must precede another C
security review. Implement the approved atomic storage preflight, immutable
1-yocto token transfer and private outcome callback; keep unresolved attempts
reserved and nonretryable. Add real sandbox receipt and gas/failure tests, including
successful transfer followed by callback panic/OOG. Then repeat this review on the
actual candidate. M5-D recovery and M5-E migration remain separate later stages.
Do not advance directly to recovery/service integration as if C were implemented.
No deployment approval is requested; no code fixes were made in this review.
