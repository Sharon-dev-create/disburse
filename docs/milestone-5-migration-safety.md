# Milestone 5-A — Migration and custody safety

Design only, revision `913ae89e627c287af176aa9b0e6f9e4091d68ab7`, 2026-11-15.
[Architecture and live baseline](milestone-5-native-payout-architecture.md).
No deploy, migration, state mutation, key import/export or signing occurred.

## Actual persisted layout

`src/lib.rs:145` declares these Borsh fields **in order**:

| Field | Type / existing prefix |
| --- | --- |
| owner_id | AccountId |
| paused | bool |
| next_campaign_id | u64 |
| campaigns | store::LookupMap<u64, Campaign>, `campaigns` |
| roles | store::LookupSet<(AccountId, UserRole)>, `role-assignments` |
| accepted_tokens | store::LookupSet<AccountId>, `accepted-ft-tokens` |
| next_payout_id | u64 |
| payouts | store::LookupMap<u64, Payout>, `payout-records` |
| payout_idempotency | store::LookupMap<(u64, String), u64>, `payout-idempotency` |

Additional helper-created maps (not fields in STATE):
`payout-execution-references`, `payout-lifecycle-reasons`,
`payout-failure-evidence-v1`, `payout-settlement-records-v1`,
`payout-resolution-records-v1`, `payout-settlement-executions-v1`,
`payout-settlement-references-v1`. Preserve every key/value, including replay indexes.

Campaign fields: id, creator_id, title, token_id, budget, funded, reserved, spent,
status, created_at_ns. Payout fields: id, campaign_id, recipient_near_account_id,
input_amount, destination, expected_output_amount, status, created_at_ns,
execution_reference, settlement_evidence_reference. Inner TokenAmount/destination
encodings matter too. UserRole order Owner/Administrator/Operator/Verifier;
CampaignStatus Draft/Active/Paused/Completed/Cancelled/Approved; payout status
order in architecture. Do not reorder enum variants or alter serialization/types.

`new()` initializes empty maps and predecessor owner; it is not a migration and
must never be rerun to preserve existing state. No state version or migrate/deploy
entry point exists. Adding a field to Disburse, Campaign or Payout is **not Borsh
backward compatible**. Collection handles contain prefixes; changing those can
orphan records even when the top-level struct still deserializes.

Fresh full state is four entries: 137-byte STATE, Campaign 0 (184 bytes), accepted
token membership and Operator membership. STATE confirms next campaign ID1,
next payout ID0, unpaused owner, existing prefixes. LookupMap is not enumerable
by its handle: migration audit needs complete raw snapshot, counters, known keys
and off-chain index, not just get_payout(0)==null. Future snapshot must include
nonempty settlement, failure, resolution and replay indexes, not only this easy
zero-payout fixture. Current custody is 1000000 atomic USDC in the token contract's
balance for Disburse; it is not stored inside the Disburse Borsh snapshot.

## Strategy comparison

| Option | Security / preservation / custody | Complexity, rollback and approvals | Demo feasibility |
| --- | --- | --- | --- |
| A: in-place isolated upgrade | Same account and USDC custody; can preserve legacy bytes with new sidecars. New code must guard ALL old mutation routes. Account FullAccess remains root authority. | Moderate, requires snapshot fixtures and deployed artifact provenance. New behavior makes older code unsafe even if readable. Separate build review, deploy and bootstrap approvals. | Preferred **only after** byte-preservation and async tests pass; no live upgrade authorized now. |
| B: new isolated deployment | Protects old deployment by leaving it and its 1 USDC untouched. New initialization/configuration loses continuity unless explicitly recreated; cannot simply copy state while leaving backing funds behind. | New account/storage/roles/funding and approvals; duplicated campaign identities require network+contract scoping. Old contract cannot transfer funds through a safe app method. Never use its FullAccess key as an unstated migration shortcut. | Safest fallback if A cannot be demonstrated. Use separately approved new wallet-held test USDC; do not count old funds as backing new campaigns. |
| C: auxiliary executor | Cannot spend source NEP-141 balance by calling token as itself. Source must still gain a constrained promise interface or send custody out. No standard ERC20-style allowance assumed. | Extra contract/trust/callback/upgrade surface; unrestricted delegation/custody unacceptable. Still needs source upgrade and caps. Old source lacks that interface. | Reject for initial demo: more complexity without removing core upgrade requirement. |

Recommend **A conditionally**, using existing sidecar pattern while freezing legacy
schemas. B is fallback if A's preservation or root-authority review fails. A is not
safe merely because current payout count is zero. No option creates permission to
move the current 1 USDC during this milestone.

## Proposed versioned sidecar extension

