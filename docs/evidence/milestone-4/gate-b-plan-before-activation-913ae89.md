# Milestone 4-B — payout reservation preflight

**BLOCKED. Proposal-only audit; no executable transaction prepared.**
Campaign 0 is **Approved**, not Active. Fresh finalized state does not establish
M4-A activation. No transaction was signed, submitted or simulated against live
mutable state. No payout, reservation, activation, transfer or application change
occurred. No database, environment, keychain or permission changes; no commit/push.

The initial attachment ended mid-sentence in Phase F. The user subsequently
supplied Phases F–H and confirmed that no controlled recipient is verified.
This update incorporates the complete instructions; the recipient remains blocked.

## Repository and deployment evidence

HEAD `4361b82cf66834021516c1d22347bf0c79e2e4e0`, branch main tracking origin/main.
Initial worktree contained the preceding untracked M4-A documentation/evidence;
no tracked modifications. That work was preserved. Inspection date and finalized
heights/hashes are in [validation](evidence/milestone-4/gate-b-validation.json)
and [public RPC evidence](evidence/milestone-4/gate-b-preflight.json).

Reviewed Rust payout/lifecycle/accounting/idempotency types and tests, live ABI,
local generated ABI/WASM, M3 execution evidence, M4-A plan and existing discovery,
reconciliation, provider registry/recipient and Intents adapter interfaces.
No M4-A execution report or finalized activation transaction was found.

The live deployed WASM was downloaded read-only and equals the local artifact
byte for byte: 299058 bytes, SHA-256
`a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530`.
The account code hash matches the expected
`CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`.
The freshly decompressed deployed ABI body matches the generated local body.
Provenance remains the recorded M2 host build, unchanged tracked source/lockfile
and matching bytes, not a new independent hermetic rebuild or attestation.

## Fresh chain state and blockers

NEAR Testnet finalized reads confirm the isolated contract exists; owner remains
`disburse-topg.testnet`, global pause false, Tidepool USDC accepted, and Operator
role assigned to `disburse-op-b966e36d.testnet`. It is neither Administrator nor
Verifier. The original protected contract's full application storage, code and
storage usage match the M3 final baseline. No transaction targeted it.

| Property | Actual current atomic units |
| --- | ---: |
| Campaign 0 status | **Approved — Active requirement fails** |
| Budget | 1000000 |
| Funded | 1000000 |
| Available | 1000000 |
| Reserved | 0 |
| Spent | 0 |
| Operator token balance | 99000000 |
| Isolated token balance | 1000000 |
| Campaign count | 1 |
| Payout count | 0 |

Title/token match the M3 baseline. Wrapped accounting views establish exact amounts.
The source-matching Borsh global STATE next-payout counter is zero; missing
`get_payout(0)` corroborates it. Full isolated state is still byte-identical to
M3's final snapshot, so it contains no activation status change or payout records.

`available = funded - reserved - spent = 1000000`; `funded <= budget` holds.
Token custody agrees for this isolated sole-funded-campaign/zero-payout case.
In general pooled contract balances can include other campaigns or unassigned
direct token receipts; wallet balance alone cannot establish campaign funding.

Additional blocker: no documented approved controlled payout recipient was found.
No destination address, optional NEAR recipient, expected output token/amount or
live compatible testnet provider route was invented. Existing test fixtures and
mainnet example addresses are not ownership evidence or approval.

## Exact deployed method and serialization

`src/lib.rs:272` defines:

```rust
pub fn create_payout(
    &mut self,
    campaign_id: u64,
    idempotency_key: String,
    recipient_near_account_id: Option<AccountId>,
    destination: PayoutDestination,
    input_amount: TokenAmount,
    expected_output_amount: TokenAmount,
) -> u64
```

This is a nonpayable JSON call. A future call attaches **0 NEAR**. Arguments:

| Name | Implemented JSON representation |
| --- | --- |
| campaign_id | Numeric unsigned u64, proposed campaign ID 0 |
| idempotency_key | Nonblank string, scoped to campaign ID |
| recipient_near_account_id | Valid NEAR AccountId string or null; explicitly include null if unused; does not substitute for destination |
| destination | Object with `chain_id` and `recipient_address`, both strings |
| input_amount | Object with `token_id`, numeric u128 `atomic_amount`, numeric u8 `decimals` |
| expected_output_amount | Same TokenAmount object structure, positive amount; not assumed equal to input |

