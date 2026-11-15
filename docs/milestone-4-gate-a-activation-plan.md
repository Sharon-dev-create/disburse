# Milestone 4-A — Campaign 0 activation proposal

**READY FOR APPROVAL. Proposal only; NOT APPROVED for execution.**
No activation, transaction signing, submission, payout, token transfer or chain
write occurred. Only documentation/evidence was added. No application code,
environment, database, keychain, deployment configuration or permissions changed.
No commit or push was made.

## Inspection and evidence

Inspection: 2026-11-15, 13:45 UTC (14:45 Africa/Douala).
Repository: `/home/topg/disburse`; branch `main`, initially clean and tracking
`origin/main`; HEAD `4361b82cf66834021516c1d22347bf0c79e2e4e0`.
The repeated attachment contained identical instructions.

Reviewed the M3 funding plan, M3-C execution report and chain evidence, Rust
lifecycle/state/role code, generated ABI, existing lifecycle/accounting tests,
execution-service GET allowlist/authentication and frontend read-only controls.
Historical M3 transactions are baseline evidence, not the fresh-state proof.

Durable evidence:

- [Fresh finalized RPC responses](evidence/milestone-4/preflight.json)
- [Validated checks, provenance and source hashes](evidence/milestone-4/preflight-validation.json)
- [Fresh deployed ABI](evidence/milestone-4/deployed-abi.json)
- [Exact proposed manifest](evidence/milestone-4/gate-a-proposed-manifest.json)

Reads used `https://rpc.testnet.fastnear.com`, with `finality: final` for state,
code and ABI queries. They span finalized heights 277812263–277812384, rather
than one atomic snapshot. A transient TLS failure on the Operator account read
was retried read-only and succeeded. No activation RPC call was attempted.

## Deployment identity and provenance

The isolated account exists and has code hash
`CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`.
Downloaded live WASM exactly equals `target/near/disburse_contract.wasm`:
299058 bytes; SHA-256 hex
`a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530`.
The base58 SHA-256 independently equals the account's code hash.
The deployed `__contract_abi` was decompressed with Zstandard, and its complete
body equals the local generated ABI body. The local ABI metadata identifies the
same WASM hash. The activation method is a JSON `call`, with no payable modifier.

The [M2 setup report](milestone-2-testnet-setup.md) records the host build of this
exact hash. Tracked `src`, `Cargo.toml` and `Cargo.lock` are byte-unchanged from
revision `5587363`, which contains that build record; current file hashes are
recorded in validation evidence. This establishes continuity to the recorded
reviewed artifact, not an independent hermetic source-to-binary attestation.
No new reproducible-container rebuild or third-party attestation was performed.
This limitation is explicit; ABI equality alone would not prove implementation.

## Fresh current state

Contract `disburse-test-contract.testnet`; owner `disburse-topg.testnet`;
global pause false; Tidepool USDC accepted. Operator role remains assigned to
`disburse-op-b966e36d.testnet`, which has neither Administrator nor Verifier.
The owner currently has no explicit Operator role. Campaign count is exactly 1.

Campaign 0 exists, titled **Disburse Milestone 3 funding verification**, with token
`usdc.tidepool-sandbox.testnet` and status **Approved**.

| Property | Verified current atomic units | Test USDC |
| --- | ---: | ---: |
| Budget | 1000000 | 1 |
| Funded | 1000000 | 1 |
| Available | 1000000 | 1 |
| Reserved | 0 | 0 |
| Spent | 0 | 0 |
| Remaining budget | 0 | 0 |
| Operator token balance | 99000000 | 99 |
| Isolated token balance | 1000000 | 1 |

Wrapped U128 views establish exact amounts. `1000000 - 0 - 0 = 1000000`;
`reserved + spent <= funded <= budget` holds, with funded equal to budget.
The isolated token balance equals this sole campaign's unspent funded amount;
there is no unexplained surplus. Both token accounts remain storage-registered.

The full isolated storage is byte-identical to the M3 final snapshot. The global
Borsh STATE layout in `src/lib.rs:148` independently decodes next campaign ID 1
and next payout ID **0**; the missing `get_payout(0)` is corroboration, not proof
by itself. No aggregate payout-count getter exists, so no fabricated count was
added to the API or UI.

The protected original `disburse-topg.testnet` account's complete application
storage, code hash, storage usage, NEAR balance and access-key list/nonces match
[the M3 final baseline](evidence/milestone-3/final-read-only-snapshot.json).
No unexpected original-contract change was found, and no transaction targeted it.

## Actual activation implementation

Signature at `src/lib.rs:968`:

```rust
pub fn activate_campaign(&mut self, campaign_id: u64)
```

Complete JSON schema: one `campaign_id` unsigned 64-bit integer. Use JSON number
`0`, not string `"0"`, U64 wrapper or a nested object. Exact bytes:
`{"campaign_id":0}` (base64 `eyJjYW1wYWlnbl9pZCI6MH0=`).
There is no status, budget, token, funding or payout argument and no return value
other than unit/empty success.

