> ## Documentation Index
> Fetch the complete documentation index at: https://docs.near-intents.org/llms.txt
> Use this file to discover all available pages before exploring further.

# Swap limits

> Current minimum USD sizes for 1Click chain-to-chain swaps, by chain

Chain-to-chain quotes on [`POST /v0/quote`](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request#request-token) have a USD minimum on two chains. Every other chain has none. This page is the list. When a limit changes, it is updated here.

These minimums apply when `depositType` is `ORIGIN_CHAIN` and `recipientType` is `DESTINATION_CHAIN`. Deposits into Intents and withdrawals from Intents are not subject to them.

1Click values `amount` in USD with that token's origin-chain decimals and its USD price.

* `EXACT_INPUT` uses the origin token.
* `EXACT_OUTPUT` uses the destination token.

A quote under the minimum is rejected with HTTP 400 and no quote. The response `message` is in the table.

## Minimums

| Chain | Minimum | Applies when | `message` |
| - | - | - | - |
| BNB Chain | \$1,000 | The origin token or the destination token is on BNB Chain | `Temporary swap limits: minimum swap amount is $1,000` |
| Tron | \$100 | The origin token is on Tron | `Temporary swap limits: minimum swap amount is $100` |
| ADI | None | | |
| Aleo | None | | |
| Aptos | None | | |
| Arbitrum | None | | |
| Avalanche | None | | |
| Base | None | | |
| Bera | None | | |
| Bitcoin | None | | |
| Bitcoin Cash | None | | |
| Cardano | None | | |
| Dash | None | | |
| Dogecoin | None | | |
| Ethereum | None | | |
| Fogo | None | | |
| Gnosis | None | | |
| HyperEVM | None | | |
| Hyperliquid | None | | |
| Litecoin | None | | |
| Monad | None | | |
| Movement | None | | |
| NEAR | None | | |
| Optimism | None | | |
| Plasma | None | | |
| Polygon | None | | |
| Quantus | None | | |
| Robinhood Chain | None | | |
| Scroll | None | | |
| Solana | None | | |
| Starknet | None | | |
| Stellar | None | | |
| Sui | None | | |
| TON | None | | |
| XLayer | None | | |
| XRP Ledger | None | | |
| Zcash | None | | |

An amount equal to the minimum is accepted.

A quote that clears this table can still be rejected when a bridge requires a larger token amount. That response `message` starts with `Amount is too low for bridge, try at least`.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.