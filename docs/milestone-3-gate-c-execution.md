# Milestone 3C — funded campaign and dashboard verification

2026-11-15 · NEAR Testnet · PASS.
Baseline repository revision: `6f75c1eaf813c63d9beb9771743785331966c09d`.
The user's Milestone 3C request authorized execution of exactly 1 test USDC.

Campaign 0, “Disburse Milestone 3 funding verification”, received exactly
`1000000` atomic units of `usdc.tidepool-sandbox.testnet` (6 decimals).
It remains **Approved**. Funding does not activate a campaign.

## Finalized transaction

[Transaction 3gKB1YcV2Q1V1UFRgQvjedfJizEdcuTL6y7o8L6QKr5c](https://testnet.nearblocks.io/txns/3gKB1YcV2Q1V1UFRgQvjedfJizEdcuTL6y7o8L6QKr5c)

Signer: `disburse-op-b966e36d.testnet`. Receiver: token contract
`usdc.tidepool-sandbox.testnet`. Method: `ft_transfer_call`.
Deposit: 1 yoctoNEAR. Prepaid gas: 100 Tgas. Nonce: `277417983000003`.

```json
{"receiver_id":"disburse-test-contract.testnet","amount":"1000000","memo":null,"msg":"{\"campaign_id\":0}"}
```

Fresh finalized preflight checked account/code identity, owner, pause state,
Approved campaign metadata, exact budget and zero funding/reservations/spending,
token allowlist, balances, both storage registrations, campaign/payout counters,
secure Operator signer, and deployed receiver/token ABI. The isolated code hash
matched `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`.
The Operator's FullAccess public key was verified on-chain. Its CLI-signed
transaction was independently verified off-chain before a single submission.
No private key was exported or included in repository evidence.

A separate finalized transaction query verified every transaction/receipt outcome
succeeded. The receiver returned unused `"0"`; the token resolver returned used
`"1000000"`. There was one matching NEP-141 transfer and one `campaign_funded`
event. No token refund occurred. Gas burnt across outcomes was
`6839498844153` (6.839498844153 Tgas); tokens burnt totaled
`616995115665300000000` yoctoNEAR (0.0006169951156653 NEAR).
The Operator NEAR decrease reconciled to tokens burnt plus the 1-yocto deposit.

## Independent accounting reconciliation

| Value | Before | After (atomic units) |
| --- | ---: | ---: |
| Campaign budget | 1000000 | 1000000 |
| Funded | 0 | 1000000 |
| Reserved | 0 | 0 |
| Spent | 0 | 0 |
| Available | 0 | 1000000 |
| Remaining budget | 1000000 | 0 |
| Operator USDC | 100000000 | 99000000 |
| Isolated contract USDC | 0 | 1000000 |

Fresh views and independently decoded storage agree: one campaign, zero payouts.
Only the campaign's funded field changed; global contract state was unchanged.
Owner, roles, pause state, accepted token and deployed code remain unchanged.
The original `disburse-topg.testnet` contract's code, state, NEAR and key nonce
were unchanged. No deployment, upgrade, activation, payout, permission change,
additional campaign, commit or push was performed.

## Read-only dashboard integration

An authenticated GET `/v1/campaigns/:campaignId` now supplies validated real
metadata and accounting. Exact money strings come from wrapped U128 views,
avoiding precision loss in the raw Campaign JSON. Financial invariants are
validated before returning a successful response. No writer capability was added.

The overview, campaign index and numeric detail page display the real title,
Approved lifecycle and budget/funded/available 1, reserved/spent 0. The overview
selects the latest ID using the reviewed monotonic campaign counter. Errors show
unavailable states, without invented balances. The UI remains read-only, and
mutating API routes remain forbidden. Payout total is shown as unavailable because
the contract has no aggregate payout-count view; the independent storage audit
establishes zero without inventing an API result.

Local production preview: <http://127.0.0.1:3100/dashboard>.
[Verified dashboard screenshot](evidence/milestone-3/dashboard-funded.png).
The existing demo workspace label/illustrative public landing page remains;
live contract and campaign panels identify their actual Testnet data.

Validation passed:

- Backend check: formatting, typecheck, lint and 110 tests.
- Frontend typecheck, lint and 19 tests.
- Dedicated PostgreSQL integration suite: 21 tests.
- Production Next.js webpack build. The previously documented default Turbopack
  worker-port limitation remains; webpack provides the verified production build.
- Live authenticated API reads, unauthorized rejection, missing campaign 404,
  and denial of mutation/execute/retry/refund probes.
- Browser checks of overview/index/detail/query selection, missing campaign,
  disabled creation, unauthorized state and recovery to live data. No browser
  runtime exceptions or direct execution-service calls.
- Server token absent from browser requests/DOM and all 40 scanned client assets.

Public evidence: [finalized chain bundle](evidence/milestone-3/gate-c-executed.json),
[live API probes](evidence/milestone-3/campaign-api-live.json),
[browser checks](evidence/milestone-3/dashboard-browser.json), and
[client scan](evidence/milestone-3/client-secret-scan.json), and
[final read-only recheck](evidence/milestone-3/final-read-only-snapshot.json).
The chain bundle omits signatures/signed transaction blobs. The views are
finalized reads at recorded heights, not a single atomic cross-contract snapshot.
Their deltas, events and successful receipt resolution independently reconcile.
