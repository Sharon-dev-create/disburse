# M5-C — Asynchronous test coverage matrix

**No real asynchronous NEAR receipt was executed by the current tests.**
Revision `f37893e7a318e948e5e31b0634ee968247559c92`, 2026-11-16.
Fresh suite: **126 passed, 0 failed, 0 ignored, 0 measured; 0 doc tests**.
This is unchanged M5-B coverage, not a successful M5-C implementation audit.

## Framework distinctions

- Rust type/serialization tests exercise encoding and value checks directly.
- Native foundation tests use NEAR SDK `VMContextBuilder`/`testing_env` and direct
  Rust calls, including mock storage and context changes. No transaction executes.
- There are **no native mocked PromiseResult callback tests** to classify as even
  simulated callback execution; no handler exists.
- There is no repository sandbox/near-workspaces receipt harness or near-sandbox
  executable on PATH. No dependencies were installed and no sandbox was started.
- There is no real Testnet payout receipt test or newly submitted transaction.

A zero-receipt assertion establishes that B scheduled nothing; it does not prove
one successful transfer or sufficient callback gas. Test-only insertion of future
states does not demonstrate their reachability or safe asynchronous transitions.
[Framework evidence](evidence/milestone-5/m5c-review/test-framework.json),
[fresh suite output](evidence/milestone-5/m5c-review/tests.log).

## Required scenario matrix

In every row, **real receipt = no**. Listed test names are existing tests rerun in
this review; NOT_IMPLEMENTED rows may list related B tests only to explain why
they are insufficient. Names are fully qualified in the structured matrix.

| Scenario | Status | Existing test / file:line | Result / what it proves and does not prove |
| --- | --- | --- | --- |
| Successful NEP-141 transfer | NOT_IMPLEMENTED | None; no relevant implemented endpoint/test | No transfer/callback exists; no delivery or once-only settlement proven. Real receipt: **no**. |
| Token transfer failure | NOT_IMPLEMENTED | None; no relevant implemented endpoint/test | Legacy failure attestation tests are not native token-failure receipts. Real receipt: **no**. |
| Missing recipient storage | NOT_IMPLEMENTED | `recipient_allowlist_exclusions_and_evidence_immutability` (`src/native/tests.rs:533`), PASS — SDK mock/direct Rust calls | This test validates allowlist/exclusions/hash only; no storage_balance_of or token failure. Real receipt: **no**. |
| Duplicate execution request | PARTIAL_MOCK | `duplicate_pending_attempts_unknown_payout_and_cross_payout_auth_reject` (`src/native/tests.rs:305`), PASS — SDK mock/direct Rust calls<br>`identical_approval_is_idempotent_conflicting_approval_is_rejected` (`src/native/tests.rs:282`), PASS — SDK mock/direct Rust calls | Proves a B preflight lock/approval cannot be repeated, not one-transfer scheduling under concurrent receipts. Real receipt: **no**. |
| Duplicate callback | NOT_IMPLEMENTED | None; no relevant implemented endpoint/test | No callback; no callback duplicate accounting test. Real receipt: **no**. |
| Stale attempt callback | NOT_IMPLEMENTED | `explicit_native_binding_and_attempt_records_reject_corruption` (`src/native/tests.rs:1001`), PASS — SDK mock/direct Rust calls | Existing tests reject wrong attempt metadata/preflight identity, not stale callback execution. Real receipt: **no**. |
| External/Operator/owner callback invocation | NOT_IMPLEMENTED | `unauthorized_owner_admin_operator_and_self_approval_are_denied` (`src/native/tests.rs:157`), PASS — SDK mock/direct Rust calls | Existing test covers approval authority only. No private callback or wrapper authentication exercised. Real receipt: **no**. |
| Callback panic after committed token transfer | NOT_IMPLEMENTED | None; no relevant implemented endpoint/test | No callback or real token receipt; token-success/callback-failure split untested. Real receipt: **no**. |
| Callback gas exhaustion | NOT_IMPLEMENTED | None; no relevant implemented endpoint/test | No allocated callback gas, measured gas or real OOG receipt. Real receipt: **no**. |
| RPC timeout | NOT_TESTED_NATIVE | `pending_manual_review_and_terminal_states_cannot_approve_revoke_or_restart` (`src/native/tests.rs:431`), PASS — SDK mock/direct Rust calls | Test directly seeds future states; it never simulates RPC uncertainty or receipt discovery. Real receipt: **no**. |
| Service restart | NOT_TESTED_NATIVE | None; no relevant implemented endpoint/test | No native worker/reconciliation test; DB is not used or changed during review. Real receipt: **no**. |
| Pause mid-execution | PARTIAL_MOCK | `pause_campaign_cancel_and_token_removal_cannot_free_native_reservation` (`src/native/tests.rs:508`), PASS — SDK mock/direct Rust calls | Proves pause/cancel/delist blocks B preflight and keeps reserve, not callback completion during interleaving. Real receipt: **no**. |
| Concurrent payouts / multiple campaigns | PARTIAL_MOCK | `two_campaigns_share_token_but_not_reservation_or_authorization` (`src/native/tests.rs:968`), PASS — SDK mock/direct Rust calls<br>`accounting_boundary_overflow_counter_overflow_and_multiple_payouts` (`src/native/tests.rs:462`), PASS — SDK mock/direct Rust calls | Sequential direct calls and invariants only; no concurrent asynchronous receipts. Real receipt: **no**. |
| Arithmetic boundaries | PASS_UNIT | `accounting_boundary_overflow_counter_overflow_and_multiple_payouts` (`src/native/tests.rs:462`), PASS — SDK mock/direct Rust calls | Cap/u128 corrupted accounting/u64 attempt overflow cases reject without storage changes. No callback arithmetic exists. Real receipt: **no**. |
| Migration with existing payouts | PASS_SYNTHETIC_ONLY | `nonempty_legacy_payout_indexes_failure_settlement_and_resolution_survive_bootstrap` (`src/native/tests.rs:817`), PASS — SDK mock/direct Rust calls | Synthetic nonempty old-layout state preserved in mock environment; no actual nonempty historical chain/WASM migration. Real receipt: **no**. |
| Authentic historical state preservation | PASS_HISTORICAL_MOCK | `authentic_deployed_bytes_deserialize_and_bootstrap_preserves_every_legacy_entry` (`src/native/tests.rs:714`), PASS — SDK mock/direct Rust calls<br>`bootstrap_rejects_unauthorized_repeat_incompatible_hash_and_bounds` (`src/native/tests.rs:743`), PASS — SDK mock/direct Rust calls<br>`bootstrap_rejects_malformed_state_unpaused_and_wrong_deployment_identity` (`src/native/tests.rs:769`), PASS — SDK mock/direct Rust calls<br>`bootstrap_rejects_structurally_valid_but_changed_legacy_prefixes` (`src/native/tests.rs:1059`), PASS — SDK mock/direct Rust calls<br>`storage_prefixes_are_unique_and_legacy_borsh_layout_is_unchanged` (`src/native/tests.rs:908`), PASS — SDK mock/direct Rust calls | Actual old raw bytes, zero payouts, preserved around paused bootstrap. Mock storage only. Real receipt: **no**. |
| Legacy bypass rejection | PASS_UNIT | `all_legacy_native_mutation_bypasses_are_rejected` (`src/native/tests.rs:569`), PASS — SDK mock/direct Rust calls | Exact native guard rejection across eight methods, paused and unpaused; does not test callbacks. Real receipt: **no**. |
| Immutable authorization / expiry / revocation | PASS_UNIT | `immutable_recipient_amount_network_token_decimals_and_campaign_are_validated` (`src/native/tests.rs:334`), PASS — SDK mock/direct Rust calls<br>`expiry_and_invalid_ttl_reject_without_consumption` (`src/native/tests.rs:214`), PASS — SDK mock/direct Rust calls<br>`revocation_is_safe_and_new_approval_has_fresh_identity` (`src/native/tests.rs:228`), PASS — SDK mock/direct Rust calls<br>`role_revocation_blocks_approved_attempt_and_owner_can_revoke_while_paused` (`src/native/tests.rs:263`), PASS — SDK mock/direct Rust calls | B control checks valid; role metadata direct-calls, no asynchronous token action. Real receipt: **no**. |

