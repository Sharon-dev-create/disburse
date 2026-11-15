# Milestone 3 — Gate M3-A campaign creation execution

Date: 2026-11-15 (Africa/Douala).
Repository revision: `5587363ce19742e72bf6dc4aef316dc92d372eaa`.

## A. Verdict

**PASS — exactly one campaign was created and independently verified.**
The user explicitly authorized one M3-A `create_campaign` transaction only.
No M3-B approval, funding, activation or payout transaction was signed/submitted.

[Public preflight, signed-manifest verification, finalized transaction/receipts,
postflight views and reconciliation](evidence/milestone-3/gate-a-executed.json).

## B. Preflight and transaction evidence

Read the existing Milestone 3 plan, deployed ABI evidence, Rust implementation,
Milestone 2 configuration reports and current Git status. Initial worktree had
only untracked `docs/milestone-3-testnet-funding-plan.md` and
`docs/evidence/milestone-3/`; all existing content was preserved.

Fresh finalized snapshots at blocks 277764168 onward confirmed the isolated
account exists, code hash matches, owner=`disburse-topg.testnet`, paused=false,
USDC accepted, Operator assigned, zero campaigns and a source-decoded zero payout
counter. Full application state matched the planning baseline: STATE and only the
two intended configuration records, with no campaign/payout liabilities. Operator
held 100000000 atomic USDC, isolated balance=0. Owner FullAccess key and OS-keychain
metadata/public-key retrieval matched. Native NEAR available above owner storage
backing exceeded the proposed fee requirement; no top-up was needed.

The live `__contract_abi` was queried again and its `create_campaign` definition
compared with the previously downloaded deployed ABI. `budget` is a JSON uint128
**number**. No payable modifier exists; attached deposit=0. The actual Rust method
assigns Draft status and zero financial balances internally.

| Field | Actual transaction value |
| --- | --- |
| Network | NEAR Testnet, RPC chain identity checked independently |
| Hash | `HvJQJYdoj8BEKXGkeVkv6ksd5CnKwSt6tEcWYNt5RRe9` |
| Signer | `disburse-topg.testnet` |
| Target | `disburse-test-contract.testnet` |
| Method / action count | `create_campaign` / one FunctionCall |
| Public key | `ed25519:A717NFatHs2CFEKHH7CDNNwZercpfMKnGMNUdtKsgKdC` |
| Nonce | 277468817000007 |
| Attached deposit | 0 NEAR |
| Prepaid gas | 30000000000000 gas / 30 Tgas |
| Total gas burnt | 2191816679829 gas / **2.191816679829 Tgas** |
| Final execution | FINAL; SuccessValue decodes to numeric **0** |

Exact arguments:

```json
{"title":"Disburse Milestone 3 funding verification","token_id":"usdc.tidepool-sandbox.testnet","budget":1000000}
```

