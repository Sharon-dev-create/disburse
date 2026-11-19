# M5-F.1B independent security review

**Verdict: FAIL.** F1B-M01 reproduces consumption of an expired durable execution authorization after PostgreSQL row-lock contention. One Medium and one Low finding remain open. No Critical or High finding was confirmed within reviewed coverage. This verdict does not assert a native-contract exploit or a Testnet transfer. The fresh sandbox/local-RPC receipt rerun is additionally infrastructure-blocked, so those checks are explicitly incomplete.

Review date: 2026-11-18. Scope: read-only application source inspection, synthetic dedicated-database tests, adversarial configuration probes, Rust/service checks, public read-only RPC, and review documentation. No application fix, Rust change, migration change or live operation was performed. This is a fresh adversarial verification pass in the same assistant conversation as implementation, not an assertion of organizational independence or a different human auditor.

## Source identity and external HEAD changes

Review began at `c1f01d701f2f8ece806d4a536e5f1c4f08851153` with existing implementation/documentation changes and untracked M5-F.1A evidence. The source hashes recorded by M5-F.1A match **all 110 files** checked. The new `source-identity.json` records 119 application/test/migration/build-manifest hashes, initial status/history, and exact binary working-tree/staged diff hashes. Initial working-tree diff SHA-256: `efaaaaee27f4df04e72372ad0096b5dec7e100911ddefcf28de2d81274f6e275`; staged diff was empty. There was no relevant untracked application implementation file omitted from that inventory; new review probes live under the evidence directory.

Git history shows `0ce7cee` → `c1f01d7` introduced the entrypoint/isolated validator and initial startup tests, plus in-progress logs. The initial review working tree added the missing-profile guard and its test. During review HEAD externally advanced to `b610cb44136f71923ef216ff082637c24c4d5389`, incorporating pending files. All 119 reviewed application hashes remain identical; see `source-identity-after-external-commit.json`. The initially captured diff is retained even though its changes are now committed externally. No Git write command was run by this reviewer.

Canonical application manifest SHA-256 (sorted compact JSON of source_sha256): `cca9bbbf83ee9d066511c5004864aebd69409e91742a967652dc1d8444b92e00`. Seventeen sandbox fixture/harness files independently match HEAD, recorded in `harness-identity.json`; tool configuration checks are in `tool-config-identity.json`. Current source was rechecked after the external commit. Historical logs alone are not an authenticated test-process attestation; matching source fingerprints plus fresh checks establish the current reviewed implementation without pretending HEAD alone captured the earlier working tree.

## Assessments

| Area | Conclusion | Basis |
|---|---|---|
| Configuration safety | PASS | Twenty existing startup tests, 45 additional negative cases, normalized identity checks, real CLI environment/file conflict test |
| Contract identity assessment | PASS, future deployment blocked | Bootstrap and every native-config use enforce the historical contract identity; new account requires reviewed identity change/build |
| PostgreSQL safety | FAIL | 46 baseline and 20 targeted tests pass, but actual repository expiry-lock probe violates authorization deadline |
| Legacy/native lease fencing | PASS within tested coverage | Row locking precedes fresh clock checks; final predicates/row counts and rollback protect writes |
| RPC evidence | PASS | Fresh pinned snapshots and explicit UNKNOWN_ACCOUNT/MethodNotFound interpretation; no cross-block atomic claims |
| Rust checks | PASS | fmt, Clippy, 146 tests and locked build; identical candidate hash |
| Contract and sandbox safety | PARTIAL | Static/unit review completed; 20 fresh receipt groups blocked by binary distribution failures |
| Execution-service safety | FAIL | All 206 tests pass, but the durable authorization finding remains; eight receipt-backed RPC tests not rerun |

## Configuration and service inspection

`execution-service/src/host.ts:6` is the package start entrypoint and calls the isolated validator before `runExecutionHost`, database pool creation or listener startup. Importing it for tests does not start the host. No alternate shipped CLI starts an isolated worker; exported server/composition helpers accept already-built configuration and are not independently exposed mutation entrypoints. The host contains no signer, execution worker or submission capability. The restricted pool sets PostgreSQL read-only at session startup; authenticated GET-route capability checks deny mutations and unknown routes. Current API/dependency readiness does not enable execution.

