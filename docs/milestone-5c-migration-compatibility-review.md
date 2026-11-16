# M5-C — Migration and serialization compatibility review

Revision `f37893e7a318e948e5e31b0634ee968247559c92`, 2026-11-16.
**Local historical-byte checks pass; full WASM/live upgrade safety is unproven.**
Overall M5-C verdict remains [BLOCKED](milestone-5c-independent-security-review.md).

## Actual state changes

There are no M5-C schema changes: implementation hashes still equal M5-B.
Top-level `Disburse` (`src/lib.rs:151`) fields remain, in Borsh order:
owner_id, paused, next_campaign_id, campaigns, roles, accepted_tokens,
next_payout_id, payouts, payout_idempotency. Compared with pre-B revision
`5e48e47d30032578486bbce5f111fbb7103e7164`, legacy Campaign/Payout/nested amount,
destination, status and role files are unchanged. No field append is assumed safe.

Existing collection prefixes: `campaigns`, `role-assignments`,
`accepted-ft-tokens`, `payout-records`, `payout-idempotency`.
Helper-map prefixes: `payout-execution-references`, `payout-lifecycle-reasons`,
`payout-failure-evidence-v1`, `payout-settlement-records-v1`,
`payout-resolution-records-v1`, `payout-settlement-executions-v1`,
`payout-settlement-references-v1`.
New B namespaces remain `native-config-v1`, `native-payout-mode-v1`,
`native-payout-records-v1`, `native-authorization-records-v1`,
`native-attempt-records-v1`, `native-role-assignments-v1`,
`native-recipient-approvals-v1`. No C execution-record extension was added.

Sidecar bootstrap (`src/native.rs:18`) checks owner, pause, fixed isolated account,
absent config key, well-formed expected hash, stored STATE deserialization/canonical
equality, matching raw STATE digest, expected SDK collection handles, bounded policy
and token allowlist. It writes one config key; it does not call `new()` or clear old
records. All new mutation paths validate configuration version/domain and binding.
Owner/Admin role semantics and existing evidence/index meanings remain unchanged.
The hash covers raw **STATE**, not the entire storage trie or token custody.
A bootstrap success is not a full-state or solvency attestation.

## Evidence hierarchy

| Level | Present? | What was independently observed | What it cannot establish |
| --- | --- | --- | --- |
| Synthetic serialization/storage | Yes, fresh passing tests | Nonempty legacy success/failure/release, payout indexes, evidence and role mappings remain accessible after Rust bootstrap; raw prior entries equal | Authentic nonempty deployed history; old WASM behavior; receipt rollback/gas |
| Authentic historical fixture | Yes, fresh passing tests | Actual Nov15 raw STATE/campaign/role/token entries deserialize and survive local paused bootstrap | Current live state, authentic nonempty payouts, external token balances, protocol upgrade safety |
| Full old→new WASM sandbox migration | **Absent** | No sandbox migration was executed | Cannot certify final candidate upgrade, pending callback compatibility or token preservation |
| Live deployment migration verification | **Absent, not authorized** | No deployment/upgrade/bootstrap transaction submitted | No live compatibility or custody assertion |

NEAR preserves storage across code replacement, so compatible bytes alone are not
permission to ignore schema or behavioral changes. [Official upgrade guidance](https://docs.near.org/smart-contracts/release/upgrade).

## Authentic fixture provenance and test interpretation

`tests/fixtures/m5b-deployed-state.json` exactly matches public values saved in
`docs/evidence/milestone-5/finalized-preflight.json`. Block277843166,
`5ccVg6DsrNnk4VXWtKGRp8Z4QEjMvsu7HFSt7V526TNG`, old code
`CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`.
It contains four entries: STATE137 bytes, Campaign0184 bytes, token membership and
Operator membership. Owner is `disburse-topg.testnet`; next campaign1, next payout0;
Campaign0 Active and funded1000000/reserved0/spent0. It contains **no payouts**.

`authentic_fixture` (`src/native/tests.rs:695`) loads raw entries into SDK mock
storage and deserializes an independently declared old-layout HistoricalState and
current Disburse. The test at714 explicitly calls pause/persist **before** capturing
the byte-preservation baseline. Bootstrap then retains all old bytes and adds only
configuration; the earlier pause is not misreported as an unchanged action.
Role/token views, owner, campaign and accounting survive. No token contract is
instantiated and no real receipt executes.

Nonempty test at817 uses present legacy Rust methods to create/settle one payout,
fail/release another, strips native namespace keys, then bootstraps. It verifies
raw old entries, current views, payout-idempotency and execution/evidence/replay
indexes, failure/settlement/resolution history, roles and spent10000. This is useful
synthetic state, not a captured on-chain history or old-WASM migration fixture.

## Required negative checks

Fresh tests at743/769/908/1034/1059 cover repeated or unauthorized bootstrap,
unpaused/wrong-account execution, malformed/trailing STATE, wrong hash, changed
collection prefixes, invalid cap/TTL, unknown config, orphan mode/record and new
ID collision. Prefix uniqueness includes no prefix-of-prefix collisions among
19 known namespaces. Rejected Rust calls preserve stored bytes/logs/zero receipts.
No proved schema corruption or loss of historical data was found.

Limits: contract code cannot enumerate arbitrary unknown raw prefixes, so sentinel
and known-handle checks do not rule out preexisting unknown orphan data. SDK
`catch_unwind` tests are not protocol receipt-rollback tests. No actual historical
in-flight native attempt exists in the authentic zero-payout fixture. Future C
schema additions must version sidecars or prove their encoding compatibility;
appending fields to existing V1 records is not automatically safe.

## Deployment blocker and recovery requirement

M5-E must test the final implemented C/D candidate and old WASM against a fresh
full snapshot plus nonempty and pending-attempt cases in a real sandbox; preserve
all counters/roles/tokens/indexes/evidence and separately verify token custody.
Test authorized/unauthorized/repeated/interrupted bootstrap, gas/storage failure,
old/new state discrimination and late callback identity. Reconfirm actual deployed
code, target network and deployment authority under separate approvals.

Old WASM may deserialize unchanged STATE yet ignore native sidecars and allow
legacy settlement/release on a pending native payout. Code rollback can therefore
reopen bypasses even without Borsh errors; restoring state cannot reverse an
external transfer. Freeze initiation, preserve evidence/locks, resolve outcomes
and prefer a reviewed compatible forward fix. No rollback/upgrade was attempted.

M5C-04 is a mandatory deployment blocker, not a claim that existing bytes are
corrupt and not a reason to implement a migration during this review. Real
recipient control, token behavior and current custody were not reverified here.
