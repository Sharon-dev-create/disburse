# NEAR Intents 1Click quote integration

Research checked **7 November 2026** against the current published 1Click OpenAPI document and NEAR-maintained integration material linked below. The remote OpenAPI file was fetched for schema inspection; no quote request was sent. API behavior and route availability can change, so the published specification must be rechecked before enabling a future deposit flow.

## Status

- **PASS** — deterministic `dry: true` quote adapter and response validation implemented.
- **PASS** — provider-neutral opportunity types are separate from execution jobs and contract state.
- **BLOCKED** — Disburse payout snapshots contain no origin-chain refund address; 1Click requires `refundTo` even for a dry quote. A future explicit refund policy/input is required.
- **BLOCKED** — an uncommitted dry quote is not a locked execution offer and lacks a provider expiry in its response. It cannot authorize campaign spending or prove final output.
- **NOT TESTED** — live 1Click quote request. All adapter behavior was tested with deterministic mock HTTP responses.
- **NOT IMPLEMENTED** — deposit creation (`dry: false`), deposit submission, status polling, signing, execution and settlement.

## Architecture and roles

NEAR Intents describes an intent/verifier model in which signed intents can be matched and executed atomically by the on-chain verifier contract. The broader cross-chain execution service also depends on chain-specific bridge infrastructure, market makers/solvers, liquidity, and routing. The on-chain verifier's atomic guarantees apply to the operations it verifies; they do not by themselves prove that an external destination-chain transfer happened.

This adapter targets the 1Click REST distribution API, which abstracts route discovery and solver coordination. Its documented lifecycle is:

```mermaid
sequenceDiagram
    participant D as Disburse service
    participant C as 1Click API
    participant S as Solvers / route infrastructure
    participant O as Origin chain
    participant X as Destination chain
    D->>C: GET /v0/tokens (future allowlist refresh)
    D->>C: POST /v0/quote, dry=true (implemented preview)
    C-->>D: Quote preview; no deposit address or provider deadline
    Note over D,C: This milestone stops here. It does not create an order or move funds.
    D->>C: POST /v0/quote, dry=false (future, not implemented)
    C-->>D: Deposit address and quote details
    D->>O: Deposit (future, not implemented)
    D->>C: POST /v0/deposit/submit (optional notification, future)
    C->>S: Route and execute swap (provider lifecycle)
    S->>X: Destination transfer
    D->>C: GET /v0/status (future polling)
```

The committed quote/deposit path is materially different from the implemented dry preview. Per the OpenAPI description, `dry: true` does not generate a deposit address or initiate the swap; `dry: false` returns a deposit address. The committed path requires a separate risk review and explicit authorization in a later milestone.

## API, authentication, and schema

The published OpenAPI server is `https://1click.chaindefuser.com`.

| Operation | Purpose | Adapter status |
| --- | --- | --- |
| `GET /v0/tokens` | Current supported asset catalog, including `assetId`, `decimals`, `blockchain`, and symbol | Not called by the adapter; IDs/decimals must be reviewed and allowlisted out of band |
| `POST /v0/quote` | Quote request with `dry`, swap type, assets, atomic `amount`, `refundTo`, and `recipient` | Implemented only with `dry: true` and `EXACT_OUTPUT` |
| `POST /v0/deposit/submit` | Optional notification of an already submitted origin transaction | Not implemented or called |
| `GET /v0/status` | Status by deposit address (memo is needed when returned) | Not implemented or called |

The OpenAPI `QuoteRequest` requires `dry`, `swapType`, `slippageTolerance`, `originAsset`, `depositType`, `destinationAsset`, `amount`, `refundTo`, `refundType`, `recipient`, `recipientType`, and `deadline`. The adapter requires a future `deadline` from its caller and passes it through; it does not invent a payout/refund timing policy. The dry response specifically omits a provider deadline, so the request deadline is not reported as a quote expiry.

The OpenAPI declares `X-API-Key` and legacy bearer JWT security for quote requests. The adapter requires an API key and sends it as `X-API-Key`. NEAR-maintained agent integration notes also describe unauthenticated quotes with a different fee schedule; this conflicts with the published OpenAPI security declaration. The implementation follows the explicit OpenAPI security scheme. Exact partner fees, rate limits, and whether unauthenticated previews remain enabled are **UNKNOWN** here. HTTP 429 is normalized if returned, with `Retry-After` parsed when numeric; the client does not retry automatically.

The quote response schema contains `correlationId`, `timestamp`, `signature`, `quoteRequest`, and `quote`. The quote amounts are integer strings (`amountIn`, `minAmountIn`, `amountOut`, `minAmountOut`); USD and formatted values are display fields and are never used. `refundFee` is denominated in the origin asset; `withdrawFee` is denominated in the destination asset and the spec says it is already reflected in `amountOut`. The dry request does not provide a provider `deadline`, so adapter `expiresAt` is `null`; `freshUntil` is a local cache freshness policy, not a provider expiry or quote reservation.