The isolated profile requires exact explicit true/false control values, zero submission cap, test database, loopback host, testnet and the pinned historical contract. Wrong/protected contracts, incomplete/malformed controls and missing RPC reject before initialization. Missing selector with isolated control fields present rejects; removing all profile indicators deliberately chooses preexisting generic mode, as documented. This is not a claim that every generic configuration is an isolated deployment. Identity/network required strings are deliberately trimmed and subsequently checked; whitespace around the correct identity cannot select a different account. Unknown casing/whitespace in exact profile/Boolean controls reject.

The 20 implementation tests call the real exported startup boundary with an injected host initializer and assert no initializer call on rejection. The additional probe covers missing/empty/case/whitespace fields, wrong networks/contracts, enabled workers/submission, missing RPC and database, invalid cap and real Node `--env-file` conflict behavior. The real CLI rejects an environment worker=true overriding file worker=false before any host startup, and diagnostics contain none of the synthetic password/URL/API canaries. Duplicate identical OS environment keys have no distinct application representation; effective Node environment/file precedence is the relevant conflict model. Probe evidence contains 45 negatives (correcting an early commentary count of 43).

RPC resource tests assert cancellation, response/decompressed-byte limits, nesting, malformed JSON classification, concurrency/queue limits, bounded retry/deadline behavior and incomplete graph containment. Operational regressions actually test reflected token-bearing URLs and causes, nested token arrays/objects exceeding configured limits, and valid metadata. Reconciliation source has no settlement/send interface; it persists evidence and retains unknown outcomes. SHA-256 authorization integrity is not a digital signature or proof of trusted human approval. Current host execution remains disabled.

## Contract review

`src/state/native.rs:11` pins CONTRACT. `initialize_native_execution` at `src/native.rs:18` requires owner, pause, exact current account, expected SHA-256 of legacy STATE, Borsh roundtrip and storage prefixes. `native_config` at line 416 rechecks identity/network label/token/version/caps. The network string is a policy binding; actual configured RPC network is separately checked by the service.

The unchanged candidate can be considered only for a separately reviewed upgrade of `disburse-test-contract.testnet`. Generic deployment of bytecode elsewhere does not make its native functionality usable: a new account fails native initialization. A new identity requires reviewed source/binding/migration changes and a new build. Neither option is approved by this review.

Owner-only paused role setup, explicit non-overlapping Approver/Executor roles, reservation-actor separation, immutable payout/auth/attempt bindings, idempotency and private self callbacks remain intact in reviewed source/unit assertions. Recipient approval hashes bind evidence but do not verify NEP-413 on-chain. Final storage callback rechecks role/expiry/pause/registration before dispatch. A dispatched completion may settle truthfully while paused. TransferPending/ManualReview outcomes retain reservations; success alone debits reserved and credits spent with checked arithmetic and invariant checks. Existing source blocks stale/duplicate callbacks and legacy/native mode confusion. Historical migration compatibility has unit/source and prior evidence support, but the fresh real-receipt migration rerun remains uncompleted.

## PostgreSQL review

The initial independent 46-test suite used a fresh verified `disburse_test` database/role at loopback port 19553. The interruption removed temporary infrastructure. A second fresh cluster at loopback port 19554 was identity-verified before migrations, probes or tests. Migration versions 0001–0004, SQL checksums, table/index inventory and repeat-no-op behavior are recorded in database/migration evidence. No unknown, development or production database was used.

Reviewed paths include immutable duplicate job/auth creation, conditional one-time consumption, refund immutability, atomic attempts, job/lease lock ordering, clock_timestamp after lock acquisition, fencing generation/owner/state/version predicates, affected-row release checks and rollback. Twenty additional selected lease/expiry/restart tests pass with real PostgreSQL blocking synchronization. Native reconciliation completion locks its job before final time checks and rolls back observations/claims on final fence failure. ManualReview decisions cannot release or settle contract reservations. Native reconciliation has no renewal API; its existing renewal test is explicitly a database fixture, not proof of a runtime renewal feature.

