# NEAR Intents Payout Assurance Spike

An engineering proof of concept for recipient-level payout records and conservative campaign budget authorization. It is not a payroll product, does not sign transactions, and does not submit deposits. Real provider integration can request quotes and read status; the executable scenarios use clearly labeled simulated data.

## Architecture

```mermaid
flowchart LR
  Campaign[Campaign service] --> Budget[Exact bigint budget engine]
  Budget --> DB[(PostgreSQL / Prisma)]
  Orchestrator[Payout orchestrator] --> Provider[1Click provider interface]
  Provider --> Real[NEAR 1Click HTTP adapter]
  Provider --> Mock[Deterministic simulator]
  Orchestrator --> Reservation[Serializable reservation service]
  Reservation --> DB
  Reconcile[Status reconciliation] --> Provider
  Reconcile --> Ledger[Append-only ledger]
  Ledger --> DB
```

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> QUOTED
  QUOTED --> RESERVED
  RESERVED --> COMMITTED
  COMMITTED --> AWAITING_DEPOSIT
  AWAITING_DEPOSIT --> PROCESSING
  PROCESSING --> SUCCESS
  PROCESSING --> REFUND_PENDING
  REFUND_PENDING --> REFUNDED
  PROCESSING --> FAILED
  PROCESSING --> UNKNOWN
  UNKNOWN --> PROCESSING
  UNKNOWN --> SUCCESS
  UNKNOWN --> REFUND_PENDING
  FAILED --> QUOTED: fresh attempt after safe reconciliation
  EXPIRED --> QUOTED: fresh quote only
```

`UNKNOWN` is intentionally nonterminal. A timeout never proves provider rejection. Do not release exposure or create a new funded attempt from that state.

## Financial model and invariants

- Money is represented as positive integer atomic units (`bigint`). Token decimals are metadata and constrained to 0–30; amounts are never parsed through `number`.
- Each campaign has exactly one budget asset denomination. Every quote `amountIn` reservation ceiling and separately payable fee must identify that same asset/chain/precision. Mixed denominations fail closed because no validated valuation or FX risk model is configured.
- Authorization is based on the provider's documented EXACT_OUTPUT `amountIn` buffer (stored internally as `maxAmountIn`), not `minAmountIn`. Budget approval rejects if the sum plus explicit separately payable fees exceeds the campaign budget.
- A PostgreSQL row lock and serializable transaction protect the campaign budget check. A unique reservation per payout, unique campaign idempotency key, and unique `(campaignId, recipientId)` prevent duplicate authorization.
- A settlement is accepted only when provider status is `SUCCESS`, actual output equals the promised atomic amount, and actual source spend is present. A confirmed refund is credited only if amount is present, positive, bounded by reserved input, and associated with the quote's origin asset. The status endpoint does not independently identify refund asset; association to the original quote must be preserved.
- Pending refunds do not reduce available funds. Unknown outcomes remain exposed. Cross-chain exactly-once settlement is not claimed; local idempotency cannot control an external solver's behavior.

Ledger reconciliation is grouped by logical payout to avoid double counting funds as they move from reservation to provider: `payout exposure = max(active reservation, observed deposit − confirmed refund)`; if no deposit amount has been observed, confirmed settlement spend is the fallback source outflow. Campaign `available = approved budget − sum(payout exposure)` and `unresolved = sum(max(0, payout exposure − confirmed settlement spend))`. Deposit observations do not add a second charge while the matching reservation remains active. A pending refund does not lower exposure or become available. All releases and actuals remain separate append-only entries.

## NEAR Intents behavior: verified and assumptions

The current official API reference documents base URL `https://1click.chaindefuser.com`, `POST /v0/quote`, `GET /v0/status`, optional `POST /v0/deposit/submit`, and `GET /v0/tokens`. Quote requests use `dry: true` for preview and `dry: false` to create a quote/deposit address; the request requires `slippageTolerance`, `deadline`, and explicit deposit/refund/recipient types. `EXACT_OUTPUT` fixes output `amount`; the documented quote response has `amountIn`, `minAmountIn`, `amountOut`, a `signature`, and (for committed quotes) `depositAddress`, optional memo, and deadline. The current docs do **not** define `maxAmountIn`; this adapter maps the documented `amountIn` buffer to its internal reservation ceiling and checks `minAmountIn <= amountIn`. It verifies echoed request assets, recipient, refund target, types, and amount, and verifies exact `amountOut`. Preview responses omit deadline/deposit address; committed responses must include them. Status lookup uses deposit address and must include `depositMemo` when the quote supplies one. See the current [quote reference](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote), [status reference](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status), [swap type definitions](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types), and [published OpenAPI specification](https://1click.chaindefuser.com/docs/v0/openapi.yaml).

