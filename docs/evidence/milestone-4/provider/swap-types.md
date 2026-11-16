> ## Documentation Index
> Fetch the complete documentation index at: https://docs.near-intents.org/llms.txt
> Use this file to discover all available pages before exploring further.

# Swap Types

Every quote request includes a `swapType` that sets how the `amount` field is read and how your deposit is handled. Open the option that fits your use case below, each one has a full example request, with the highlighted lines showing what makes it different.

> [!NOTE]
>
> `slippageTolerance` is in **basis points** (`100` = 1%) across every swap type below.

> [accordion] EXACT\_INPUT — fix the amount you send
>
> You commit to sending an exact `amount` of `originAsset`; the quote returns the output you'll receive.
>
> ```json {3,8} theme={null}
> {
>   "dry": false,
>   "swapType": "EXACT_INPUT",
>   "slippageTolerance": 100,
>   "originAsset": "nep141:wrap.near",
>   "depositType": "INTENTS",
>   "destinationAsset": "nep141:usdt.tether-token.near",
>   "amount": "1000000000000000000000000",
>   "recipient": "user.near",
>   "recipientType": "INTENTS",
>   "refundTo": "user.near",
>   "refundType": "INTENTS",
>   "deadline": "2025-01-01T00:00:00.000Z"
> }
> ```
>
> `amount` is the **1 NEAR** you intend to send (in yoctoNEAR).
>
> ```json theme={null}
> {
>   "amountIn": "1000000000000000000000000",
>   "amountOut": "10000000"
> }
> ```
>
> `amountOut` is the output you'll receive for sending exactly `amount`.
>
> **Deposit handling**
>
> * Deposit **below** `amountIn` → refunded by the `deadline`.
>
> * Deposit **above** `amountIn` → swap proceeds; the excess is refunded to `refundTo`.
>
> > [!NOTE]
> >
> > The example routes through depositType `INTENTS`; `ORIGIN_CHAIN` and `DESTINATION_CHAIN` also work (see the [Quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md#request-token)). `CONFIDENTIAL_INTENTS` is also supported.

> [accordion] EXACT\_OUTPUT — fix the amount you receive
>
> You commit to receiving an exact `amount` of `destinationAsset`; the quote returns the input required. Slippage applies to the **input** side.
>
> ```json {3,8} theme={null}
> {
>   "dry": false,
>   "swapType": "EXACT_OUTPUT",
>   "slippageTolerance": 100,
>   "originAsset": "nep141:wrap.near",
>   "depositType": "INTENTS",
>   "destinationAsset": "nep141:usdt.tether-token.near",
>   "amount": "10000000",
>   "recipient": "user.near",
>   "recipientType": "INTENTS",
>   "refundTo": "user.near",
>   "refundType": "INTENTS",
>   "deadline": "2025-01-01T00:00:00.000Z"
> }
> ```
>
> `amount` is the **10 USDT** you want to end up with. The response returns `amountIn` (the input to send, with slippage baked in) and `minAmountIn` (the minimum actually needed).
>
> **Deposit handling**
>
> * Deposit **below** `minAmountIn` → refunded by the `deadline`.
>
> * Deposit **above** `amountIn` → swap proceeds; the excess is refunded to `refundTo`.
>
> > [!TIP]
> >
> > `amountIn` looks higher than `minAmountIn` by roughly your slippage. That gap is a **buffer to guarantee execution**, not a worse price — anything unused is refunded.
>
> > [!NOTE]
> >
> > The example routes through depositType `INTENTS`; `ORIGIN_CHAIN` and `DESTINATION_CHAIN` also work (see the [Quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md#request-token)). `CONFIDENTIAL_INTENTS` is also supported.

> [accordion] FLEX\_INPUT — one token, variable amount
>
> Still one known `originAsset` through one deposit address, but the deposit **amount can vary** within a band. Use it when you don't know the exact amount at quote time — for example, sweeping a wallet whose balance is still settling.
>
> ```json {3,8} theme={null}
> {
>   "dry": false,
>   "swapType": "FLEX_INPUT",
>   "slippageTolerance": 100,
>   "originAsset": "nep141:wrap.near",
>   "depositType": "INTENTS",
>   "destinationAsset": "nep141:usdt.tether-token.near",
>   "amount": "1000000000000000000000000",
>   "recipient": "user.near",
>   "recipientType": "INTENTS",
>   "refundTo": "user.near",
>   "refundType": "INTENTS",
>   "deadline": "2025-01-01T00:00:00.000Z"
> }
> ```
>
> `slippageTolerance` applies to **both** sides, so the quote comes back as a band:
>
> ```json theme={null}
> {
>   "amountIn": "1000000000000000000000000",
>   "minAmountIn": "990000000000000000000000",
>   "amountOut": "10000000",
>   "minAmountOut": "9900000"
> }
> ```
>
> **Deposit handling** (for the 1 NEAR → \~10 USDT quote above, at 1% slippage)
>
> * Deposit **0.99 NEAR or more** → swapped; you receive at least 9.9 USDT.
>
> * Deposit **above the quoted 1 NEAR** → still swapped (the quote is not a cap).
>
> * Deposit **below 0.99 NEAR** → refunded after the `deadline`, as long as the total received stays under `minAmountIn`.
>
> > [!NOTE]
> >
> > The example routes through depositType `INTENTS`; `ORIGIN_CHAIN` and `DESTINATION_CHAIN` also work (see the [Quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md#request-token)). `CONFIDENTIAL_INTENTS` is **not** supported for `FLEX_INPUT`.

> [accordion] ANY\_INPUT — collect many tokens into one
>
> Fixes **only** `destinationAsset` and `recipient` — there's no fixed origin asset, chain, amount, or up-front rate. It's a standing **deposit-and-sweep** account: set `originAsset` to `1cs_v1:any` and `amount` to `"0"`.
>
> ```json {3,5,8} theme={null}
> {
>   "dry": false,
>   "swapType": "ANY_INPUT",
>   "slippageTolerance": 100,
>   "originAsset": "1cs_v1:any",
>   "depositType": "INTENTS",
>   "destinationAsset": "nep141:usdt.tether-token.near",
>   "amount": "0",
>   "recipient": "user.near",
>   "recipientType": "INTENTS",
>   "refundTo": "user.near",
>   "refundType": "INTENTS",
>   "deadline": "2025-01-01T00:00:00.000Z"
> }
> ```
>
> **Deposit handling**
>
> * Deposits arrive in **any supported token** into an Intents account and accumulate. `depositType` must be `INTENTS` or `CONFIDENTIAL_INTENTS`.
>
> * They're periodically converted into `destinationAsset` and withdrawn to `recipient` once the pool clears a **\$1,000 USD** threshold.
>
> * Each conversion is quoted at sweep time, so there's no fixed rate when you create the quote.
>
> * The `deadline` is checked only at creation — the collector then runs **indefinitely**, so one quote keeps aggregating without being refreshed.
>
> * There are **no refunds**: a failed swap retries every 5 minutes rather than returning funds, so set `refundTo` to an address you control.
>
> > [!WARNING]
> >
> > `ANY_INPUT` is available to **authorized partners only** — requests without a valid partner are rejected. Get access via the [Partner Dashboard](https://partners.near-intents.org/). Public `ANY_INPUT` quote requests cannot contain `appFees`.
>
> > [!TIP]
> >
> > The most common use of `ANY_INPUT` is fee aggregation. For the end-to-end setup steps such as getting a collection address, wiring it into `appFees.recipient`, and tracking withdrawals, see [Fee Configuration → Fee Aggregation](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config.md#fee-aggregation).
>
> > [!TIP]
> >
> > A [reusable deposit address](https://docs.near-intents.org/integration/distribution-channels/1click-api/reusable-deposit-addresses.md) is a different `ANY_INPUT` quote. Set `destinationAsset` to `1cs_v1:original` and read `chainDepositAddresses`. The user receives the coin they sent, and can send to the same address again.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.