Execution order:

1. `assert_campaign_operations_enabled` requires the global contract unpaused.
2. Reads `env::predecessor_account_id()` as actor.
3. Requires `has_direct_role(actor, Operator)`.
4. Loads the requested existing campaign.
5. Requires its status exactly Approved.
6. `set_campaign_status` replaces only its status with Active, reinserts that
   campaign under the same ID and emits the lifecycle event.

Authorization is based on **predecessor**, not the original transaction signer
through an intermediary contract. The proposal is a direct Operator transaction,
so signer and predecessor are the same account. No separate administrator,
creator, verifier or owner check is involved. Owner implicitly receives Owner
and Administrator only; ownership alone cannot activate. An owner explicitly
granted Operator could activate, but the live owner has no such grant.

The existing Operator is the least-privileged verified available authorized
account. Its supported CLI legacy-keychain public-key lookup returned
`ed25519:AWTKGeMdxfne1dnx9PoRK8ABVBegkQpisyXoyYQQu5X8`, matching its current
on-chain FullAccess key. The existing credential file is topg-owned, mode 600;
no private key was printed, copied, imported, exported or changed. No new signing
proof was made because this task forbids signatures. Application role privilege
is minimal among the verified accounts; the existing account key itself remains
FullAccess, not a method-restricted key. No permission change is proposed.

Operator NEAR balance is `9997722911129295899999999` yoctoNEAR. Subtracting
current storage backing gives `9995902911129295899999999` liquid yoctoNEAR,
well above the proposed gas cap's cost. At the observed gas price `100000000`
yoctoNEAR/gas, 30 Tgas corresponds to 0.003 NEAR execution gas, before transaction
fees and possible price movement. Recheck fee sufficiency before execution.

### Lifecycle and funding conditions

- Approved → Active is valid. Draft, Active, Paused, Completed and Cancelled
  cannot be activated by this method.
- **Full funding is not a contract precondition.** No positive funding, budget
  equality, balance, token-allowlist or accounting check occurs in activation.
  Unfunded and partially funded Approved campaigns can activate.
- This proposal imposes the stronger policy that this campaign is fully funded
  and its accounting/balances reconcile, which fresh reads confirm.
- A second activation fails with `Cannot activate campaign from Active status`.
  It is not an idempotent success. If state has changed, stop rather than resend.
- No lifecycle method returns Active to Approved. Pause/resume is Active ↔ Paused;
  cancelling is a different lifecycle action and does not restore Approved.
- **Funding accepts only Approved campaigns.** Activation closes the deposit
  path; a partial campaign could not simply be topped up while Active. This
  campaign has zero remaining budget, so no further funding is needed.
- Global pause blocks activation with `Contract is paused`.
- No extra attached deposit or storage registration is required. The method is
  nonpayable: deposit must be **0 yoctoNEAR**, not 1. The existing record's status
  is a one-byte Borsh enum change (Approved 5 → Active 1); serialized size and
  storage usage should remain unchanged. No new key or record is created.

Exact event (JSON field order insignificant):

```text
EVENT_JSON:{"standard":"disburse","version":"1.0.0","event":"campaign_activated","data":[{"campaign_id":0,"actor_id":"disburse-op-b966e36d.testnet"}]}
```

Failures include invalid/missing/out-of-range numeric arguments at ABI decoding,
nonzero deposit at the generated nonpayable wrapper, global pause, missing
explicit Operator role (`Operator role required to activate campaigns`), missing
campaign (`Campaign not found`), wrong source status, insufficient gas or
underlying runtime/storage errors. No partial on-chain mutation should survive
a failing receipt; finality and receipt outcomes must still be checked.

## Security and test evidence

By inspection of activation and `set_campaign_status` (`src/lib.rs:1446`), the
method has no input or assignment that can increase budget, change token,
creator or ownership, alter funds/reservations/spending, create payouts, transfer
tokens, create promises, change roles/allowlist/pause, modify another campaign,
or settle a payout. It preserves existing accounting; it does not validate or
repair malformed accounting. Fresh accounting validation is therefore material.

Active status enables separately authorized payout creation/reservation paths.
It does not create or authorize any payout itself. Existing role, available-fund,
payout-state and settlement-evidence checks remain intact, including the explicit
Verifier requirement for settlement. Activation must not be described as making
payouts automatic or allowing unauthenticated settlement. The API remains limited
to authenticated allowlisted GET routes; non-GET/unknown routes are denied in
active Testnet read-only mode. No signing/settlement worker or UI action was enabled.

`cargo test --locked --offline`: **98 passed**, 0 failed; doc tests passed (0).
No dependency installation or source modification was needed. Existing fixtures
run only against mocked local NEAR storage/context, not the deployed chain.