## Important false-positive traps

`json_binding_schema_uses_decimal_strings_and_no_transfer_or_success_abi` at945
checks serialization and source substrings, not a complete protocol or ABI attack.
This review separately inspected fresh generated ABI and actual WASM exports.
`pending_manual_review_and_terminal_states_cannot_approve_revoke_or_restart` at431
writes future states through private test access; there is no token or callback
that produced those states. Its successful result cannot be counted as native
success/failure/ManualReview execution. Legacy settlement/failure tests likewise
exercise privileged attestations, not committed native token movement.

## Additional required local validation after implementation

1. Real conforming mock-token transfer and storage registration receipts, with
   exact immutable target/recipient/amount and1-yocto action inspection.
2. Real success/failure callback outcomes; private wrapper rejection for external,
   owner and Operator calls; wrong result count/binding and stale/duplicate calls.
3. Successful token receipt followed by callback panic/OOG/decoder failure; prove
   recipient delivery remains while reserved lock blocks any second transfer.
4. Concurrent/sequenced incoming calls between receipts, same campaign and shared
   token across campaigns; current accounting reload and exactly-once settlement.
5. Insufficient prepaid/nested callback gas, bounded state writes and margin.
6. RPC timeout and restart observation that re-reads durable attempts without
   treating absent local acknowledgement as definitive token failure.
7. Real old-WASM→final candidate sandbox migration with custody and pending states;
   preserve evidence/replay indexes and reject unsafe rollback assumptions.

Unit tests should supplement these tests, not replace them. Do not manufacture
callback mocks or relax acceptance merely to produce PASS. The smallest next
step is separately authorized C local implementation, then receipt tests and a
new adversarial review. This review did not add tests or application code.
