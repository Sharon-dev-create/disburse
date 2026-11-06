# Funding Control Feasibility Spike

**Status:** local-only investigation and simulation; no wallet connection, private key, signer, contract, deposit, or broadcast is used.

## Decision

**NO-GO for production funding through 1Click today.** The quote is a pricing/execution instruction, not a source-wallet debit limit. The current official API docs explicitly say deposits greater than `amountIn` are processed and excess is refunded after the swap. A refund after receipt cannot prevent an oversized transfer from leaving the treasury.

**GO for the isolated policy-gate design as a production architecture to validate chain by chain.** Require a chain-specific transaction builder and a separate restricted signing authority that decodes the final unsigned transaction and enforces the quote, network, asset, destination, source amount, fee budget, expiry, and idempotency policy before producing a signature. The application must never possess an unrestricted key capable of bypassing that authority. The code in this spike is simulation only and does not provide that isolation.

There is no universal multi-chain enforcement primitive. Enable funding only for `(chain, asset, wallet, transaction shape)` combinations with a tested adapter and a signer policy that can enforce and independently verify their semantics. Other routes remain disabled.

## Existing Disburse surface

The backend requests and validates quotes in `src/intents/oneclick.client.ts`, persists the response in `Attempt`, reserves `maxAmountIn` in the budget service, and reads provider status through `src/intents/status.service.ts`. `PayoutOrchestrator` persists a committed quote and deposit address. There is currently no source-chain transaction builder, private-key holder, signing path, deposit submission, or broadcast path in this repository. `maxAmountIn` is the application’s name for the returned `amountIn`; it is not an on-chain or provider-enforced maximum.

## Findings from official 1Click documentation and SDK

Reviewed on 2026-11-06. The currently published docs and generated SDK model are linked below. Their field descriptions and deposit rules should be rechecked before implementation because provider APIs can change.

| Term | Published behavior | Funding-control implication |
|---|---|---|
| `EXACT_INPUT` | Fixes the intended source `amount`; quote returns output. Deposits above `amountIn` are processed and excess is refunded. | The quote does not reject excess or cap a source transaction. |
| `EXACT_OUTPUT` | Fixes destination `amountOut`; input-side slippage is applied. Response fields are `amountIn` (proposed input with buffer) and `minAmountIn` (minimum input required). | The current API and TypeScript SDK model do not expose `maxAmountIn`. Even the proposed `amountIn` is not a debit limit. |
| `amountIn` | For exact output, the proposed input includes a slippage buffer. Deposits above it are still processed and excess is refunded after the swap. | It is a quote amount and internal budget ceiling only. Refund behavior is recovery, not prevention. |
| `minAmountIn` | Minimum input needed for the quoted exact output; below it, funds are refunded by the quote deadline. | This is a lower bound for execution, not a spending ceiling. |
| `depositAddress` | Destination for the source-chain transfer, or a NEAR Intents account depending on `depositType`; some routes need a memo. Confidential Intents uses a signed transfer intent and does not support direct token transfer. | Address selection does not itself encode a per-transaction maximum. A memo/network mismatch can strand funds. |
| `deadline` | Quote lifecycle boundary. The SDK model warns that the deposit address can become inactive and funds may be lost; `timeWhenInactive` is separately described as the point after which processing slows. | Do not treat deadline as a chain-level transfer lock or automatic refund guarantee for a late transfer. |
| Fees | `appFees` are input-token basis points. For exact output fees increase required gross input. `refundFee` is denominated in origin asset; `withdrawFee` in destination asset and is accounted for in final `amountOut`. | Native network gas may be another asset. A source debit policy must budget transfer amount and fees by asset; do not infer gas coverage from the quote. |

The user's premise that the current exact-output response has `minAmountIn` and `maxAmountIn` does not match the current generated TypeScript `Quote` model or current docs: those list `amountIn` and `minAmountIn`, with no `maxAmountIn`. This spike treats the current published API as authoritative and does not invent a `maxAmountIn` guarantee.

Primary references:

- [1Click quote API reference](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote)
- [Swap types and deposit-overage behavior](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types)
- [Official generated TypeScript SDK `Quote` model](https://github.com/defuse-protocol/one-click-sdk-typescript/blob/main/src/models/Quote.ts)
- [Official TypeScript SDK repository and usage](https://github.com/defuse-protocol/one-click-sdk-typescript)
- [1Click fee configuration](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config)
- [Supported chains and signing standards](https://docs.near-intents.org/resources/chain-support)
- [Status API](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status)
- [Optional deposit transaction-hash submission](https://docs.near-intents.org/api-reference/oneclick/submit-deposit-transaction-hash)

The SDK submits a transaction hash only as an optional notification to accelerate provider detection. It is not a signing or transaction-construction policy. The API’s status response is useful operational evidence, but a funding control should verify the transaction from the source chain independently rather than trusting a provider status or a submitted hash alone.

## Threat model

| Failure | Risk | Required control |
|---|---|---|
| Deposit exceeds authorized maximum | More source funds leave treasury than budgeted; provider may process and refund surplus later. | Decode the final transaction in an isolated signer policy and reject above-cap transfers before signature. Add chain-level vault controls where a stronger boundary is needed. |
| Duplicate deposit submission | Duplicate source transfer, or duplicate handling after timeout/restart. | Durable unique idempotency record keyed by payout attempt and quote. Claim once before signing; after uncertain broadcast, inspect chain before any retry. Do not rely on undocumented provider API idempotency. |
| Wrong asset or network | Funds can be lost or sent to an incompatible address. | Bind chain ID, token contract/mint, recipient, memo/tag, source account, and quote ID into policy. Verify these fields from the decoded transaction and chain receipt. |
| Deposit to expired quote | Address may be inactive and funds may be lost or delayed. | Check quote and `timeWhenInactive` before signing; signer enforces expiry too. If already broadcast, expiry does not cancel it: retain exposure and reconcile. |
| Fees cause underfunding | Input after fees/gas falls below quote minimum; exact output may not execute. | Model provider/app fees and each chain’s fee asset separately; cap fee fields. Do not silently subtract gas from `amountIn`. Re-quote if source debit cannot meet the minimum. |
| Broadcast but confirmation delayed | Retrying can send twice; releasing reservation can permit overspend. | Persist tx intent/hash as soon as known, poll independent source-chain RPC/indexer, and keep exposure reserved until conclusive evidence. |
| Provider status conflicts with chain | False success/refund may incorrectly release exposure or mark payout paid. | Treat provider status as a hint. Verify source transfer, destination settlement and refund hashes/amounts/finality independently before accounting transitions. |
| Worker restarts unresolved | Lost in-memory idempotency permits duplicate signing or retry. | Persist funding intent, idempotency key, unsigned-tx fingerprint, signer request ID, tx hash if known, and state before crossing signer/broadcast boundaries. Recover from journal; unknown remains exposed. |

## Funding-control options

| Approach | Enforceability | Coverage | Signing authority | Complexity and recovery | Main assumption |
|---|---|---|---|---|---|
| 1Click quote and excess refund | No hard outgoing cap; refund occurs after receipt. | All 1Click routes, but not as prevention. | Existing wallet still constructs/signs transfer. | Low integration cost; refund can be delayed, partial, fee-reduced, or uncertain. | Provider successfully returns surplus. |
| Application builds exact transfer and checks amount | Rejects a buggy proposal in the checked code path. | Any chain for which a correct transaction builder exists. | App/wallet controls signing. | Moderate; chain-specific decoding and fee calculation. Easy to bypass if compromised app has key or direct signer access. | All signatures pass through that exact process. |
| Token allowance | Caps token pull by approved spender in compatible token contracts. Not applicable to a direct `transfer` into a 1Click deposit address. | Token-specific; common on EVM, but nonstandard tokens differ. | Owner signs approval; spender/contract later pulls. | Allowance cleanup/revocation and cumulative-spend handling required. | A pull-based integration exists and token honors standard allowance semantics. |
| Smart-contract wallet/vault/guard | Strong on-chain cap when every transfer is forced through immutable/audited policy. | Only chains/assets where a suitable account/program can control the funds and the receiving flow supports it. | Contract-controlled account, multisig, or module authority. | High; audits, deployment, upgrades, gas, recovery and bypass paths must be reviewed. EOA owner must not retain unrestricted bypass authority. | No alternate key/path can move treasury funds outside the guard. |
| Wallet/custody policy signer | Can reject parsed transaction above caps before signing, independent of application logic. | Provider/wallet-specific chain and transaction coverage; must be certified per asset and operation. | Restricted HSM/MPC/custodian signing authority; app has no raw key. | Medium/high; transaction parsing, fee controls, policy deployment, audit trail, nonce/retry and outage recovery. | Policy engine is isolated and all key use is mediated by it. |
| Chain-specific transfer adapter + isolated signer (selected) | Exact transfer fields checked at signer boundary; optionally stronger on-chain vault enforcement. | Explicit allowlist only; no universal adapter. | Restricted signer policy, hardware wallet or audited vault. | Moderate per chain; unsupported transaction shapes fail closed. Independently verify finalized chain evidence. | Adapter decodes the actual signed payload, not only caller-provided intent metadata. |

Direct token transfer amount can be encoded exactly (for example, ERC-20 `transfer`, SPL token transfer, or NEP-141 `ft_transfer`), but that is not an independent control if an application with the key can construct another transaction. EVM native value and gas, token calldata and approvals, Solana instruction sets/compute fees, NEAR action batches/gas, and UTXO inputs/change/fees have different semantics. A universal “amount” field cannot safely normalize them.

## Selected production architecture (not implemented here)

Define a `ChainFundingAdapter` per chain family and specific supported asset that can:

1. Build unsigned transactions from a persisted, immutable funding intent.
2. Decode the final unsigned/signer payload and report actual chain, source, token, destination, amount, memo/tag, and fee fields.
3. Declare capabilities explicitly: exact amount enforcement, token/network allowlist, max fee semantics, expiry support, duplicate/nonce semantics, and independent finality verification.
4. Reject unsupported actions, approvals, multicalls, extra instructions, unrecognized fields, stale quotes, and amounts beyond policy.
5. Verify transaction inclusion and finality through a read-only chain source. A transaction hash alone is not proof of successful transfer; verify receipt/output and token transfer event or chain-native equivalent.

Disburse should persist a unique funding intent and reserve its maximum before signer access. A separate policy signing service re-parses the transaction, compares it with persisted policy, and only then requests HSM/MPC signing. Persist the signer request ID and transaction hash. Never retry a timed-out signing or broadcast request blindly. On timeout, query signer and chain; maintain `UNKNOWN` and full reserved exposure until transaction presence, actual debit, or definitive non-broadcast is proven. `POST /v0/deposit/submit` is an optional provider notification after broadcast and must not be treated as the broadcast itself.

### Chain and asset enablement

1Click currently lists EVM networks and tokens, Bitcoin-family networks, NEAR, Solana, Stellar, Sui, TON, Tron, XRP and others. That is provider-route support, **not** proof that Disburse’s signer can enforce a cap on every route. Each production adapter must specify source transaction types and assets it parses. Initial enablement should be a short list (for example, one ERC-20 on one EVM chain) after signer-policy and evidence tests; native coins, UTXO chains, account-based chains, and other token programs need separate adapters. Query 1Click’s live token endpoint as part of allowlist refresh; never infer token support from chain support alone.

## Local-only proof of concept

`src/funding-control/funding-control-poc.ts` contains a simulated chain adapter, a pre-sign policy gate, idempotency journal and independent evidence verifier. It constructs a canonical unsigned simulated transfer, rejects amounts over policy, prevents a second submission claim (including after service reconstruction with the same journal), verifies simulated chain evidence, and retains full exposure for unknown outcomes. It does not create signatures, send RPC requests, call 1Click, or broadcast.

The simulation proves application behavior and test coverage only. Its in-memory journal is not durable across a real process; production must use a database-backed journal with uniqueness and transactional claims. Its simulated verifier does not prove actual chain finality. The test suite must not be represented as certification of any real chain or wallet.

## Acceptance answers

1. **What prevents an oversized deposit from being broadcast?** Nothing in 1Click. In the proposed production design, an isolated signer policy rejects it before signature creation; the simulation checks decoded fields at that boundary.
2. **Where is the maximum enforced?** After building and decoding the final unsigned transaction, immediately before the isolated signing authority releases a signature. Application-only checks are insufficient.
3. **Can a compromised application bypass it?** Yes, if it has the key or can invoke an unrestricted signer. No, only if every key path is gated by an independent signer/vault policy and the application cannot bypass it. A compromised policy signer remains in scope.
4. **How is actual transfer verified?** Read-only source-chain evidence: canonical transaction/receipt, chain ID, sender, token/mint, destination, amount, memo/tag, fees and required finality. Provider status is cross-checked, not substituted.
5. **What if outcome is uncertain?** Persist `UNKNOWN`, block retries/new attempts, and retain reserved exposure. Recover by querying the signer and chain; do not infer failure from timeout.
6. **Which chains/assets are safe?** None are production-enabled by this spike. Enable only individually tested adapter and signer-policy combinations. There is no universal multi-chain guarantee.

## Verification

Run `pnpm exec vitest run tests/unit/funding-control-poc.test.ts` for the local PoC checks. The project-wide build and test suite should also be run before merging. No live quote, signer, private key, transaction submission, contract deployment, or broadcast is required or permitted for this spike.
