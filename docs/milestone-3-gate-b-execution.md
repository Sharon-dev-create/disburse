# Milestone 3 — Gate M3-B campaign approval execution

Date: 2026-11-15 (Africa/Douala).
Repository revision: `5587363ce19742e72bf6dc4aef316dc92d372eaa`.

## A. Verdict

**PASS — one campaign approval was submitted and independently verified.**
Campaign **0** transitioned **Draft → Approved**. No funding or activation occurred.
Authorization was limited to one `approve_campaign` call; no additional
blockchain transaction was signed or submitted in this task.

[Public preflight, exact manifest, independent FINAL transaction/receipts,
postflight and integrity evidence](evidence/milestone-3/gate-b-executed.json).

## B. Fresh preflight, source/ABI and signer verification

Reviewed the funding plan, verified M3-A report/evidence, actual Rust
`approve_campaign`, its generated/deployed ABI, status enum and lifecycle tests.
Source requires globally unpaused, an Administrator caller and a Draft campaign.
The owner is implicitly Administrator; the same owner may approve its own campaign.
The method takes a numeric u64 `campaign_id`, is nonpayable, sets Approved and
emits `campaign_approved`. Approval does not fund or activate the campaign.

Fresh finalized snapshots starting at blocks 277769374–277769402 confirmed:

- Isolated account/code hash/owner match the reviewed deployment; paused=false.
- USDC accepted and Operator assigned; both token registrations remain present.
- Campaign count=1 and source-decoded payout counter=0, with no payout records.
- Fresh `get_campaign(0)` exactly matches the verified M3-A stored Draft campaign:
  correct title/token/budget 1000000, creator and timestamp; financial fields=0.
- Funding/accounting views confirm zero funded/reserved/spent/available.
- Operator wallet=100000000 atomic USDC; isolated wallet=0.
- Complete isolated and original application-state values match M3-A baseline.
- Owner native NEAR above current storage backing is sufficient; no top-up needed.

The OS-keychain item metadata and CLI public-key retrieval match live FullAccess
key `ed25519:A717NFatHs2CFEKHH7CDNNwZercpfMKnGMNUdtKsgKdC` for
`disburse-topg.testnet`. A live `has_role` read confirms Administrator=true.
Private keys were not exported, printed, imported or copied into scripts/arguments.

Downloaded the live Disburse `__contract_abi` again; `approve_campaign` exactly
matches the reviewed ABI, including numeric ID and no payable modifier. The CLI's
Testnet RPC network/genesis was independently checked against the submission RPC.

## C. Actual transaction and finalized receipts

| Field | Actual value |
| --- | --- |
| Network | NEAR Testnet |
| Hash | `9JFTb6H7LGg3GqqAyVKa9og9D7RkCT4WmtUEx8P22EAS` |
| Signer | `disburse-topg.testnet` |
| Target | `disburse-test-contract.testnet` |
| Method | `approve_campaign` |
| Arguments | `{"campaign_id":0}` — numeric ID |
| Attached deposit | 0 NEAR |
| Prepaid gas | 30000000000000 gas / 30 Tgas |
| Total gas burnt | 2292367682339 gas / **2.292367682339 Tgas** |
| Nonce | 277468817000008 |
| Final execution | FINAL, SuccessValue |