F1B-M01 is in a different durable authorization path: pre-wait time validation plus a statement-start deadline comparison can accept a transition after a lock wait passes expiry. The deterministic actual-repository probe confirms this despite passing baseline tests. The result is not classified as a lease regression or a demonstrated native on-chain authorization bypass. Full details, exact timestamps and minimal remediation are in the findings report.

## Test execution and infrastructure limitation

| Suite | Reported baseline | Fresh review result |
|---|---:|---|
| Rust | 146 | 146 passed; fmt/Clippy/build passed |
| Service | 206 | 206 passed; format/typecheck/lint passed |
| Additional startup probes | — | 45 negative cases plus normalization and real CLI conflict passed |
| PostgreSQL | 46 | 46 passed |
| Targeted concurrency repeat | — | 20 passed |
| Authorization expiry invariant | not covered | FAIL: consumption accepted after expiry; reproduction confirmed |
| Receipt-backed local RPC | 8 | NOT VERIFIED to completion: fresh sandbox results unavailable |
| Sandbox receipt groups | 20 | NOT VERIFIED to completion: fresh sandbox results unavailable |

Rust toolchain and commands are in `rust.log`: rustc 1.100.0 / cargo-near 0.23.0 were verified locally; fresh commands are `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked`, `cargo near build non-reproducible-wasm --locked`. Candidate `target/near/disburse_contract.wasm` is 410611 bytes, SHA-256 `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`, unchanged from M5-F.1A.

Service command: `pnpm check`. PostgreSQL commands: `pnpm db:migrate:test`, `pnpm test:postgres`, then Node `--test --test-name-pattern='legacy|expiry|fenc|lease|restart'` over jobs/native lease/native reconciliation tests. Reproduction probes are preserved under the review evidence directory; they are not application modifications.

Temporary cache/node files vanished across interruption before fresh receipt output was retained. Historical WASM was re-fetched by read-only view_code and hash-authenticated, and token/fault fixtures rebuilt in an isolated temporary source copy. However, the sandbox archive restoration repeatedly timed out or returned URLError while fetching required ranges. An alternate distribution hostname failed DNS resolution. Separate bounded range/resume/original-S3-host attempts are recorded; missing bytes prevent verifying the pinned archive/executable, so no partial binary was executed. These are artifact-download infrastructure errors, not evidence of an absent NEAR account or failed contract assertion. Prior 20-group and eight-RPC PASS reports were inspected but never counted as new review execution.

## Findings, next stage and authorization

Critical 0; High 0; Medium 1 (F1B-M01, open); Low 1 (F1B-L01, open); Informational 1 (F1B-I01, future identity blocker). No silent fix was applied. No clean independent validation of M5-F.1A can be issued while the Medium finding and receipt coverage gap remain.

Next: separately scoped local authorization-deadline remediation with deterministic post-lock regression coverage, correct the conditional preparation receivers, then re-review and complete the 20/eight receipt suites with available pinned sandbox infrastructure. Future account/role/key/funding/registration/upgrade/ownership/pause prerequisites are detailed in the readiness assessment. No accounts/keys, role grants, token transfers, public payouts, deployment, pause/unpause, production writes, Git commits or pushes were performed by this reviewer.

**INDEPENDENT VALIDATION: NOT PASSED. CONTROLLED TESTNET EXECUTION: NOT AUTHORIZED. PRODUCTION READINESS: NOT READY.**

Cleanup: the recreated owned PostgreSQL cluster on port 19554 was stopped successfully (database-cleanup.log). The earlier temporary environment vanished across interruption; its retained identity/test evidence is preserved without claiming a verified explicit shutdown of that lost environment. No fresh receipt run is counted as verified to completion without retained results.

Final observed HEAD advanced externally again to `b610cb44136f71923ef216ff082637c24c4d5389`; all 119 application hashes still match the reviewed/tested manifest. Final identity is recorded in source-identity-final.json. No reviewer Git writes or application modifications occurred.
