# Milestone 3 — real Testnet campaign funding plan

Date: 2026-11-15 (Africa/Douala).
Repository revision: `5587363ce19742e72bf6dc4aef316dc92d372eaa`.
Initial `git status --short --branch`: clean `main`, initially ahead of origin by
one commit; remote-tracking status later changed without any agent commit/push.

**Latest execution status (2026-11-15): Gate M3-B PASS — campaign 0 is Approved.**
The separately authorized creation and approval transactions finalized and were
independently verified. No funding or activation occurred. See the
[M3-B execution report](milestone-3-gate-b-execution.md) and the current M3-C
manifest at the end of this document. The preflight values
and initial planning verdict below are historical snapshots, not current empty state.
The frontend title/status integration gap remains unresolved.

## 1. Verdict and scope

**PARTIAL — chain preflight passed and the three-gate transaction plan is ready;
a small read-only API/frontend addition is needed for the complete requested
campaign title/status display.** No critical chain assumption failed. Gate M3-A
may be approved independently; frontend completion is needed before claiming the
end-to-end milestone complete. This task only audited, tested and wrote this plan
and public evidence. No application/Rust source or environment was changed.

No message or transaction was signed, and no blockchain transaction, campaign,
funding transfer, approval, activation, reservation, refund or retry was submitted.
No deployment, role, token allowlist, pause or account permission was changed.
No PostgreSQL campaign/demo rows were inserted. Dedicated database tests used
their normal isolated fixtures. No commit or push was performed.

**Initial planning stopped at M3-A. Its subsequent separately authorized M3-A/M3-B executions are recorded below. M3-C remains unapproved.**

## 2. Deployment and fresh finalized preflight

Read the Milestone 2 setup, C1/C2 report and execution evidence, recovery report
and receipts, and active read-only integration report. Fresh read-only observations
below are not assumed from those reports. RPC status independently reports Testnet.

[Preflight snapshots](evidence/milestone-3/preflight.json),
[account/token/source/export details](evidence/milestone-3/account-token-details.json),
[validated counters and NEAR headroom](evidence/milestone-3/preflight-validation.json),
[public signer-access evidence](evidence/milestone-3/signer-access.json).
Initial snapshots span finalized blocks 277762252–277762259; supplementary account,
permission, token ABI/source reads span later finalized blocks. Exact hashes are
retained in the evidence. Views were not one atomic multi-call snapshot.

| Property | Fresh verified result |
| --- | --- |
| Isolated account | `disburse-test-contract.testnet`, exists |
| Reviewed deployed code hash | `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`, matches live |
| Local WASM SHA-256 | `a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530`, matching base58 hash |
| Owner | `disburse-topg.testnet` |
| Owner application permissions | Owner=true, Administrator=true on isolated contract |
| Global pause | false |
| Accepted token | `usdc.tidepool-sandbox.testnet`, accepted=true |
| Operator | `disburse-op-b966e36d.testnet`, Operator=true; Administrator/Verifier=false |
| Campaign count / next campaign ID | 0 / 0 |
| Payout counter | 0, source-aware full STATE decode |
| Existing campaign/payout records | None; full inventory contains STATE and the two C1/C2 configuration records only |
| Campaign 0 funding/accounting; payout 0 | null / null / null |
| Isolated token balance | `0` atomic |
| Operator token balance | `100000000` atomic = 100 test USDC |
| Token metadata | USDC, 6 decimals, `Tidepool Testnet USDC (no value)` |
| Token code hash | `DgV3WsKJsGtCjNWxYzFvi599szo7oojkKXWCoGBBAHwj` |
| Isolated and Operator token storage | Both registered; total=`1250000000000000000000`, available=`0` |
| Storage bounds | min=max=`1250000000000000000000` yoctoNEAR (0.00125 NEAR), already paid |

Full isolated and original application-state values match the final C1/C2
baseline. No campaign/payout liabilities or unallocated USDC remain. Payout
absence is established by decoded `next_payout_id=0` plus complete record
inspection and matching code, not just the campaign-count view.

### Signer access — no signing performed

The supported NEAR CLI public-key commands completed successfully:

```sh
near account get-public-key from-keychain disburse-topg.testnet network-config testnet
near account get-public-key from-legacy-keychain disburse-op-b966e36d.testnet network-config testnet
```

- Owner: `ed25519:A717NFatHs2CFEKHH7CDNNwZercpfMKnGMNUdtKsgKdC`, live FullAccess.
  OS-keychain metadata maps the same account/key. Its previous independently
  verified off-chain proof is documented in Milestone 2; no new proof was signed.
- Operator: `ed25519:AWTKGeMdxfne1dnx9PoRK8ABVBegkQpisyXoyYQQu5X8`, live FullAccess.
  Existing CLI legacy credential file is topg-owned, mode 600. This is the
  supported local legacy keychain, not an OS-encrypted keychain entry. The CLI
  retrieved only its public key; no private key was exported, printed, copied
  into a script or supplied as an argument.