[Verified transaction on Testnet Nearblocks](https://testnet.nearblocks.io/txns/HvJQJYdoj8BEKXGkeVkv6ksd5CnKwSt6tEcWYNt5RRe9).

The unsigned Borsh transaction was printed and reviewed with NEAR CLI 0.31.1 before
signing. Existing secure OS-keychain signing saved the single signed transaction
under /tmp. Independent Ed25519 verification passed, and all approved transaction
fields/action bytes matched the reviewed unsigned transaction. The CLI refreshed
only the recent block hash; its actual block was checked on Testnet before send.
No private key was exported, printed, copied or placed in arguments.

Immediately before submission, source/original state, key permission/nonce, code,
network/block and token balances were rechecked. An exclusive local submission
marker prevented repeating the attempt. Exactly one `send_tx` request was made,
with wait_until=FINAL. A separate read-only `tx` query independently verified the
actual hash, signer, target, method, argument encoding, deposit, gas and final
transaction/receipt outcomes. No failure, timeout, ambiguous outcome or retry
occurred. No second transaction was submitted.

### Finalized outcomes

| Outcome | ID | Executor | Gas burnt | Status |
| --- | --- | --- | ---: | --- |
| Transaction | Hash above | Owner signer | 314163015520 | SuccessReceiptId |
| Creation receipt | `C1MfEhLeNoRsFJYWY938zkyNqL1zAXRQUb2cKTmYzcnE` | Isolated contract | 1654471101809 | SuccessValue=`MA==` (JSON numeric 0) |
| Gas refund receipt | `CEqVXMkw6biy9c1vkqEfnSNzcv72aQ8CR6e98NKJp47T` | Owner signer | 223182562500 | SuccessValue |

All receipts succeeded. Total gas above includes transaction processing, creation
receipt and refund receipt. Total tokens_burnt across outcomes:
196863411732900000000 yoctoNEAR, or **0.0001968634117329 NEAR**. The owner's native
NEAR decrease exactly equals that amount. Deposit was zero. The gas refund
receipt has tokens_burnt=0 and does not invoke the original application's methods.

The expected creation event is the plain log **`CampaignCreated:0`**, emitted once
in the creation receipt. No NEP-297 `campaign_created` event was invented.

## C. Independently verified created campaign

Actual ID **0** was derived from the independently queried FINAL return value,
confirmed by `CampaignCreated:0`, then used for fresh `get_campaign`, funding and
accounting views. It was not selected merely because the initial count was zero.
Campaign details were queried at finalized block 277764479; full STATE after the
transaction was queried at block 277764489. Exact hashes are in the evidence.

| Field | Verified stored value |
| --- | --- |
| ID | **0** |
| Title | Disburse Milestone 3 funding verification |
| Creator | `disburse-topg.testnet` |
| Token | `usdc.tidepool-sandbox.testnet` |
| Budget | 1000000 atomic = 1 test USDC |
| Lifecycle | **Draft** |
| Funded | 0 |
| Reserved | 0 |
| Spent | 0 |
| Available | 0 |
| Remaining funding budget | 1000000 |

`get_campaign` returns raw numeric budget/financial fields; the funding/accounting
views return U128 monetary strings. Both were verified independently using exact
integer JSON decoding, with consistent values. No token funding is implied by
the approved budget or the existence of the Draft campaign.

## D. Contract integrity and balances

| Property | Before | After |
| --- | --- | --- |
| Campaign count | 0 | **1** |
| Payout counter | 0 | **0** |
| Operator USDC | 100000000 atomic | **100000000 atomic** |
| Isolated USDC | 0 | **0** |
| Owner | `disburse-topg.testnet` | Same |
| Global pause | false | false |
| USDC accepted / Operator assigned | true / true | true / true |
| Isolated code hash | `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf` | Same |

Full isolated state has exactly one new collection entry for the created campaign;
all pre-existing token/role records remain byte-identical. Source-aware STATE
decoding establishes next_campaign_id=1 and next_payout_id=0. No payout records
exist, `get_payout(0)=null`, and there are no funded/reserved/spent liabilities.
Isolated storage usage grew from 299602 to 299843 bytes (+241); its NEAR amount
remained unchanged and the additional storage backing uses its existing balance.

The protected original's full application `view_state`, code hash and storage
usage are unchanged. Its signer nonce advanced once and its NEAR balance paid
the verified fee; its access-key identity and FullAccess permission are unchanged.
It was never the target of an application/configuration action. No roles,
allowlists, pause, deployment or original application records changed.

No approval, activation, USDC transfer, campaign funding, payout, settlement,
refund or retry action occurred. No Rust, execution-service/frontend code,
read-only security setting, environment or database records were modified.

## E. Repository changes and validation

This task updated `docs/milestone-3-testnet-funding-plan.md` and added this focused
report plus `docs/evidence/milestone-3/gate-a-executed.json`. Existing preflight
files/evidence were preserved. No replayable signed transaction or private
credential material was stored in the repository. Temporary signing artifacts
stayed under /tmp. No commit or push was performed.

Validation comprised fresh finalized preflight, deployed ABI/source comparison,
CLI unsigned preview, independent transaction signature and manifest verification,
independent FINAL transaction/all receipts, three campaign/funding/accounting
views, full source-aware state comparison, exact balance reconciliation and
`git diff --check`. Application/unit test suites were not rerun because this task
changed only documentation and chain state; the prior preflight suites are
recorded separately. No future approval/funding outcome is claimed.

## F. Next gate — exact M3-B manifest, not signed or submitted

**Gate M3-B — Campaign Approval** is the next approval required.

| Field | Proposed exact value |
| --- | --- |
| Network | NEAR Testnet |
| Signer | `disburse-topg.testnet`, existing secure owner keychain |
| Target | `disburse-test-contract.testnet` |
| Method | `approve_campaign` |
| Arguments | `{"campaign_id":0}` (numeric actual verified ID) |
| Attached deposit | 0 NEAR |
| Prepaid gas cap | 30 Tgas |
| Required state | Actual campaign 0 still Draft; global contract unpaused |
| Expected state | Campaign 0 Approved; all funding/accounting values remain zero |

Expected event: `campaign_approved`, actor `disburse-topg.testnet`, campaign_id=0.
The creator may approve because the owner has implicit Administrator authority.
Before any separately approved signing, repeat identity/code/owner/permission,
Draft status, budget/token/accounting, balance and isolation checks. Approval
neither funds nor activates the campaign. M3-C requires a further separate gate.

**M3-B and M3-C remain unapproved. No M3-B transaction was constructed, signed or
submitted. STOP.**
