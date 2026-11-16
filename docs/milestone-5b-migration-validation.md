# Milestone 5-B — Local storage and migration validation

**PASS for local byte compatibility; no live upgrade compatibility claim.**
Date: 2026-11-16 (Africa/Douala). Baseline main:
`5e48e47d30032578486bbce5f111fbb7103e7164`, initially clean.
[Implementation](milestone-5b-native-execution-state.md),
[security review](milestone-5b-authorization-security.md),
[structured results](evidence/milestone-5/m5b-implementation-results.json).

## Layout decision and bootstrap

No existing serialized field was added, removed, reordered or retyped.
`Disburse` remains owner_id, paused, next_campaign_id, campaigns, roles,
accepted_tokens, next_payout_id, payouts, payout_idempotency. Legacy Campaign,
Payout, nested types, roles/status enums and all collection/evidence prefixes are
unchanged. New state lives only in seven versioned namespaces documented in the
state report. `new()` is unchanged; no `#[init(ignore_state)]` replacement or owner
reset path exists. No top-level migration is needed.

`initialize_native_execution` is a one-time sidecar bootstrap, not a legacy data
rewrite. It requires owner predecessor, global pause, exact isolated account,
absent sentinel, canonical old-state deserialization equal to current state,
expected SHA256 of stored STATE, **known SDK-serialized collection handles**, bounded
positive cap/TTL and the existing Tidepool allowlist entry. Only the configuration
key is written. The SDK wrapper may serialize legacy STATE normally, producing
identical bytes. Permission and recipient maps remain empty until separate calls.
Repeated initialization, unauthorized caller, wrong deployment identity, malformed
or mismatched hash/STATE, changed collection prefixes and invalid policy reject.
Owner cannot change ownership, counters, campaign balances or historical evidence
through this method.

The historical fixture starts unpaused. Tests explicitly pause and persist it
**before** capturing the pre-bootstrap baseline. Bootstrap itself preserves that
paused STATE and every other legacy entry. It does not silently claim the prior
pause was a byte-preserving action. No pause or bootstrap was performed on-chain.

## Authentic historical bytes

`tests/fixtures/m5b-deployed-state.json` copies the public raw key/value entries from
`docs/evidence/milestone-5/finalized-preflight.json`, without modifying M5-A evidence.
Provenance: finalized Testnet block277843166,
`5ccVg6DsrNnk4VXWtKGRp8Z4QEjMvsu7HFSt7V526TNG`, observed 2026-11-15.
Old code hash: `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`.

This authentic fixture contains four entries: 137-byte STATE; 184-byte Campaign0;
Tidepool allowlist membership; explicit Operator membership. Owner is
`disburse-topg.testnet`; next campaign ID1, next payout ID0; campaign Active,
budget/funded/available1000000, reserved/spent0. There is no authentic nonempty
payout history in this snapshot. It is historical evidence, not a fresh current
Testnet assertion.

Tests deserialize with an independently declared legacy `HistoricalState` field
layout and the new unchanged `Disburse`; round-trip actual bytes exactly; verify
owner, Operator role, accepted token, counters, campaign and accounting. After
paused bootstrap they compare every old raw key/value and require exactly one
new key. Normal `env::state_read::<Disburse>()` still succeeds. No receipt is
scheduled. This is more than serialization of newly invented empty state.

## Representative nonempty legacy state

A separate synthetic, source-derived fixture exercises unchanged legacy methods:
reserve/start/pending/Verifier-settle one payout, then reserve/start/fail/Verifier-
release another. It retains settlement evidence, failure evidence, resolution
history, lifecycle reasons, execution-reference indexes, global settlement/recovery
replay indexes, payout idempotency, roles and campaign accounting. It strips only
new native namespaces to represent pre-native storage, deserializes the legacy
STATE, bootstraps the new config, and requires **every** prior raw key/value to
remain equal. Views still show Succeeded and ReservationReleased with evidence,
spent10000, correct counters and index lookups.

This nonempty fixture is generated locally through legacy code whose baseline
regressions still pass; it is **not** represented as an actual on-chain payout
snapshot or an old-WASM sandbox execution. The two kinds of evidence are kept
explicitly distinct. Authentic nonempty deployed history does not exist in the
available snapshot, so that stronger claim is not made.

## Negative and collision tests

- Unauthorized, unpaused, wrong-account and repeated bootstrap.
- Missing/invalid expected hash, hash mismatch, malformed/trailing STATE bytes.
- Structurally valid STATE with changed campaign collection prefix.
- Zero/out-of-bound caps and TTLs; unknown/corrupt new config.
- New/legacy namespace uniqueness, including no prefix-of-prefix overlap.
- Orphan native mode/record, preoccupied next payout ID, stale authorization or
  attempt, altered binding and campaign identity.
- Rejected operations preserve all stored bytes, emit no new events and schedule
  no receipts; bootstrap does not reset owner/accounting or discard records.