These establish accessible signer mappings, public-key retrieval and permissions.
They are **not a new cryptographic proof** of Operator signing in this planning
task. After the relevant gate approval, independently verify the actual signed
transaction against the pinned on-chain public key before broadcasting; stop if
signing is unavailable. Do not import/export keys to work around failure.

### NEAR fee/storage capacity

| Account | Observed NEAR amount | Available above current storage backing, approximately |
| --- | ---: | ---: |
| Owner | 9.9954829307189361 | 7.00126293 |
| Operator | 9.9983399062449612 | 9.99651991 |
| Isolated contract | 9.997589250750002699999999 | 7.00156925 |

Protocol storage backing is `10000000000000000000` yoctoNEAR/byte. The contract's
existing balance covers campaign-state growth; `create_campaign` has no payable
storage-deposit parameter. No new token registration, account creation or NEAR
top-up is proposed. Measure actual contract storage growth after creation.

Observed gas price: `100000000` yoctoNEAR/gas. Proposed caps of 30/30/100 Tgas
correspond to 0.003/0.003/0.010 NEAR of execution-gas allowance, plus protocol
action/receipt overhead and the one-yocto funding deposit. These are allowances,
not measured burn or guaranteed total fees. Recheck live prices and spendable
balances before each approved stage. Present balances have ample headroom.

## 3. Exact deployed ABI and source behavior

Independently queried the isolated contract's `__contract_abi`, decompressed its
Zstandard response and compared the relevant function definitions exactly with
`target/near/disburse_contract_abi.json`, at finalized block **277762820**.
[Deployed Disburse ABI](evidence/milestone-3/disburse-deployed-abi.json).
Its reviewed WASM also matches the live code hash. Source: `src/lib.rs`, campaign
state, role/status types, and existing lifecycle/funding tests.

| Method | Actual JSON arguments | Meaning |
| --- | --- | --- |
| `create_campaign` | `title: String`, `token_id: AccountId`, `budget: u128` | Create Draft; returns numeric u64 ID |
| `approve_campaign` | `campaign_id: u64` | Draft → Approved |
| `get_campaign` | `campaign_id: u64` | Optional campaign including title, creator, token, status and balances |
| `get_campaign_count` | `{}` | Monotonic next campaign ID / total created |
| `get_campaign_funding` | `campaign_id: u64` | Optional token/budget/funded/remaining budget, U128 decimal strings |
| `get_campaign_payout_accounting` | `campaign_id: u64` | Optional budget/funded/reserved/spent/available, U128 decimal strings |
| `activate_campaign` | `campaign_id: u64` | Approved → Active; separate explicit Operator call, **not planned** |
| `ft_on_transfer` | `sender_id: AccountId`, `amount: U128 string`, `msg: String` | Token-only callback, never manually called |

There is no separate campaign-status getter: read `get_campaign(...).status`.
The campaign token is a **plain AccountId string**, not `{Near: ...}`. That latter
shape belongs to payout TokenAmount types and must not be used here.

Creation is open to any caller while globally unpaused. Title must be nonblank
and at most 100 UTF-8 bytes; budget must be positive. The only supplied fields
are title, token_id and budget. Creator, ID, creation timestamp, Draft status and
zero funded/reserved/spent values are assigned internally. There is no description,
purpose, decimals, status or initial-balance argument.

The **budget is a JSON number**, `1000000`, not `"1000000"`. The raw Campaign
fields are u128 numbers; wrapped funding/accounting views return their monetary
fields as strings. This small amount is exactly representable, but generic
TypeScript integration must preserve u128/u64 precision rather than round it.

Approval requires Administrator; owner has implicit Administrator. The proposed
owner may create and approve its own campaign: no distinct-approver rule is
implemented. Operator permission alone is insufficient for approval. All relevant
Disburse creation/approval/activation methods are nonpayable: **attach 0 NEAR**.

IDs come from `next_campaign_id` and checked increment. Expected next ID is **0**
from current state, but that is not a future transaction input. After approved
creation, derive the actual ID from finalized return value and log, then confirm
it via `get_campaign` before preparing either later gate.

## 4. Three separate approval gates

### Gate M3-A — creation (first approval requested)

| Field | Proposed exact value |
| --- | --- |
| Network | NEAR Testnet |
| Signer | `disburse-topg.testnet` using existing OS keychain |
| Target | `disburse-test-contract.testnet` |
| Method | `create_campaign` |
| Deposit | 0 NEAR |
| Prepaid gas | 30 Tgas (chosen cap, not measured minimum) |

```json
{"title":"Disburse Milestone 3 funding verification","token_id":"usdc.tidepool-sandbox.testnet","budget":1000000}
```

