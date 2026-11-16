# Milestone 5-B — Native authorization and state foundation

**PASS for local M5-B scope; not a deployment or transfer approval.**
Inspection/implementation: 2026-11-16, Africa/Douala.
Baseline: main at `5e48e47d30032578486bbce5f111fbb7103e7164`
(`5e48e47 configurations`), clean working tree. Baseline `cargo test --locked`:
98 passed. The M5-A design and evidence were read and retained unchanged.

## Scope and design reconciliation

Implemented versioned sidecars, explicit independent permissions, strict native
reservation, immutable approval binding, replay protection, revocation and a
preflight lock. No promise, token call, storage-registration query, callback,
native success/failure/release/retry entry point or generic rescue function exists.

M5-A distinguishes the old contract's reservation/attestation behavior from future
native behavior; the source matches that baseline. No pre-existing architecture
conflict was found. Phase-specific decisions are explicit:

- M5-A's future `execute_native_payout` is **not exported** in B. The B-only
  `begin_native_preflight` consumes approval and locks metadata, emitting
  `native_preflight_locked`. It schedules nothing and does not claim submission.
  M5-C must integrate this transition with atomic storage-promise scheduling before
  any deployment; it must not expose a second independently retryable token send.
- Native sidecar `AttemptFailed` follows M5-A's name; it corresponds to the B
  prompt's proposed DefinitiveFailure. It is represented but unreachable publicly.
- B explicitly requires rejecting repeated migration/bootstrap; initialization
  rejects repeats rather than interpreting M5-A's term “idempotent bootstrap” as
  permission to reinitialize or overwrite configuration.
- Concrete local safety ceilings are at most 100000 atomic units per native payout
  and at most one hour approval TTL. Bootstrap selects positive values within
  those ceilings. These are reviewed-in-code local bounds, not selected live
  operational parameters or grants. Lower policy values can be tested without
  changing the schema. Any later ceiling increase needs security review.

## Components and storage

`src/native.rs` contains entry points, invariant validation, prefix helpers and
events. `src/state/native.rs` defines V1 configuration, mode, recipient approval,
immutable binding, payout, authorization, attempt and role types.
`src/lib.rs` extracts existing reservation logic into a private common method and
adds mode guards; its top-level serialized fields are unchanged. Legacy Campaign,
Payout, amount, destination, role and status serialization are untouched.

Seven distinct storage namespaces, none equal to or a prefix of an old namespace:

| Key/prefix | Meaning |
| --- | --- |
| `native-config-v1` | One raw configuration/sentinel key |
| `native-payout-mode-v1` | Immutable payout mode; missing means legacy only if native record also absent |
| `native-payout-records-v1` | Native binding, lifecycle, monotonic next attempt and current identities |
| `native-authorization-records-v1` | Globally unique authorization ID → immutable bound approval and status |
| `native-attempt-records-v1` | `(payout_id, attempt_id)` → historical attempt metadata |
| `native-role-assignments-v1` | Explicit Approver/Executor membership |
| `native-recipient-approvals-v1` | Owner-reviewed controlled-recipient evidence hash |

No top-level migration is required. Sidecar bootstrap is owner-only, paused,
exact-isolated-account scoped, one-time and bound to the SHA256 of the stored legacy
STATE bytes. It parses those bytes and checks their canonical encoding against
current state before writing only the new configuration key. New permissions
start empty. See [migration validation](milestone-5b-migration-validation.md).

## Public interface

All new mutation methods are nonpayable. No mutation is invoked against Testnet.

| Method | Preconditions and effect |
| --- | --- |
| `initialize_native_execution(expected_legacy_state_hash: String, max_payout_amount: U128, max_authorization_ttl_ns: U64)` | Owner, paused, exact isolated account, absent sentinel, valid matching historical state/hash, bounded positive policy, allowlisted Tidepool token; writes config only |
| `set_native_role(account_id: AccountId, role: NativeRole, enabled: bool)` | Owner, initialized and paused; explicit grants only, root/contract excluded, cannot hold both native roles; no auto inheritance |
| `approve_native_recipient(recipient_id: AccountId, evidence_hash: String)` | Owner, initialized and paused; immutable lowercase SHA256 evidence reference; excludes contract/owner/Operator; no proof of control or storage query performed here |
| `create_native_payout(campaign_id: u64, idempotency_key: String, recipient_id: AccountId, amount: U128) -> u64` | Operator/Admin, unpaused, Active campaign for new request, approved recipient, Tidepool token/6 decimals, fixed near:testnet, positive bounded amount within available; reserves only |
| `approve_native_execution(payout_id: u64, authorization_id: String, attempt_id: u64, expires_at_ns: U64)` | Explicit independent Approver, Active/unpaused, valid immutable native record, positive bounded TTL, Reserved and next attempt; writes approval/attempt, no accounting change |
| `revoke_native_authorization(payout_id: u64, authorization_id: String, attempt_id: u64)` | Original approver or owner; matching unused Approved attempt only; allowed while paused, consumes no funds, keeps historical record and advances no counter backwards |
| `begin_native_preflight(payout_id: u64, authorization_id: String, attempt_id: u64)` | Explicit Executor, unpaused/Active, live token/recipient policy, independent approver still authorized, unexpired matching unused approval; consumes once and locks PreflightPending; **no promise** |