| Claim | Evidence and limits |
| --- | --- |
| Explicit Operator activates Approved; Draft rejected | `operator_activates_approved_campaign_but_not_draft` |
| Non-Operator rejected without campaign change | `non_operator_cannot_activate_campaign` |
| Unfunded activation permitted | Successful activation test uses newly created zero-funded campaign; `make_active_campaign` fixture also activates zero-funded campaigns |
| Cancelled cannot activate | `completed_and_cancelled_campaigns_cannot_transition` |
| Global pause lifecycle guard | Shared source guard; existing pause test exercises approval, not specifically activation |
| Active required for payout creation | `every_non_active_campaign_status_rejects_payout_creation` and related accounting tests |
| Exact activation event and all financial fields unchanged | Established by source; no dedicated activation event/full-field assertion in existing tests |
| Repeat activation, owner without Operator, partial-funding activation, missing activation ID | Shared guards/source reasoning; no dedicated tests for all these activation-specific combinations |

No source tests were added because this gate permits documentation-only changes.
These coverage gaps are recorded rather than presented as tested guarantees.
They do not contradict the straight-line activation implementation.

## Read-only simulation feasibility

NEAR RPC `call_function` is a view query, not a signer-context transaction
simulation. Its documented inputs do not set predecessor/signer/deposit:
[official NEAR RPC contracts reference](https://docs.near.org/api/rpc/contracts#call-a-contract-function).
The locally installed near-vm-runner 0.38.0 `logic/host.rs` explicitly rejects
`predecessor_account_id` in view mode (`ProhibitedInView`), and view mode cannot
persist storage writes. This method needs both predecessor authorization and a
write. A view failure would not prove failure of an authorized real transaction.
No such misleading live probe was attempted. Existing mocked-context tests
establish local lifecycle behavior, not a live gas estimate or full chain dry-run.

## Exact proposed transaction — DO NOT EXECUTE YET

| Field | Proposal |
| --- | --- |
| Network | NEAR Testnet |
| Signer/predecessor | `disburse-op-b966e36d.testnet` |
| Receiver | `disburse-test-contract.testnet` |
| Method | `activate_campaign` |
| Arguments JSON | `{"campaign_id":0}` |
| Attached deposit | `0` yoctoNEAR (`0 NEAR`) |
| Prepaid gas | `30000000000000` gas (`30 Tgas`) |
| Required current/next status | Approved → Active |
| Accounting and token balances | Unchanged from verified tables |
| Event | `campaign_activated`, campaign ID 0, actor Operator |

30 Tgas is a conservative proposed cap for one existing campaign read/update
plus event with no asynchronous call. It is not a measured execution estimate.
Nonce and recent block hash are intentionally absent: obtain them only after
separate approval and a repeat finalized preflight.

**Documentation only — the following command has not been executed:**

```bash
near contract call-function as-transaction \
  disburse-test-contract.testnet activate_campaign \
  json-args '{"campaign_id":0}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as disburse-op-b966e36d.testnet \
  network-config testnet sign-with-legacy-keychain send
```

Before any future signature, recheck finalized status, balances, accounting,
code/configuration, explicit Operator permission, matching key and fee balance.
Stop on drift and review again. Use one exact action and no batching. Do not
submit again on an ambiguous RPC timeout; query the known transaction hash first.

## Future separately approved execution checks

Independently fetch the submitted transaction with final execution status FINAL;
check all outcomes, exact action arguments, signer, receiver, deposit and gas.
Require one matching activation event; no NEP-141 transfer or payout event.

| Property | Before | Expected after |
| --- | --- | --- |
| Campaign status | Approved | Active |
| Budget/funded/available | 1000000 each | 1000000 each |
| Reserved/spent | 0 each | 0 each |
| Campaign count | 1 | 1 |
| Payout counter/records | 0 / none | 0 / none |
| Contract USDC | 1000000 | 1000000 |
| Operator USDC | 99000000 | 99000000 |
| All other campaign fields | Fresh baseline | Identical |

Verify wrapped accounting and token balances independently, then compare complete
storage: global STATE and all keys unchanged, only campaign 0's status byte changes
5 → 1. Code hash, storage usage, owner, global pause, all roles and token allowlist
must remain identical. Protected original state/code must be unchanged. Only the
Operator signing-key nonce and fee-related NEAR balance are expected to change.
Recheck the existing dashboard shows Active and unchanged accounting while all
mutation/settlement restrictions remain in place. Do not create a payout to test it.

## Approval boundary and remaining uncertainty

No critical preflight failed. Source/build provenance is based on the recorded
host build and current exact byte/ABI match, not a new independent hermetic build.
Local tests do not simulate live gas or every activation edge case. Finalized reads
span blocks and can become stale; the repeat preflight is mandatory after approval.
No unknown argument, role requirement or token movement remains in this proposal.

**Gate M4-A activation proposal is ready for review. No transaction has been signed or submitted. Do you approve executing this exact activation transaction?**