[Verified transaction on Testnet Nearblocks](https://testnet.nearblocks.io/txns/9JFTb6H7LGg3GqqAyVKa9og9D7RkCT4WmtUEx8P22EAS).

The unsigned transaction was printed/reviewed before secure-keychain signing with
NEAR CLI 0.31.1. It contained exactly one FunctionCall with the approved fields.
The saved signature was independently verified with Ed25519; all signed fields
matched the reviewed unsigned transaction except the CLI's fresh recent block
hash, independently verified on Testnet before broadcast.

Final pre-submission checks reconfirmed state, code, public-key nonce/permission,
network, block and USDC balances. The single signed transaction was submitted
once through `send_tx` with wait_until=FINAL. A separate read-only `tx` request
independently confirmed the final status, exact transaction and all receipt
outcomes. No uncertain transaction was retried.

| Outcome | ID | Executor | Gas burnt | Status |
| --- | --- | --- | ---: | --- |
| Transaction | Hash above | Owner signer | 309633062595 | SuccessReceiptId |
| Approval receipt | `3iCEaPjREPs215EGfVFLQ8GetJAyVuioVRiouFMWQ2XL` | Isolated contract | 1759552057244 | SuccessValue |
| Gas refund receipt | `6B6re5LxjkonpUWRsdL1u92DcRCtT9XqX5yRgrybbvhJ` | Owner signer | 223182562500 | SuccessValue |

All receipt outcomes succeeded. Total gas includes transaction processing and
both receipts. Total tokens_burnt=206918511983900000000 yoctoNEAR
(**0.0002069185119839 NEAR**), exactly matching the owner's native NEAR decrease.
The gas refund receipt has tokens_burnt=0; it is protocol fee accounting, not a
payout/token refund or original-contract application call.

Exact emitted event:

```json
{"standard":"disburse","version":"1.0.0","event":"campaign_approved","data":[{"campaign_id":0,"actor_id":"disburse-topg.testnet"}]}
```

### Environment observation

The first attempt to start the submission command was rejected because automatic
permission review did not finish before its deadline. The response explicitly
permitted one retry. Process creation had not occurred; checks confirmed no
submission marker, response or immediate-preflight output existed. The permitted
command-launch retry then ran, completed its fresh checks and made **one actual
RPC transaction submission**. There was no second chain attempt or re-signing.
This was an execution-environment review timeout, not a failed/uncertain chain
transaction. The transaction itself finalized normally on its only submission.

## D. Independently verified campaign and integrity

Fresh campaign view at finalized block **277770580** confirms stored status
Approved. Full isolated state was independently read at block **277770588**;
exact hashes and all view responses are retained in the public evidence.

| Property | Before | After |
| --- | --- | --- |
| Campaign ID | 0 | **0** |
| Title | Disburse Milestone 3 funding verification | Same |
| Token | `usdc.tidepool-sandbox.testnet` | Same |
| Budget | 1000000 atomic / 1 test USDC | Same |
| Lifecycle | Draft | **Approved** |
| Funded | 0 | **0** |
| Reserved | 0 | **0** |
| Spent | 0 | **0** |
| Available | 0 | **0** |
| Remaining funding budget | 1000000 | **1000000** |
| Campaign count | 1 | **1** |
| Payout counter | 0 | **0** |
| Operator token wallet | 100000000 atomic | **100000000 atomic** |
| Isolated token wallet | 0 | **0** |
| Owner | `disburse-topg.testnet` | Same |
| Global pause | false | false |
| USDC accepted / Operator assigned | true / true | true / true |
| Isolated code hash | `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf` | Same |

The complete stored Campaign object is byte-for-byte equivalent in all decoded
fields except status. Full state key inventory is unchanged. The only changed
record is the campaign record; its sole byte difference is the CampaignStatus
Borsh discriminant **0 (Draft) → 5 (Approved)**, verified against the actual enum
layout. Global STATE, configuration records and all unrelated values are
byte-identical. Source-aware global decoding still gives campaign counter=1 and
payout counter=0; `get_payout(0)=null`. No new records or payout liabilities exist.
Funding/accounting views remain identical zero-valued balances.

The original protected contract's full application state, code hash and storage
usage are unchanged. Owner FullAccess identity/permission are unchanged; nonce
advanced once and NEAR paid only the verified approval fee. No transaction
function call targeted the original protected contract. Both token balances and
storage registrations remain unchanged; token metadata still has six decimals
and its deployed code hash matches the prior reviewed token. No USDC moved.

## E. Repository changes and validation

Updated `docs/milestone-3-testnet-funding-plan.md`; added this focused report,
`docs/evidence/milestone-3/gate-b-executed.json` and
`docs/evidence/milestone-3/gate-c-proposed-manifest.json`. The latter is a public
parameter manifest only, not an unsigned/signed blockchain transaction.
All pre-existing untracked M3-A/planning evidence and documents were preserved.
No application/Rust source, read-only mode/security setting, environment, role,
allowlist, pause, account permission or database record changed. No commit/push.
No replayable signed transaction blob or secret was stored in the repository.

Validation used live preflight/ABI/permissions, unsigned CLI inspection,
independent manifest/signature verification, separate FINAL transaction/all
receipt checks, approval event, exact before/after stored campaign and Borsh state
comparison, zero-accounting/wallet reconciliation and `git diff --check`.
No application test suite was rerun for this documentation/chain-only execution;
the existing lifecycle tests were inspected, not represented as newly run.

## F. Next gate — exact M3-C manifest, awaiting separate approval

The token's live `__contract_abi` was queried again, decompressed, and its
`ft_transfer_call` signature/payable modifier compared exactly with the previously
reviewed deployed ABI. The callback expects `msg` to be a JSON **string** encoding
one numeric campaign ID; Disburse's strict funding message parser accepts that
shape. JSON serialization below was independently checked to decode back to
numeric campaign_id=0.

| Field | Proposed exact value |
| --- | --- |
| Network | NEAR Testnet |
| Signer | `disburse-op-b966e36d.testnet` |
| Target | `usdc.tidepool-sandbox.testnet` |
| Method | `ft_transfer_call` |
| Receiver | `disburse-test-contract.testnet` |
| Amount | `"1000000"` atomic / 1 test USDC |
| Attached deposit | Exactly 1 yoctoNEAR |
| Proposed prepaid gas cap | 100 Tgas |

Exact proposed arguments:

```json
{"receiver_id":"disburse-test-contract.testnet","amount":"1000000","memo":null,"msg":"{\"campaign_id\":0}"}
```

`amount` and `msg` are strings; the campaign ID inside the decoded message is a
number. The one-yocto requirement and resolver behavior were reviewed in the
funding plan's deployed-token ABI/source analysis. The 100-Tgas cap is a proposed
conservative allowance, not a measured minimum or approval to raise it silently.

Only after explicit M3-C approval: recheck the actual campaign is still Approved,
correct code/owner/token/role/unpaused, budget=1000000 and all financial fields=0,
both registrations and the Operator key/NEAR/token balance. Funding must target
the token and reach Disburse through its authenticated token callback, not plain
ft_transfer or a direct callback invocation. Inspect transfer, receiver and
resolver/refund receipts plus exact balances and accounting before declaring
accepted funding. Expected success would leave campaign **Approved**, with
funded/available=1000000, reserved/spent=0, Operator=99000000 and isolated=1000000.
Those are future expectations, not results of this task. Activation is excluded.

**No M3-C transaction was constructed, signed or submitted. STOP pending explicit
funding approval.** The read-only frontend title/status addition identified in
the planning report remains separate and was not implemented here.