Read methods: `get_native_config`, `has_native_role`, `get_native_recipient`,
`get_native_mode`, `get_native_payout`, `get_native_authorization`,
`get_native_attempt`. View records expose version/phase and approval lifecycle;
they do not assert delivery or independently validate recipient evidence.

## Implemented transition table

| From → to | Caller / identity guard | Accounting / replay |
| --- | --- | --- |
| No native payout → Reserved | Strict reservation wrapper, common existing creation rules | Increase reserved once, reduce derived available; atomically create mode/binding |
| Reserved → Approved | Explicit Approver distinct from reservation actor; exact next attempt ID; unique authorization ID; expiry in bounds | No money delta; allocate attempt; increment next ID using checked addition |
| Approved → Approved (identical replay) | Same approver, payout, immutable binding, auth ID, attempt ID and expiry, still valid | No write/event/reserve/attempt duplication |
| Approved → Reserved (revocation) | Approver or owner; current unused auth/attempt only | No money delta; authorization permanently Revoked, keep attempt history; next approval needs fresh ID and next attempt number |
| Approved → PreflightPending | Explicit Executor, distinct from approver, exact binding/current attempt, unexpired and nonrevoked approval | Authorization Consumed; persist executor/block/time and lock once; no token/storage promise |
| PreflightPending → anything | **Unavailable in B** | No unlock, resubmission, release or settlement |
| TransferPending/Succeeded/AttemptFailed/ManualReview/Released | Schema representation and test-only fixtures, **no public constructor/transition** | All B initiation/approval/revocation paths reject them |

Revoked attempt metadata retains its historical Approved phase; the linked
**authorization.status=Revoked** is authoritative and the payout clears current
identity. Do not display that historical phase as an executable authorization.
Expiry is checked against on-chain time; no clock-based reset of locked attempts.
An expired unused approval must be revoked before a fresh one is issued. Revocation
can remain possible after the approver's role is revoked because it only reduces
unused authority. Once consumed, neither owner nor approver can revoke/reset it.

## Immutable identity and idempotency

Binding uses canonical Borsh SHA256 under `disburse/native-nep141/v1`: version,
current isolated contract, near:testnet, campaign/payout, Tidepool token, recipient,
amount, decimals6, reservation actor/time and immutable recipient evidence hash.
Authorization adds globally unique ID, monotonic payout-scoped attempt ID,
approver, approval time, expiry and Approved/Revoked/Consumed status. Amount/time
wrappers serialize as decimal strings. Every mutation cross-checks the binding
against the legacy payout/campaign and the authorization/attempt records.
No API accepts replacement recipient/token/amount during approval or preflight.

Legacy and native reservations share the existing `(campaign_id,key)` index.
Identical native replay returns the same ID, without reallocation or new events;
mode mismatch or changed details rejects. No enrollment/conversion method exists
for historical payouts. An orphan native marker or record blocks legacy mutation.
Native reservation actor never changes when another Operator replays a request.
Authorization IDs are never reused after revocation/consumption, even on another
payout; attempt IDs remain monotonic and checked for overflow/collision.

## Accounting proof boundary

The common helper retains checked existing rules: funded<=budget;
reserved+spent<=funded; available=funded-reserved-spent. Thus spent<=funded and
available+reserved+spent=funded. Approval, revocation and preflight touch sidecars
only. Native binding must equal input/output token and atomic amount, match the
campaign and satisfy amount<=the still-Reserved campaign reservation.

Local reference test: reserve100000 against funded1000000 → available900000,
reserved100000, spent0. Approval and preflight leave all three unchanged.
Invalid calls assert equality of **all stored bytes**, no new events and no
scheduled receipts. Multiple campaigns sharing one token and multiple payouts
are covered; another campaign's available balance cannot back a reservation.
No B transition can count native funds as spent, once or twice.

## Evidence and next boundary

[Structured results](evidence/milestone-5/m5b-implementation-results.json) records
126 passing tests (98 baseline + 28 new), format/clippy/build results, source and
artifact hashes, ABI safety checks, changed-file inventory and acceptance criteria.
No blockchain RPC, signing, transaction submission, DB write, live role grant,
frontend/TypeScript change, dependency change, commit or push was performed in B.
M5-A evidence is historical; it is not a fresh Nov16 balance assertion.

M5-C needs separate approval to add local promise scheduling, registration checks,
private callbacks, measured gas/storage guards and real async failure tests. M5-D
will define evidence-based recovery/retry/release. The current B artifact is
intentionally unsuitable for a live payout demonstration: its preflight lock has
no completion path. Recipient remains **RECIPIENT_UNVERIFIED**.