Reserve separate, collision-checked prefixes (proposals, not written):
`native-config-v1`, `native-payout-mode-v1`, `native-payout-records-v1`,
`native-attempt-records-v1`, `native-authorization-records-v1`,
`native-role-assignments-v1`, `native-recipient-approvals-v1`,
`native-resolution-proposals-v1`.
Each prefix's key/value schema is independently versioned and frozen in fixtures.
Do not append fields to legacy structs or reinterpret existing statuses.
Configuration sentinel records schema/build version, configured Testnet deployment
identity and token restrictions. No sidecar means legacy/external mode, not native.
Require mode guard first on every legacy lifecycle function; native payout mode
never changes after reservation. New wrapper atomically reserves and writes mode,
actor and native record; idempotency conflicts must compare execution mode too.
If a partial write panics, all writes in that receipt must roll back in sandbox tests.

Owner-authorized, idempotent future bootstrap must require reviewed isolated account,
paused maintenance window and a fresh snapshot. It must reject already-initialized
or unexpected prefixes/config; never overwrite STATE, campaigns, roles, allowlist,
payouts or evidence. Sidecar role defaults deny everyone, including implicit Admin.
No implicit import of legacy payouts into native mode. Current zero-payout baseline
may simplify bootstrap but is a fresh precondition, not a migration assumption.
Upgraded code must fail closed before sentinel initialization. Safe views/legacy
bookkeeping behavior must be reviewed explicitly, not silently change old semantics.

If preserving top-level layout becomes impractical, stop and design explicit
`OldDisburse`→versioned new state migration using private/authorized
`#[init(ignore_state)]` with old-state deserialization. That changes the strategy
and needs a new review; no fallback to appending fields and hoping deserialization
works. No programmatic upgrade method is assumed to exist.

## Authority, provenance and pre/post verification

Application owner `disburse-topg.testnet` is not the account deployment authority.
Current isolated account has FullAccess public key
`ed25519:9hWszNNZawwV2VngQJkKpwCCGTka3LvM1qeN2oZKPWRe`.
This is a public chain observation, not evidence of secure private-key availability.
Future upgrade needs separate secure signer verification and explicit exact-action
approval; no private-key inspection is part of this milestone. Function-call keys
cannot authorize DeployContract. No current contract method deploys code.

Before approval: snapshot full raw state, get owner/roles/tokens/counters/campaigns,
all indexes/evidence, token balances and NEAR/storage at one finalized block;
record access keys, old WASM/ABI hashes and source/lockfile/build-toolchain hashes.
Cross-check independent RPCs and reproducible candidate build; local/deployed old
byte equality is provenance continuity, not a hermetic rebuild. Hash all evidence.
Quiesce new initiations and resolve pending attempts before an ordinary upgrade;
only a separately reviewed emergency forward fix may proceed with frozen pending
attempts and explicit callback compatibility. Never assume global pause stops
already scheduled receipts or token transfers.

Near-workspaces/sandbox tests must load exact old snapshot and old WASM, apply
candidate code/bootstrap, compare raw preserved keys and semantic views, then
exercise representative native/legacy mutations. Include nonzero payout/evidence
fixtures, prefix collisions, malformed STATE, reinitialization, wrong caller,
interrupted bootstrap, unknown schema and low storage NEAR. Upgrade must not
manufacture authority or allocation from token balance. Check token custody
separately, unchanged through upgrade. Pausing/unpausing and bootstrap are separate
live state changes, each requiring reviewed parameters and approval.

After a separately approved future deploy: verify code/ABI/candidate build hashes,
all preserved fields/key/value hashes and token custody; classify intentional
sidecar changes only. Stop on any unexpected delta. No reservation/execution until
independent approval of that evidence. Protect the original application owner's
contract from deployment commands; exact isolated target and Testnet chain/genesis
identity must be asserted by tools and manifests. `.testnet` suffix alone is not
an execution environment check.

## Rollback is not a safety mechanism

NEAR separates code and state. Older code may fail to deserialize new state, or
may deserialize unchanged legacy STATE while **ignoring native sidecars** and
allow trusted manual settlement/release on an in-flight native payout. That can
free funds or re-enable a duplicate transfer. Restoring old code cannot undo a
successful token transfer. Deleting a newer sidecar erases replay protection.
See [NEAR upgrade guidance](https://docs.near.org/smart-contracts/release/upgrade).

Prefer freeze new initiations, preserve attempts/authorizations, inspect finalized
receipts independently, reconcile once, then deploy a forward fix compatible with
old and current callback identities. Back up evidence and state, but never restore
an old snapshot over external token movements. Any proposed older-code recovery
needs a compatibility audit and proof of no unresolved execution; schema readability
alone is insufficient. Do not automatically roll back after a failed callback.