TokenId JSON is externally tagged: `{"Near":"usdc.tidepool-sandbox.testnet"}`
for the input, or `{"External":"provider-native-token-identifier"}` for an
approved external output. The latter text is a type illustration, not a chosen
asset or executable payload. TokenAmount arguments use JSON **numbers** for raw
u128 amounts; payout views wrap them into U128 **strings**. These are distinct
interfaces. Input design is 100000 atomic units at 6 decimals; output remains
unresolved. No complete argument object or CLI command was prepared.

## Authorization and reservation mechanics

Global unpause is checked first. Authorization uses predecessor_account_id:
explicit Operator, explicit Administrator or implicit owner Administrator.
Operator alone suffices; Verifier alone does not. A direct Operator transaction
would be the least-privileged currently known caller, rather than owner. This is
an authorization finding, not permission to sign or execute.

For a new key, it requires the campaign to exist and be Active; input NEAR token
ID must equal its funding token; both input/output amounts must be positive.
Available balance is validated as `funded - (reserved + spent)`, with funded
bounded by budget, checked addition/subtraction and committed <= funded. The
requested input must not exceed available. Reservation addition and payout-ID
increment are checked; ID collisions are rejected before persistent writes.

The current global next_payout_id is 0. A future successful first reservation
would return 0 and advance it to 1 **only if a repeat preflight confirms no other
payout intervened**. The code constructs Created, changes to Authorized and then
Reserved before storage; the initial persisted/public status is **Reserved**.
It stores the campaign reservation, payout, scoped idempotency index and updated
counter. It does not persist separate Created/Authorized lifecycle transitions.
Creation allocates new storage records funded from existing contract NEAR storage
backing, not USDC; exact growth depends on the unresolved destination/key lengths.
A final executable proposal must assess storage and fee sufficiency and choose a
gas cap after arguments are fixed. No exact storage cost is claimed here.

Only campaign reserved/available change; funded, spent, budget, status and token
balances do not. There is no promise or external transfer. Event standard
`disburse`, version `1.0.0`, event `payout_reserved`, data array contains:
`payout_id`, `campaign_id`, `actor_id`, `input_token_id`, `input_amount` string,
`expected_output_token_id`, `expected_output_amount` string and status `Reserved`.
Output fields cannot yet be populated safely. No recipient is included in that
event, so discovery must read the payout view rather than infer its destination.

## Idempotency details

Suggested key `m4b-campaign-0-first-payout-v1` passes the deployed nonblank rule.
Fresh finalized `get_payout_by_idempotency` with campaign_id 0 returned null;
response/height/hash are retained in validation evidence. Recheck before any
future proposal/execution. The contract has no additional key length restriction,
so keep the short descriptive key and do not reuse it for a different intent.

The index key is `(campaign_id, idempotency_key)`. After global pause, caller and
positive amount checks, an existing key is looked up **before** Active-state and
available-balance checks. An identical request returns the existing payout ID,
without a new event, increment or reservation, even if its lifecycle progressed.
It does not reset status or authorize another payment. Unauthorized/paused retries
still fail. Conflicting reuse compares campaign, optional NEAR recipient,
destination, input amount/token/decimals and expected output amount/token/decimals,
and panics. Actor is not part of the payload comparison: another authorized caller
can retrieve an identical prior result. Cross-campaign keys are independent.

## Destination validation and service compatibility

On-chain ChainId and RecipientAddress validate only non-whitespace content and
preserve supplied strings. There is **no on-chain supported-chain registry,
chain-specific address check, destination-network verification, output asset
allowlist, output decimal lookup or conversion/quote validation**. Optional
AccountId is syntactically checked by its NEAR type, not proved controlled or
linked to destination. Input decimals likewise are not checked against ft_metadata.
An input token mismatch is rejected, but a meaningless positive output request
could still reserve funds and later be rejected off-chain.

The execution-service registry (`providers/networks.ts`) recognizes eip155:1,
eip155:8453, near:mainnet and near:testnet for format support. All have
`executionEnabled: false`. The sole registry testnet is near:testnet; an EVM
Sepolia fixture is not a configured supported route. Mainnet options are unsuitable
for this test. Format support does not establish a provider route.

`providers/recipient.ts` adds canonical supported-network, trimmed address,
length and NEAR/EVM syntax rules, EVM zero-address rejection and mixed-case
checksum checks. These checks do not prove account ownership or funded/existing
NEAR destination, and named NEAR syntax alone does not prove network membership.
A future named test recipient must have explicit control/approval and Testnet
account/network/token storage checks where needed, and must not be the owner or
contract. No such recipient was selected during this blocked gate.

