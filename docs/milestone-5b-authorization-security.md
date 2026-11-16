# Milestone 5-B — Authorization security review

Local code review and adversarial validation, 2026-11-16. Baseline
`5e48e47d30032578486bbce5f111fbb7103e7164`. Approved design:
[M5-A](milestone-5-native-payout-architecture.md).
Implemented methods and transitions: [B state report](milestone-5b-native-execution-state.md).

## Independent authority

Existing owner is implicit Owner/Administrator, **not** implicit Operator/Verifier.
Existing Operator/Admin may reserve. Neither existing Operator, Administrator,
Verifier nor owner automatically receives native approval/execution power.
New explicit sidecar Approver and Executor permissions implement M5-A's separation
without changing the serialized legacy UserRole enum. Native roles cannot be
held simultaneously by one account; owner and contract account are excluded.
Owner configures membership only while paused and cannot self-grant these roles.

Approver must differ from immutable reservation actor. At preflight, Executor must
differ from approver, and approver must still hold its explicit permission.
A reservation actor can initiate only after explicit Executor grant **and** another
account's approval. The tests cover Operator granted Approver attempting self-
approval, ordinary Operator trying to initiate, privileged legacy accounts trying
to approve, and a correctly independent approved execution lock.

Owner can revoke unused consent, pause, change future membership and govern
recipient approval; it cannot mark native success, release a native reservation,
reset a consumed attempt or use legacy Verifier settlement on native mode.
Owner may control other accounts; account-ID separation cannot prove different
human controllers. FullAccess deployment keys can replace code or bypass app
rules with direct account-level transfers. That residual root authority persists;
no keys or account permissions were inspected or changed in B.

## Binding and anti-replay review

| Threat | Enforced boundary / tests |
| --- | --- |
| Self-approval / inherited Admin power | Explicit roles, original reservation actor check, executor/approver separation, no root role grants |
| Recipient/amount/token/network substitution | No replacement arguments in approval/initiation; versioned canonical binding checked against parent payout/campaign; mutation/corruption tests |
| Cross-payout/campaign authorization | Global ID index plus full binding, payout-scoped attempt identity and current pointers; cross-payout and two-campaign tests |
| Duplicate approval | Exact identical replay is no-op; mismatched expiry/identity/approver/binding fails |
| Reused revoked/consumed authorization | Status and current identity checks; global ID retained permanently |
| Duplicate/stale attempts | Checked monotonic next ID, stored tuple collision check, current ID/auth equality and one locked attempt |
| Expired/revoked approval | Positive bounded TTL at approval; exact time expiry at preflight; revoked authorization cannot restart |
| Role revocation between approval/initiation | Approver membership re-read at preflight; revoked executor also fails explicit permission check |
| Unknown / missing / corrupt state | Missing config, unknown versions, malformed Borsh, missing native mode/record, altered auth/attempt/binding fail closed |
| Budget/pool confusion | Existing checked accounting, own campaign binding and immutable reserved amount; multi-payout/campaign and integer boundary tests |
| Administrative fake delivery | No native success/failure/release/override API or promise; legacy methods reject native mode before lifecycle logic |
| Timeout/ManualReview retry | No reset or retry API; future/pending/terminal fixture states reject every B mutation |

Approval fields are stored together on-chain rather than accepted from a backend
API token or PostgreSQL record. Hashes identify canonical bytes; they are not
proofs of delivery or signatures. Native recipient approval is an owner-reviewed
evidence digest, not an implemented NEP-413 verifier. The owner must independently
verify participant control/storage and approve evidence in a separately authorized
future gate. No real recipient was chosen. Synthetic test recipients/hashes are
local fixtures only.

## Complete legacy bypass inventory

The first check in each of these exported methods calls `assert_legacy_payout`:

| Method | Native behavior |
| --- | --- |
| `start_payout_execution` | Reject |
| `mark_payout_pending_verification` | Reject |
| `mark_payout_failed` | Reject |
| `move_payout_to_manual_review` | Reject |
| `settle_payout` | Reject |
| `release_failed_payout_reservation` | Reject |
| `confirm_manual_review_execution` | Reject |
| `release_manual_review_reservation` | Reject |

The common private release helper also rejects native mode. A native marker **or**
a native record suffices to block legacy access, including incomplete sidecar
metadata. Tests assert the exact native-mode rejection reason, so denial cannot
be falsely credited to an unrelated missing role, bad evidence or wrong lifecycle
state. Checks run while paused and unpaused, including an explicitly granted
legacy Verifier. Historical payouts lacking both native marker and record retain
existing paths; all 98 baseline tests pass. Additional nonempty legacy fixture
settles one payout and releases a definitively failed payout successfully.

Campaign cancellation has no payout release/accounting/token effect. Native
approval/preflight requires Active campaign; cancellation or pause therefore
blocks new initiation without unlocking reserves. Token removal similarly blocks
approval/preflight. There is no generic legacy retry/status override/rescue entry
point to leave unguarded. M5-C/D must update this inventory for every new callback,
quarantine, resolution or retry method; manual settlement cannot become a shortcut.

## Independent local validation and limits

28 new tests cover authorization, state, corruption/substitution, replay,
legacy-mode denial, accounting and authentic/synthetic compatibility. Rejected
operations compare full storage before/after and require no new logs or receipts.
Tests run as Rust calls under NEAR SDK's mock runtime; successful B methods also
assert zero scheduled receipts. Generated ABI is checked for nonpayable mutation
methods and absence of native transfer, success, callback and release endpoints.
A source/ABI audit supplements tests; no other agent or external audit is claimed.

The build is a host local WASM build, not a reproducible production attestation.
There are no real asynchronous receipt/gas tests yet because B intentionally has
no promises. The B preflight lock consumes consent without sending a token/storage
call and cannot be reset. M5-C must integrate atomic promise scheduling with that
transition and test callback spoofing, stale/duplicate callbacks, registration
failure, token failure, success followed by callback panic/OOG, pause interleaving,
RPC uncertainty and “never resend after delivery”. Recovering a consumed locked
attempt is outside B and must not be added as an owner override.

Other residual gates: recipient control, token implementation restrictions and
upgrade governance, actual independent role holders, operational TTL/cap choices,
exact chain/genesis verification by deployment tools, future storage/gas costs,
real promise sandbox tests, finalized independent receipt evidence, recovery trust
and full M5-E candidate migration validation. A fixed contract/token/network domain
does not let the contract inspect RPC chain identity on its own.

No critical B acceptance failure remains. These are later-phase requirements and
must remain blockers to live use. No dependency, service, DB, frontend or live
configuration was changed.