The contract cannot enumerate arbitrary storage prefixes on-chain. A one-time
sentinel and known-prefix checks do not prove that a future deployment snapshot
contains no unknown orphan keys; future full raw-state inspection remains mandatory.
B does not migrate unknown schemas or repair corrupted legacy state.

## Commands and outcomes

| Command | Outcome |
| --- | --- |
| `git status --short --branch` | Initially clean `main...origin/main` |
| `git log -1 --oneline` | `5e48e47 configurations` |
| Baseline `cargo test --locked` | 98 passed, 0 failed |
| `cargo fmt --all -- --check` | PASS |
| `cargo clippy --locked --all-targets -- -D warnings` | PASS |
| Final `cargo test --locked` | 126 passed, 0 failed: 98 baseline + 28 new; 0 doc tests |
| `cargo near build` | Bare selector fails in non-TTY: “The input device is not a TTY” |
| `cargo near build non-reproducible-wasm --locked` | PASS, host WASM with embedded ABI, no dependency/configuration changes |
| `git diff --check` | PASS |

The explicit build subcommand is the installed cargo-near CLI's documented local
build option; no dependencies were installed and no manifest/lockfile workaround
was used. Final artifact hash/size and native/nonpayable/legacy-ABI comparisons
are recorded in the results JSON. Generated `target/near` files are ignored local
build outputs. They now contain the B candidate, **not the old deployed WASM**;
M5-A's saved old hash/ABI and public evidence remain untouched. No candidate was
deployed or signed. Host build is not reproducible-build certification.

## Changed-file inventory

| File | Purpose |
| --- | --- |
| `src/lib.rs` | Shared existing reservation helper; mode-aware idempotency and eight legacy mutation guards plus private release guard; unchanged STATE fields |
| `src/state/mod.rs` | Register native sidecar types |
| `src/state/native.rs` | V1 configuration/binding/role/recipient/payout/authorization/attempt schemas and bounded constants |
| `src/native.rs` | Bootstrap, explicit permissions/recipient approval, strict reservation, independent approval/revocation/preflight lock, views and invariant/event helpers |
| `src/native/tests.rs` | 28 new adversarial/compatibility tests and local helpers |
| `tests/fixtures/m5b-deployed-state.json` | Authentic historical public raw STATE/collection entries with provenance |
| `docs/milestone-5b-native-execution-state.md` | Methods, implemented/deferred transition table and accounting |
| `docs/milestone-5b-authorization-security.md` | Authority, binding, replay, legacy guards and residual risks |
| `docs/milestone-5b-migration-validation.md` | This preservation/validation report and file inventory |
| `docs/evidence/milestone-5/m5b-implementation-results.json` | Structured acceptance results, hashes, ABI checks, tests and remaining gates |
| `docs/evidence/milestone-5/m5b/baseline-tests.log` | Recorded 98-test baseline |
| `docs/evidence/milestone-5/m5b/implementation-tests.log` | Final 126-test results |
| `docs/evidence/milestone-5/m5b/fmt.log` | Final format command output (empty on success) |
| `docs/evidence/milestone-5/m5b/clippy.log` | Final warnings-denied static checks |
| `docs/evidence/milestone-5/m5b/build-command.log` | Exact bare build command's TTY limitation |
| `docs/evidence/milestone-5/m5b/build.log` | Successful explicit local build |
| `docs/evidence/milestone-5/m5b/candidate-abi.json` | Frozen candidate ABI, including unchanged 35 legacy function entries and 14 native entries |
| `docs/evidence/milestone-5/m5b/first-compile.log` | Retained initial module-resolution/visibility errors, resolved before final validation; not final failures |

M5-A documents/evidence, old Rust tests, legacy state type files, dependency files,
TypeScript, frontend, DB and environment configuration are unchanged. Initial tree
was clean, so no pre-existing uncommitted edits needed merging. No commit/push.

## Remaining migration and M5-C gates

M5-E must load the final candidate and old WASM in a real sandbox with full fresh
state, nonempty representative records, all replay indexes, interrupted bootstrap
and async attempt fixtures; compare custody separately at the token contract.
Mocked Rust storage tests do not prove protocol gas, real callback ordering, token
restrictions or external token balances. Local fixture storage is not token custody.

Do not redeploy old WASM to “roll back” native state: old code can ignore sidecars
and bypass native locks even if STATE still deserializes. No state snapshot restore
can undo a committed external transfer. Prefer frozen initiation and compatible
forward fixes. Upgrade, role/recipient changes, reservation, approval and execution
all remain separately gated future actions.

M5-C local approval authorizes only promise/callback implementation and tests. It
must atomically join the B approval-consumption lock to storage preflight, keep
TransferPending inseparable from scheduling the exact fixed-token transfer, make
callbacks private and identity-bound, measure gas/storage and prove that delivered
funds cannot be resent after a failed callback. No public fake success/release
shortcut is acceptable. M5-D recovery remains separate. Recipient is still
**RECIPIENT_UNVERIFIED**; no real roles, wallets or grants were created.