Published status values include `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `INCOMPLETE_DEPOSIT`, `REFUNDED`, and `FAILED`. Status tracking is deliberately outside this quote-only adapter. A provider status, including `SUCCESS`, would remain a provider claim requiring independent destination-chain verification.

The OpenAPI currently lists a broad set of blockchain keys for token metadata. This does not establish that every token/route is executable at every moment. Route support is dynamic; only exact `assetId` mappings curated from the token catalog and separately approved for Disburse may be used. Asset IDs are chain-specific. Catalog decimals are untrusted provider metadata until checked against a trusted source; the adapter requires operator-configured decimals and does not use provider-returned decimals for payout arithmetic.

The API schema accepts chain-specific recipient strings and says format must match `recipientType`; it does not define one universal recipient format. This adapter checks non-empty addresses and requires exact echoed recipient equality. Chain-specific syntax validation remains an integration responsibility and is a **BLOCKED** requirement before production use.

## Disburse compatibility and quote acceptance

Disburse settlement authorizes exactly the payout's configured output token and atomic output amount, recipient, and destination chain. The provider-neutral quote request carries the original input and expected output `TokenAmount`s, source/destination network IDs, recipient, and an explicit refund address. The adapter:

1. Resolves exact allowlisted source/destination asset IDs from token and network mappings.
2. Requires trusted configured decimals to match both payout amounts.
3. Requests `EXACT_OUTPUT` with the requested expected-output atomic amount and `dry: true`.
4. Checks the provider echo for dry mode, swap type, assets, amount, recipient, and refund address.
5. Requires quote correlation ID, signature field, timestamp, valid positive u128-range atomic amounts, valid fee strings, and nonnegative time estimate.
6. Requires `amountOut` to equal the exact payout amount and `minAmountOut` to be at least that exact amount.
7. Requires quoted `amountIn` (the OpenAPI's proposed input amount, with slippage tolerance baked in for EXACT_OUTPUT) not to exceed the reserved input amount; it also checks `minAmountIn <= amountIn`. OpenAPI does not expose a separately named maximum input for this mode, so `maximumInputAtomicAmount` remains null in the neutral model.
8. Returns a provider-neutral `ExecutionOpportunity` with raw atomic strings and a local freshness limit. Provider-specific signature bytes are not exposed as independently verified evidence.

The official schema documents `EXACT_OUTPUT` as a supported swap type: output is fixed, while the input side includes a slippage range and any excess may be refunded. Thus, **PASS as a quote-request capability**, but **BLOCKED as a Disburse execution guarantee**. A dry quote is a simulation, not a bound solver offer or reserved liquidity. The published service terms describe indicative quotes as non-binding unless an applicable interface expressly says otherwise. This adapter can check the returned nominal output and minimum, but cannot guarantee a future fill or the final transfer. Before live execution, Disburse must either obtain and validate a committed provider quote whose exact-output terms protect the full expected amount, or revise the contract/payout acceptance model in a separately reviewed milestone. It must not silently reinterpret `expected_output_amount` as a minimum.

The `amountIn` comparison is conservative input-budget screening against the quote's proposed input. It does not establish the final spend or provide a durable reservation. The current payout snapshot also has no `refundTo`; choosing a campaign owner, contract, or worker wallet would change refund custody and cannot be inferred safely. This field must come from a future explicit policy.

## Errors and ambiguity

`NearIntentsError.kind` classifies permanent validation (HTTP 400/malformed quote), temporary provider failures (5xx), rate limiting (429), configuration/authentication (401/403 or missing key), expired quote, ambiguous transport outcome (timeout/network failure), and unsupported capability/route. The dry API request is documented as not initiating a swap, so a timeout means no usable quote was received; it does not mean a payout executed. No retry, payout transition, reservation change, or execution outcome is produced.

Unsupported assets/networks and malformed or inconsistent fields fail closed. The adapter rejects changed recipient/token/asset routes, over-budget quotes, below-required output, malformed atomic strings, bad fee values, missing IDs/signature, and stale local opportunities. It does not trust provider `amountOutUsd`, formatted amount values, provider decimals, or a provider status as settlement evidence.

## Trust and future work

- The API key authenticates a client to the provider; it does not make quote or execution claims independently trustworthy.
- The returned quote signature is required and noted as dispute information by the OpenAPI, but this implementation does not verify its cryptographic signature. A present signature is not independent proof.
- Solvers/provider routing, bridge infrastructure, token metadata, and status reporting are external trust dependencies.
- A future verifier must independently inspect canonical destination-chain receipts/events and confirm chain, asset, recipient, exact atomic amount, finality, and replay identity.
- A future signer must be separated from Operator and Verifier authority, enforce per-payout budgets and recipient/token binding, and never sign based only on a provider quote or status response.
- The current Disburse contract uses a trusted Verifier attestation for settlement; it does not verify external-chain evidence itself. See [`payout-settlement.md`](payout-settlement.md).
- No contract or ABI change is proposed or made in this milestone.

## Sources checked

Checked 7 November 2026:

1. [1Click API documentation](https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api) — integration lifecycle and quote usage (the docs site did not render in the research browser; cross-checked against sources below).
2. [Published 1Click OpenAPI document](https://1click.chaindefuser.com/docs/v0/openapi.yaml) — server URL, paths, security schemes, request/response schemas, asset catalog, quote fields and status endpoint. This was fetched directly for schema inspection.
3. [NEAR-maintained Intents agent integration guide](https://github.com/near/agent-skills/tree/main/skills/near-intents) — workflow, swap types, status names, quote authentication/fees. It conflicts with the OpenAPI on authentication and does not override the OpenAPI implementation contract.
4. [NEAR Intents contract repository](https://github.com/near/intents) — on-chain verifier role and atomic matching description.
5. [1Click TypeScript SDK repository](https://github.com/defuse-protocol/one-click-sdk-typescript) — maintained generated TypeScript SDK and typed method surface. Not added as a dependency; the adapter uses a minimal injected-fetch client to keep quote-only capability explicit and avoid carrying execution methods.
6. [NEAR Intents service terms](https://near.com/terms) — indicative quote non-binding language and service/provider dependency.

Live route availability, rate limits, signature-verification procedure, guaranteed execution semantics for a committed EXACT_OUTPUT quote, route-specific recipient rules, and public testnet/sandbox endpoints remain **UNKNOWN** or **NOT TESTED**.