The Intents adapter is read-only and always uses dry:true. It requires exact
network/provider mappings, unique trusted asset mappings, matching decimals and
recipient/refund/output binding. Tidepool token support cannot be inferred from
the chain registry or source code; no live compatible testnet route is established
here. Do not label a hypothetical near:testnet recipient Intents-compatible without
those checks. No provider calls or execution flows were started.

`NearDiscoveryCoordinator` has no signing/execution capability, but discovery and
reconciliation can persist observations/jobs through repository interfaces. The
processor validates contract/network event identity and reads authoritative payout
views; reconciliation rereads known payouts so event/job state cannot supersede
chain state. The scoped payout and campaign-accounting reads can expose a future
reservation. These services were inspected, **not run**, so no database records
were created. Active Testnet host remains read-only with signing/workers disabled.

Reservation allocates accounting; execution separately coordinates/submits a
payment; settlement separately verifies outcome/evidence and updates accounting.
A Reserved payout is not a completed payment. This gate authorizes none of them.

## Conditional accounting calculation and tests

This is arithmetic/source analysis, not a live dry-run or executable proposal:

| Property | Before future reservation (required) | Conditional after |
| --- | ---: | ---: |
| Campaign status | Active | Active |
| Budget | 1000000 | 1000000 |
| Funded | 1000000 | 1000000 |
| Available | 1000000 | 900000 |
| Reserved | 0 | 100000 |
| Spent | 0 | 0 |
| Contract USDC | 1000000 | 1000000 |
| Operator USDC | 99000000 | 99000000 |
| Payout count | 0 | 1 |

Existing `cargo test --locked --offline`: **98 passed**, zero failed; doc tests
passed (0). No production code or tests modified. Local fixtures, not live chain.

| Required case | Existing evidence |
| --- | --- |
| Unauthorized caller | payout_rejections_preserve_campaign_ids_records_and_events |
| Paused contract | global_pause_blocks_reservations_without_mutation |
| Draft/Approved and other non-Active states | every_non_active_campaign_status_rejects_payout_creation |
| Zero input/output; wrong input token; over-available | invalid_campaign_amount_token_and_balance_are_rejected |
| Identical retry | identical_idempotent_retry_does_not_reserve_or_emit_again |
| Conflicting reuse/campaign scoping | idempotency_key_payload_mismatch_and_campaign_scope; idempotency_rejects_each_changed_request_field_and_blank_keys |
| Exact reservation and wrapped views/event | operator_reserves_exact_input_and_views_use_u128_strings |
| Arithmetic invariants and boundaries | exact_available_balance_can_be_reserved_and_spent_is_counted; nonexistent_campaign_and_available_balance_underflow_are_rejected; rejected_non_active_campaign_and_malformed_accounting_do_not_create_payout; payout_id_overflow_fails_before_any_persistent_write |
| Blank destination/chain | type deserialization tests reject blank identifiers |
| Invalid chain-specific address / unsupported chain on chain | Intentionally no rejection rule; opaque nonblank identifiers accepted; cannot claim protection |

No exact 100000-on-1000000 scenario was added; the established generic reservation
logic and existing tests support the arithmetic, not a separately run live-state
simulation. No live RPC change-method probe was attempted.

## Resolution required before approval

1. Provide/establish independently finalized separately approved M4-A activation;
   repeat reads must show Active. **Do not activate as part of M4-B.**
2. Confirm a controlled test recipient, exact supported network and destination,
   optional NEAR recipient semantics, output asset/decimals/amount and compatible
   safe testnet execution route. Never substitute owner/contract or a fixture.
3. The missing instruction continuation has now been supplied; no instruction
   clarification remains pending.
4. Repeat finalized identity/configuration/accounting/counters/balances/idempotency
   checks, assess storage/fees, then prepare an exact unapproved manifest for review.

[Blocked manifest](evidence/milestone-4/gate-b-proposed-manifest.json) deliberately
contains `transaction: null` and `cli_command: null`; it is not executable.
No M4-B execution approval is requested while these blockers remain.


## Phase F completion — service, API and dashboard boundaries

The user's continuation explicitly confirms recipient status **UNVERIFIED**.
No candidate address, Operator/owner/contract substitute, output token or asset
mapping is selected. Only `near:testnet` is a test-network format candidate in
the actual static registry. Ethereum/Base entries are mainnet; Sepolia is absent.
No concrete compatible output token is established by the host configuration:
`NearIntentsAdapterConfig.assets` and network mappings must be supplied explicitly,
and no production host instantiation of that adapter with Tidepool mappings was
found in `execution-service/src`. Test fixtures are not configured live routes.
Thus there is currently no verified network-plus-output-token execution candidate.