Expected: a new Draft campaign; budget 1000000, funded/reserved/spent/available=0;
count 0→1 only if preflight still matches. Return value is the actual numeric ID.
Creation emits a **plain log** `CampaignCreated:<actual_id>`, not an invented
NEP-297 `campaign_created` event. Verify finalized transaction/all receipts, return
value/log, exact title/creator/token/budget/status via `get_campaign`, count and
zero funding/accounting. USDC balances must remain 100000000 / 0.

**Stop and request M3-B approval with the actual verified ID.**

### Gate M3-B — approval (not authorized by M3-A)

| Field | Proposed value |
| --- | --- |
| Signer | `disburse-topg.testnet` |
| Target / method | `disburse-test-contract.testnet` / `approve_campaign` |
| Arguments template | `{"campaign_id":<VERIFIED_CAMPAIGN_ID>}` — numeric u64 |
| Deposit / prepaid gas | 0 NEAR / 30 Tgas |
| Required / resulting state | Draft / Approved |

This is a template until the verified ID exists; reissue the exact manifest then.
Expected standard `disburse`, version `1.0.0`, event `campaign_approved`, data:
`[{"campaign_id":<VERIFIED_CAMPAIGN_ID>,"actor_id":"disburse-topg.testnet"}]`.
Verify transaction/receipts/event and `get_campaign.status=Approved`; count=1,
funded/reserved/spent/available=0 and unchanged token balances. Approval itself
neither transfers tokens nor activates the campaign.

**Stop and request M3-C approval with the actual Approved campaign and final args.**

### Gate M3-C — 1-USDC NEP-141 funding (not authorized by earlier gates)

| Field | Proposed value |
| --- | --- |
| Signer | `disburse-op-b966e36d.testnet`, existing legacy CLI keychain |
| Target | `usdc.tidepool-sandbox.testnet` |
| Method | `ft_transfer_call` |
| Token receiver | `disburse-test-contract.testnet` |
| Amount | `"1000000"` atomic |
| Memo | null |
| Deposit | Exactly 1 yoctoNEAR |
| Prepaid gas | 100 Tgas (chosen conservative cap covering callback/resolver) |

Argument template — **do not submit placeholders**:

```text
{"receiver_id":"disburse-test-contract.testnet","amount":"1000000","memo":null,"msg":"{\"campaign_id\":<VERIFIED_CAMPAIGN_ID>}"}
```

`msg` is an outer JSON **string** containing a JSON object whose campaign ID is a
numeric u64. The amount is an outer decimal **string**. Build both layers using
JSON serialization; never substitute a guessed ID or stringify the ID itself.
The executable builder below supplies this exact structure after creation.

Required immediately before funding: same code/owner/global pause/allowlist/role,
actual campaign exists and is Approved, matching token, budget=1000000,
funded/reserved/spent=0, Operator balance still 100000000, isolated token balance
still 0, both registered, sufficient NEAR. Stop on unexpected changes.

Funding leaves the campaign **Approved**, even when exactly fully funded.
Activation is not automatic. It would be a fourth explicit Operator transaction
for a later scope; it is neither needed for this funding demonstration nor
included in these approvals. Never activate before funding.

## 5. Token ABI, deposit, gas and resolver analysis

Downloaded live token `__contract_abi`, decompressed it, and parsed the downloaded
WASM export section. Both `ft_transfer_call` and private `ft_resolve_transfer`
exist. [Live token ABI](evidence/milestone-3/tidepool-token-abi.json) confirms
`receiver_id: AccountId`, `amount: string`, `memo: string|null`, `msg: string`,
payable transfer-call and private resolver. Token code/metadata match the approved
Testnet token and prior recovery baseline.