Documented status values are `KNOWN_DEPOSIT_TX`, `PENDING_DEPOSIT`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`, and `FAILED`. Status results carry `swapDetails`, including actual input/output, `refundedAmount`, refund reason, `depositedAmount`, and origin/destination transaction hashes where present. This adapter validates those fields and the echoed quote using Zod before exposing them to the domain.

The current official authentication page says partner JWTs are sent as `X-API-Key` (and `Authorization: Bearer` is also accepted). The adapter sends the optional `NEAR_INTENTS_JWT` as `X-API-Key`. Unauthenticated quotes are allowed but incur an additional 25 bps platform fee; authenticated standard pricing is typically 20 bps, or 1 bp for stablecoin and same-asset multichain routes. The documented 0.0001% on-chain protocol fee applies separately; `appFees` and the optional insured-swap fee add further fee rules. The partner fee schedule is configurable. See [official API key guidance](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication) and [official fee schedule](https://docs.near-intents.org/resources/fees).

The adapter uses quote `amountIn` as the campaign's source-asset reservation ceiling. The exact-output reference describes it as the proposed input with a slippage buffer and says excess above actual need is refunded. The docs do not fully identify the denomination/accounting treatment for response `refundFee` and `withdrawFee`; the adapter rejects nonzero values until an asset-aware fee policy exists. Origin-chain transaction gas paid by the sender is also separate and must be added as an explicit fee in the budget denomination; do not assume unrelated native gas is covered. Mixed budget assets fail closed without validated conversion. API idempotency support is not documented; uniqueness/retries are enforced locally. The quote signature is stored but cryptographic verification is not implemented. The API has no documented testnet deployment; the mock is not a settlement simulation claim.

Preview quotes do not include a deposit address or expiry. A committed quote (`dry: false`) returns `quote.depositAddress`, optional `depositMemo`, `deadline`, and `timeWhenInactive`; expiry is determined by the quote/request deadline rather than a hard-coded duration. This spike's committed quote method records the address and never funds it. Deposit submission and signing are deliberately not implemented.

## Database

Prisma models: `Campaign`, `Payout`, `Attempt`, `PayoutEvent`, `Reservation`, and append-only `LedgerEntry`. Database uniqueness constraints cover idempotency, recipients, attempts, quote IDs, reservations, and ledger external references. SQL migration adds positive amount, precision, and nonnegative exposure constraints. Financial writes and status application occur in serializable database transactions.

## Run locally

Requirements: Node.js 20+, pnpm, and Docker Compose.

```sh
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm test
pnpm demo
```

`tests/concurrency/reservation.integration.test.ts` runs when `DATABASE_URL` is configured and asserts that only one of two simultaneous 70-unit reservations can succeed against 100 units. Unit tests do not require PostgreSQL. `pnpm demo` prints budget rejection, a 92-unit approval example, partial execution states, concurrent reservation expectations, and duplicate retry behavior; every outcome is simulated.

Set `NEAR_INTENTS_BASE_URL` and optionally `NEAR_INTENTS_JWT` in `.env` for real dry quotes/status reads. Do not put private keys in this application. Never point a transaction signer at these deposit addresses as part of this spike.

## Known limits and next work

- No production wallet, deposit observer, chain finality verification, deposit submission, signing, or funding support.
- The persistence services have been designed for PostgreSQL, but the integration suite must be run against a live local PostgreSQL to validate isolation and Prisma SQL behavior.
- Provider status alone is trusted as settlement evidence in the spike; a production system should independently verify destination-chain transactions/finality and refund transaction provenance.
- Fee coverage/auth pricing must be confirmed with NEAR Intents for the partner account. External gas valuation is intentionally not invented.
- Add durable retry orchestration with provider-status gating, campaign-level reconciliation reports, operational alerts, and audited manual adjustment approval before production.
- No exactly-once cross-chain guarantee is possible from local database idempotency alone.