Discovery interfaces are `NearEventSource` and `NearDiscoveryCoordinator`.
`discovery/events.ts` parses `payout_reserved` and validates its known fields and
source identity. `discovery/processor.ts` reads `getCampaignPayout(campaignId,
payoutId)` with fallback `getPayout(payoutId)`, then checks payout/campaign identity,
input/output token IDs and amounts against the event. Only a consistent currently
Reserved payout can produce a job when job creation is allowed. It commits the
event, observation, discrepancy if any, optional job and next cursor through the
repository. Network/contract/payout ID form the job scope; campaign ID stays bound
in the payout snapshot and is checked separately. IDs are preserved as decimal
strings rather than conflating campaign ID 0 with payout ID 0.

Event deduplication/cursor persistence and scoped job keys prevent duplicate
discovery from becoming a second job. Reconciliation rereads known chain views;
it is not an authorization to execute. These interfaces write persistence when
run, so neither discovery nor reconciliation was invoked in this milestone.
No PostgreSQL rows, observations, jobs or policy records were changed.

The current authenticated read-only API exposes direct contract reads at
`GET /v1/payouts/:payoutId` and
`GET /v1/campaigns/:campaignId/payouts/:payoutId`. Therefore a future reservation
can be read by a known numeric ID without discovery or database insertion.
The `/dashboard/payouts/<numeric-id>` page first reads the payout to determine its
campaign, then reads the scoped payout and optional persisted execution job.
`ExecutionPayoutDetails` can show chain data while reporting missing execution
records. This is code-path compatibility, not a browser test of a nonexistent
payout or proof of future successful rendering.

In contrast, `GET /v1/campaigns/:campaignId/payouts` and
`/dashboard/payouts?campaignId=0` list **persisted jobs**, not all on-chain payouts.
With discovery stopped, a new reservation is not automatically added to that list.
A known-ID detail URL can work, but a complete automatic chain-backed payout
listing needs separately reviewed discovery ingestion or read-only enumeration
integration. It must not be enabled or implemented as part of this gate.

Before any actual execution, the signing/refund modules require payout-bound
approved execution authorization, validated refund policy/fingerprint and exact
quote/network/token/recipient binding, together with freshness, budget and replay
controls. Reservation alone creates none of those approvals. Settlement further
requires independent delivery evidence and authorized on-chain Verifier handling;
provider status or a Reserved record cannot establish delivery. No execution
authorization, refund-policy approval/consumption or Intents deposit was created.

The service state machine has ManualReview paths for execution uncertainty,
verification/settlement issues and operational incidents. A future attempt could
require ManualReview; on-chain ManualReview is a separate authorized lifecycle
change, not an automatic consequence of create_payout or a missing route. There
is no current attempt here and no automatic recovery/retry is authorized.

Active Testnet host wiring supplies read-only contract/job readers and an
authenticated GET allowlist; signing and workers are disabled. No background
processor, signing capability, Intents submission or database-writing operation
was started. Format validation, discovery capability and a dashboard detail read
do not mean **execution readiness**. Both reservation approval and payment
execution remain blocked for distinct reasons.

## Required post-reservation verification — conditional, not authorized

After a future complete proposal and separate explicit approval, repeat finalized
preflight and require Active, unchanged identity/configuration, unused key,
1000000 available, zero payouts and confirmed recipient/output route. Independently
verify a successful FINAL transaction and all outcomes, its exact caller, target,
arguments, zero deposit and approved gas. Derive the actual returned payout ID;
require one matching payout_reserved event and no token-transfer event. Read the
payout by ID, campaign scope and idempotency key; they must agree on Reserved,
input 100000, the approved output, recipient/destination and immutable identity.

Require campaign reserved 100000, available 900000, funded/budget 1000000 and
spent0, unchanged Active lifecycle and wallet token balances. Counter must advance
exactly once with one new payout/index entry, all unrelated storage/configuration
and the protected original contract unchanged. Assess expected storage/NEAR fee
deltas rather than treating a zero attached deposit as zero storage cost. Verify
the known-ID dashboard/API reads without starting writers. Do not submit a second
transaction merely to test idempotency or resolve an uncertain submission.

The blocked manifest remains deliberately unsigned, unsubmitted and nonexecutable.
Separate explicit approval is required for any future exact reservation transaction,
and separate execution/settlement approvals are outside reservation scope.