Its live `contract_source_metadata` links to the public
[Tidepool token source](https://github.com/Watchmeecryt/tidepool/blob/main/contracts/token/src/lib.rs).
The inspected wrapper delegates transfer-call and resolver to near-contract-standards;
its public lockfile pins 5.29.1. The
[referenced NEP-141 implementation](https://github.com/near/near-sdk-rs/blob/near-sdk-v5.29.1/near-contract-standards/src/fungible_token/core_impl.rs)
checks exactly one yoctoNEAR, allocates 5 Tgas to the resolver and forwards the
remaining weighted gas to the receiver. Resolver decoding failure/callback failure
is treated as unused input; refunds are bounded by receiver balance. Sender
unregistration can instead lead to burning, so keep both registrations intact.
These mechanics agree with the [NEAR FT standard](https://docs.near.org/primitives/ft/standard).

The token metadata has no reproducible-build attestation linking its deployed
bytes to a particular repository commit. Source-link review is explanatory,
not independent byte-for-byte source provenance. Actual deployed ABI/exports,
code hash, live storage/metadata and the previously approved trust in this token
are the basis of this Testnet plan. No live transfer-call was executed to benchmark
it. 100 Tgas is a conservative allocation, not a claimed exact minimum or measured
burn. Abort rather than changing the approved gas cap or deposit without review.

NEAR creates the receiver receipt with **predecessor=the token contract**, so
Disburse can authenticate the allowlisted token. The Operator is passed as
`sender_id`; it must not directly call `ft_on_transfer` or transfer tokens with
plain `ft_transfer` to fund this campaign.

Disburse validates global unpaused, allowlisted predecessor, positive amount,
well-formed numeric campaign message, existing Approved campaign, matching token,
checked addition and `new_funded <= budget`. It returns **all** input as unused
on rejection, without changing campaign accounting. This implementation accepts
all or none, not a partial top-up to fill remaining budget. Success sets funded
and emits `campaign_funded`, returning `"0"` unused. Callback event data is:

```text
[{"campaign_id":<VERIFIED_CAMPAIGN_ID>,"sender_id":"disburse-op-b966e36d.testnet","token_id":"usdc.tidepool-sandbox.testnet","amount":"1000000","total_funded":"1000000"}]
```

Inspect all token/receiver/resolver/refund receipts, not just the outer success.
Expected receiver result: `"0"` unused. Expected resolver result: `"1000000"`
used. A rejected callback can still produce an outer successful transaction after
a full refund, with `"0"` used. Never treat that as accepted campaign funding.
If partial/unexpected refund, receiver failure, missing evidence or ambiguous
status occurs, stop and reconcile actual amounts; do not automatically resubmit.

## 6. Expected accounting and custody — not executed results

All amounts below are atomic USDC units and are **expected**, not observed future
state. Before creation there is no campaign and its views return null.

| Check | After creation | After approval | After successful funding |
| --- | ---: | ---: | ---: |
| Status | Draft | Approved | Approved |
| Budget | 1000000 | 1000000 | 1000000 |
| Funded | 0 | 0 | 1000000 |
| Reserved | 0 | 0 | 0 |
| Spent | 0 | 0 | 0 |
| Available | 0 | 0 | 1000000 |
| Remaining funding budget | 1000000 | 1000000 | 0 |
| Operator token wallet | 100000000 | 100000000 | 99000000 |
| Isolated token wallet | 0 | 0 | 1000000 |
| Payout counter | 0 | 0 | 0 |

Invariants: `reserved + spent <= funded <= budget` and
`available = funded - reserved - spent`. Approval/budget is not custody evidence.
Funding changes only funded, not reserved/spent/status. Existing Rust tests cover
incremental exact acceptance, over-budget/overflow rejection without changes,
wrong token/predecessor, malformed messages, non-Approved states and global pause.
No transaction should deliberately test rejected funding in this small initial
three-gate scope.

For this single campaign and the current **zero unallocated balance**, isolated
FT custody must equal funded=1000000 after successful funding. A new unrelated
external credit, refund or balance discrepancy invalidates that simple
reconciliation: stop rather than attributing it to campaign funding. The previous
100-USDC unallocated credit was recovered and is not part of this baseline.

Keep the original protected deployment's complete application state and code
unchanged. Owner signing future A/B calls will legitimately consume owner NEAR
fees and nonces; that is distinct from its application state. No authorized
transaction targets the original contract.

## 7. Execution-service and frontend visibility

Fresh authenticated checks confirm the service remains in restricted mode at
port 4100: status=200, unauthorized status=401, absent campaign accounting/list
and payout=404, mutation/execute/retry/refund routes=403 `read_only_mode`.
[Live response evidence](evidence/milestone-3/restricted-api-preflight.json).
No protection was weakened or runtime configuration changed.

| Required information | Existing API/frontend support |
| --- | --- |
| Network, contract, code, owner, global pause, campaign count | GET `/v1/contract`; live dashboard summary |
| Campaign ID, budget, funded, reserved, spent, available, token/decimals | GET `/v1/campaigns/:id/accounting`; dashboard query and numeric campaign detail page |
| Complete campaign object/title/creator/lifecycle status | Contract `get_campaign` supports it; current API/reader/client do **not** expose it |
| Dedicated campaign funding response | Reader uses `get_campaign_funding` internally for token identity; accounting exposes required monetary fields but not the full funding object |
| Campaign directory/list | No existing campaign list endpoint; root count updates, but no new campaign row automatically appears |
| Payout total | API infers zero only with zero campaigns and matching code; with one campaign it returns null, not a fabricated zero |
| Payout details/persisted list | Existing numeric/scoped reads; no payout creation or complete chain payout directory |

After approved creation, the dashboard campaign **count** should become 1 and
`/dashboard?campaignId=<VERIFIED_CAMPAIGN_ID>` plus
`/dashboard/campaigns/<VERIFIED_CAMPAIGN_ID>` can show live budget/accounting. It
will not yet show actual lifecycle status or title, and cannot claim complete
campaign discovery. After funding, those same numeric-ID accounting reads can
show funded/available=1 USDC, reserved/spent=0. These are verification plans, not
claims that those records currently exist.

**Smallest read-only addition to finish the required display:**

1. Add a validated reader for `get_campaign` and authenticated GET
   `/v1/campaigns/:campaignId`; explicitly add only that route to the restricted
   read allowlist. No POST, signer, worker, enqueue or database writes.
2. Expose verified ID/title/creator/token/status and normalize financial values
   to strings, preferably using existing U128-wrapped funding/accounting views.
   Raw `get_campaign` monetary u128 JSON numbers require precision-safe decoding;
   do not pass large rounded JS Number values through a new generic API.
3. Add a server-only client read and render that actual title/status beside the
   existing accounting panel at the known verified numeric ID, with empty,
   not-found, unauthorized, unavailable and loading tests. A full indexer or
   paginated discovery rewrite is unnecessary for one known campaign.

No source implementation was made: this initial task is planning only. This
integration gap is why the overall verdict is PARTIAL despite passing chain
preflight. Existing read-only HTTP mode must remain enabled even during future
separately approved CLI chain writes. Do not insert synthetic database rows or
use the frontend's illustrative campaign examples as live evidence.

## 8. Exact future commands — never run before the matching approval

These commands are **documented, not executed**. CLI syntax was checked only with
`--help`. Before signing each approved gate, re-run its preconditions, obtain fresh
nonce/block hash, inspect the unsigned transaction with the supported CLI print
command and independently verify the saved signature/manifest before broadcast,
using the reviewed C1/C2 workflow. Require exactly one FunctionCall and the
manifest above. Stop if network, key, target, arguments, deposit or gas differs.
Do not let a saved signing file overwrite an earlier transaction record.

### After explicit M3-A approval only

```sh
umask 077
near contract call-function as-transaction disburse-test-contract.testnet \
  create_campaign json-args \
  '{"title":"Disburse Milestone 3 funding verification","token_id":"usdc.tidepool-sandbox.testnet","budget":1000000}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as disburse-topg.testnet network-config testnet \
  sign-with-keychain \
  --signer-public-key ed25519:A717NFatHs2CFEKHH7CDNNwZercpfMKnGMNUdtKsgKdC \
  save-to-file /tmp/disburse-m3-a-signed.json
```

This signs locally after approval but does not itself broadcast. Independently
verify and record the actual transaction hash, then submit once as below.
Verify creation/ID before requesting M3-B; **do not run the later snippets**.

### After finalized creation and separate M3-B approval

Prepare only public numeric-ID arguments, refusing placeholders or overflow:

```sh
export M3_CAMPAIGN_ID='<VERIFIED_CAMPAIGN_ID>'
M3_ID_ARGS=$(python3 - <<'PY'
import os, re, json
text = os.environ['M3_CAMPAIGN_ID']
assert re.fullmatch(r'0|[1-9][0-9]*', text), 'Set the actual independently verified ID'
value = int(text)
assert value <= 18446744073709551615
print(json.dumps({'campaign_id': value}, separators=(',', ':')))
PY
)
```

Reissue and obtain approval for the manifest containing that concrete numeric ID.
Only then:

```sh
umask 077
near contract call-function as-transaction disburse-test-contract.testnet \
  approve_campaign json-args "$M3_ID_ARGS" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as disburse-topg.testnet network-config testnet \
  sign-with-keychain \
  --signer-public-key ed25519:A717NFatHs2CFEKHH7CDNNwZercpfMKnGMNUdtKsgKdC \
  save-to-file /tmp/disburse-m3-b-signed.json
```

Independently verify/signature-check and submit once, verify Approved state and
stop before M3-C.

### After Approved state and separate M3-C approval

Using the same independently verified `M3_CAMPAIGN_ID`, create the exact two-layer
JSON arguments without floating-point conversion:

```sh
M3_FUNDING_ARGS=$(python3 - <<'PY'
import os, re, json
text = os.environ['M3_CAMPAIGN_ID']
assert re.fullmatch(r'0|[1-9][0-9]*', text)
value = int(text)
assert value <= 18446744073709551615
msg = json.dumps({'campaign_id': value}, separators=(',', ':'))
print(json.dumps({'receiver_id': 'disburse-test-contract.testnet',
                 'amount': '1000000', 'memo': None, 'msg': msg}, separators=(',', ':')))
PY
)
```

Reissue the concrete funding manifest with those exact arguments and obtain
M3-C approval. Only then:

```sh
umask 077
near contract call-function as-transaction usdc.tidepool-sandbox.testnet \
  ft_transfer_call json-args "$M3_FUNDING_ARGS" \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as disburse-op-b966e36d.testnet network-config testnet \
  sign-with-legacy-keychain \
  --signer-public-key ed25519:AWTKGeMdxfne1dnx9PoRK8ABVBegkQpisyXoyYQQu5X8 \
  save-to-file /tmp/disburse-m3-c-signed.json
```

No private key or seed is supplied to any command. No import/export operation is
included. Owner signs only A/B calls **targeting the isolated contract**; Operator
signs C **targeting the token**.

### One submission per approved gate, after independent signed-manifest checking

Use only for the currently approved stage, not as a loop. Replace the stage with
`a`, `b` or `c` only after that gate is separately approved. Record the actual
signed hash before broadcasting. A submission marker intentionally prevents an
accidental second attempt. If it exists, investigate instead of deleting it.

```sh
set -e
umask 077
export M3_STAGE='<CURRENT_APPROVED_STAGE>'
python3 - <<'PY'
import os, json
from pathlib import Path
stage = os.environ['M3_STAGE']
assert stage in ('a', 'b', 'c')
signed_file = Path(f'/tmp/disburse-m3-{stage}-signed.json')
# The exact action/target/signer/gas/deposit and signature must already be checked.
signed = json.loads(signed_file.read_text())['signed_transaction_as_base64']
marker = Path(f'/tmp/disburse-m3-{stage}-submission-started.json')
with marker.open('x') as f:
    json.dump({'stage': stage, 'authorized_attempts': 1}, f)
request = {'jsonrpc': '2.0', 'id': 'approved-m3-single-submit', 'method': 'send_tx',
           'params': {'signed_tx_base64': signed, 'wait_until': 'FINAL'}}
Path(f'/tmp/disburse-m3-{stage}-request.json').write_text(json.dumps(request))
PY
curl --fail-with-body -sS --retry 0 --max-time 60 \
  -H 'Content-Type: application/json' \
  --data-binary "@/tmp/disburse-m3-$M3_STAGE-request.json" \
  https://rpc.testnet.fastnear.com \
  -o "/tmp/disburse-m3-$M3_STAGE-submit-response.json"
```

This deliberately avoids the CLI broadcaster's possible retry behavior. A curl
exit code is **not** execution evidence. If timeout, transport error, failure or
uncertainty occurs, stop all further stages and query the recorded hash read-only.
Never sign or submit a replacement funding transfer because of a delayed response.
Signed artifacts are temporary capabilities: never copy them into documentation,
logs, source, environment files or Git.

## 9. Post-transaction verification commands and acceptance checks

### Independent finalized transaction and receipt evidence

Set real hash and signer only after the approved transaction exists:

```sh
export M3_TX_HASH='<ACTUAL_TRANSACTION_HASH>'
export M3_SIGNER='<ACTUAL_SIGNER_ACCOUNT>'
near transaction view-status "$M3_TX_HASH" network-config testnet
```

For an explicit independent finalized RPC query, prepare a **read-only** request:

```sh
python3 - <<'PY'
import os, json
from pathlib import Path
signer = os.environ['M3_SIGNER']
assert signer in ('disburse-topg.testnet', 'disburse-op-b966e36d.testnet')
request = {'jsonrpc':'2.0','id':'m3-final-read','method':'tx',
           'params':{'tx_hash':os.environ['M3_TX_HASH'],
                     'sender_account_id':signer,'wait_until':'FINAL'}}
Path('/tmp/disburse-m3-tx-read.json').write_text(json.dumps(request))
PY
curl --fail-with-body -sS --max-time 60 -H 'Content-Type: application/json' \
  --data-binary @/tmp/disburse-m3-tx-read.json https://rpc.testnet.fastnear.com \
  -o /tmp/disburse-m3-final-tx.json
```

Require `final_execution_status=FINAL`, successful transaction resolution and all
relevant receipts. Decode receipt results from base64 to distinguish unused input
from used amount; inspect `campaign_funded`, token transfer and any refund events.
Save actual receipt IDs, gas burn and finalized block evidence. Explorer links
must use only the real recorded hash; none is invented in this plan.

### Finalized campaign and accounting views

After setting the actual `M3_CAMPAIGN_ID` and building `M3_ID_ARGS` as above:

```sh
near contract call-function as-read-only disburse-test-contract.testnet \
  get_campaign json-args "$M3_ID_ARGS" network-config testnet now
near contract call-function as-read-only disburse-test-contract.testnet \
  get_campaign_funding json-args "$M3_ID_ARGS" network-config testnet now
near contract call-function as-read-only disburse-test-contract.testnet \
  get_campaign_payout_accounting json-args "$M3_ID_ARGS" network-config testnet now
near contract call-function as-read-only disburse-test-contract.testnet \
  get_campaign_count json-args '{}' network-config testnet now
near contract call-function as-read-only usdc.tidepool-sandbox.testnet \
  ft_balance_of json-args '{"account_id":"disburse-op-b966e36d.testnet"}' \
  network-config testnet now
near contract call-function as-read-only usdc.tidepool-sandbox.testnet \
  ft_balance_of json-args '{"account_id":"disburse-test-contract.testnet"}' \
  network-config testnet now
```

Also requery full `view_state` using RPC `query` with `request_type=view_state`,
`finality=final`, the exact isolated account and empty `prefix_base64`, and decode
STATE against the same source layout. Expected next campaign counter=1 and next
payout counter=0; the new campaign map record is expected, any payout record is
not. Compare the original's complete application state/code with this baseline.
Recheck the token/role/pause configuration so an unrelated change is not hidden.

### Gate-specific acceptance and stop behavior

- **A:** successful finalized ID return and `CampaignCreated:<ID>` log agree with
  `get_campaign.id`, title, creator, token, budget and Draft state. Count=1;
  all accounting=0; both token balances unchanged. Stop before B.
- **B:** finalized `campaign_approved` event with correct actor/ID plus
  `get_campaign.status=Approved`. Accounting and wallets unchanged. Stop before C.
- **C:** all transfer/receiver/resolver receipts verified; accepted amount and
  balance deltas exactly 1000000; funded/available=1000000, reserved/spent=0,
  remaining_budget=0, status still Approved, Operator=99000000, isolated=1000000,
  payout counter=0. No unexplained refund. Stop; no activation or reservation.

After C, use authenticated API accounting and the numeric frontend URLs in section
7; never put the bearer token into browser requests or a NEXT_PUBLIC variable.
Check displayed values against fresh contract views, not against mocked rows.
Verify actual lifecycle/title using the proposed read-only addition before
claiming the complete frontend outcome. No future successful result is asserted
by the passing current empty-state tests.

## 10. Tests actually run in this preflight

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | PASS |
| `cargo test --locked` | PASS: 98 tests, zero failures; zero doc tests |
| Execution-service `pnpm check` | PASS: formatting, typecheck, lint and 107 tests, including API/restricted-mode security tests |
| Node loads `.env`, spawns `pnpm test:postgres` with inherited environment | PASS: 21 tests, dedicated local `disburse_test`; no production database use |
| Frontend `pnpm typecheck` | PASS |
| Frontend `pnpm lint` | PASS |
| Frontend `pnpm test` | PASS: 16 tests, 3 files |
| Frontend `pnpm exec next build --webpack` | PASS: production build, 26 static pages generated |
| CLI public-key retrieval for both signers | PASS, matches live FullAccess keys; no signing |
| Deployed Disburse ABI comparison | PASS for all planned/read lifecycle methods |
| Token deployed ABI/export/source review | PASS for transfer-call interface, payable/private modifiers and documented mechanics; source provenance limit above |
| Finalized live chain/role/storage/balance reads | PASS |
| Authenticated API/security read-only probes | PASS: status, auth, absent records and mutation denials |
| `git diff --check` | PASS |

Rust full suite includes funding/lifecycle tests, notably
`approved_campaign_accepts_multiple_deposits_and_reports_atomic_balances`,
`deposits_exceeding_budget_or_overflowing_funded_are_rejected_unchanged`,
`only_approved_campaigns_accept_funding`,
`global_pause_returns_funding_without_changing_campaign_accounting`, and approval,
role, malformed-message and payout accounting tests. No unrelated tests changed.

PostgreSQL command, from execution-service:

```sh
node --env-file=.env --input-type=module -e 'import {spawn} from "node:child_process"; const p=spawn("pnpm",["test:postgres"],{stdio:"inherit",env:process.env}); p.on("exit",code=>process.exitCode=code??1);'
```

Backend API/PostgreSQL tests ran outside the sandbox for local socket access;
webpack used the previously verified path. The known default Turbopack worker-port
failure was not retested, because this task explicitly requires webpack. No browser
walkthrough of a funded campaign is claimed: no such campaign exists yet. Existing
Milestone 2 browser evidence was reviewed; future populated frontend verification
remains pending actual separately approved transactions and the read-only addition.

## 11. Risks, remaining work and approval request

1. Required campaign title/status display is not exposed in the current API; the
   small read-only integration described above remains to be implemented/tested.
2. Future campaign ID is unknown until creation finalizes; never pre-sign approval
   or funding using the currently expected ID 0.
3. Accessible keychain public-key mappings are verified; actual transaction
   signature verification must occur only after each matching gate approval.
4. State and fees can change. Re-run safety checks immediately before each stage;
   stop on unexpected account/code/owner/role/token/storage/balance/liability changes.
5. External token source build provenance is not independently attested; preserve
   the approved token identity and verify actual ABI, receipts, resolver and custody.
6. Never repeat a potentially completed transfer. Inspect the original hash,
   receipt results, balances and campaign state before deciding any next step.
7. Nonzero campaign count will make the generic API payout total unknown; continue
   using source-aware state decoding to verify no payouts during this demonstration.

**Original planning approval request (now executed): Gate M3-A only** — owner
`disburse-topg.testnet` calls `create_campaign` on isolated
`disburse-test-contract.testnet` with the exact title/token and numeric budget
1000000 in section 4, **0 NEAR deposit and 30 Tgas**. It creates a Draft campaign
only. No approval/funding/activation/payout or API-protection change is included.

The preceding planning task signed/submitted nothing. Its later separately
approved Gate M3-A execution is recorded next; no authorization extends to B or C.


## 12. Gate M3-A execution and historical M3-B manifest

**M3-A PASS**, executed 2026-11-15 at repository revision
`5587363ce19742e72bf6dc4aef316dc92d372eaa`. Exactly one approved creation call:
[`HvJQJYdoj8BEKXGkeVkv6ksd5CnKwSt6tEcWYNt5RRe9`](https://testnet.nearblocks.io/txns/HvJQJYdoj8BEKXGkeVkv6ksd5CnKwSt6tEcWYNt5RRe9).
Independent RPC finality and all receipts succeeded. Actual ID **0** is established
by return value, `CampaignCreated:0` and a fresh stored campaign view.

Verified campaign: title `Disburse Milestone 3 funding verification`, token
`usdc.tidepool-sandbox.testnet`, numeric budget 1000000, status **Draft**; funded,
reserved, spent and available all zero; remaining budget 1000000.
Campaign count increased 0→1; payout count remains 0. Operator token wallet
remains 100000000 atomic, isolated wallet remains 0. Owner/global pause/code
and all existing configuration records are unchanged; original application state
and code are unchanged. Owner nonce/NEAR reflect only this authorized signer fee.

[Focused execution report](milestone-3-gate-a-execution.md),
[complete public execution evidence](evidence/milestone-3/gate-a-executed.json).
Deposit=0, prepaid gas=30 Tgas; total burnt=2.191816679829 Tgas.
No approval, activation, funding or payout transaction was signed/submitted.

**Historical M3-B manifest — now authorized and executed; see section 13:**

- Network: NEAR Testnet.
- Signer: `disburse-topg.testnet`, verified secure owner keychain.
- Target: `disburse-test-contract.testnet`.
- Method: `approve_campaign`.
- Arguments: `{"campaign_id":0}` — actual independently verified numeric ID.
- Attached deposit: 0 NEAR. Prepaid gas cap: 30 Tgas.
- Expected: Draft → Approved; accounting and USDC balances unchanged;
  `campaign_approved` event with campaign_id=0 and actor=owner.

At the end of M3-A, the campaign was Draft and no M3-B transaction had yet been
constructed, signed or submitted. M3-B was subsequently separately authorized and
completed as recorded next. M3-C requires a further independent approval.


## 13. Gate M3-B execution and current M3-C manifest

**M3-B PASS**, executed 2026-11-15 at revision
`5587363ce19742e72bf6dc4aef316dc92d372eaa`. Exactly one approved
`approve_campaign({"campaign_id":0})` call, owner signer to isolated target,
0 NEAR deposit / 30 Tgas prepaid:
[`9JFTb6H7LGg3GqqAyVKa9og9D7RkCT4WmtUEx8P22EAS`](https://testnet.nearblocks.io/txns/9JFTb6H7LGg3GqqAyVKa9og9D7RkCT4WmtUEx8P22EAS).
Independent FINAL transaction, all receipts, expected `campaign_approved` event
and fresh stored campaign status establish **Draft → Approved**. Total gas burnt:
2.292367682339 Tgas.

Campaign 0 retains the exact title/token and budget 1000000. Funded, reserved,
spent and available remain zero; remaining funding budget is 1000000. Campaign
count=1; payout counter=0. Operator holds 100000000 atomic USDC; isolated holds 0.
Only the campaign status byte changed. Global STATE/configuration and unrelated
records, code, owner, pause=false, token/Operator settings and the original's
application state are unchanged. Owner native NEAR fee/nonce effects are expected.
No USDC transfer, funding, activation or payout occurred.

[Focused M3-B report](milestone-3-gate-b-execution.md),
[complete public execution evidence](evidence/milestone-3/gate-b-executed.json).

**Next: Gate M3-C, awaiting explicit separate approval. Exact proposed manifest:**

- Network: NEAR Testnet.
- Signer: `disburse-op-b966e36d.testnet`.
- Target: `usdc.tidepool-sandbox.testnet`.
- Method: `ft_transfer_call`.
- Attached deposit: exactly 1 yoctoNEAR. Proposed prepaid gas cap: 100 Tgas.

```json
{"receiver_id":"disburse-test-contract.testnet","amount":"1000000","memo":null,"msg":"{\"campaign_id\":0}"}
```

The live token ABI signature/payable modifier and numeric ID message serialization
were verified again without any funding call.
[Proposed public parameter manifest](evidence/milestone-3/gate-c-proposed-manifest.json).
Reverify Approved state, code, owner, token, role, wallet balances/storage and
signer access after M3-C approval and before signing. Require finalized receipts,
receiver/resolver acceptance and the exact 1-USDC balance/accounting changes;
never infer acceptance from outer success or automatically retry an uncertain
transfer. Funding remains a separate action and will not activate the campaign.
No M3-C transaction was constructed, signed or submitted. **STOP at M3-C.**
