# Disburse

<p align="center">
  <img src="docs/assets/disburse-hero.svg" alt="Disburse — accountable payout operations" width="100%" />
</p>

> **Status — development foundation, not production payment software.** Disburse contains a NEAR contract, a read-only execution-service foundation, and a demo-oriented Next.js dashboard. It has no production signer, worker, live payout submission, independent destination-chain verifier, or complete quote-to-settlement pipeline. Do not use it to move production funds.

Disburse is a payout orchestration and accountability project for platforms paying freelancers, contributors, and service providers. It organizes payout obligations around campaigns, approved budgets, explicit lifecycle states, and reviewable records.

## What it does today

| Component | Implemented foundation | Not implemented / not implied |
| --- | --- | --- |
| **NEAR contract** | Campaign lifecycle, approved-token funding, budget accounting, payout reservations, role controls, idempotency, and verifier-attested settlement/recovery | Cross-chain transfer execution or independent destination-chain proof |
| **Execution service** | Read-only NEAR views, authenticated read API module, event-discovery components, dry quote previews, and PostgreSQL persistence primitives | A production worker, signer, transaction submission, automatic retries/refunds, or settlement verifier |
| **Frontend** | Marketing site, responsive dashboard, demo campaign/recipient/payout flows, and optional server-side API reads | Wallet connection, persisted form actions, campaign funding, or payout initiation from the UI |
| **PostgreSQL** | Additive migrations and repositories for authorizations, refund policies, jobs, attempts, and leases | Proof of on-chain settlement or a running production service |

Illustrative dashboard records are intentionally separate from contract and execution-service data. A read-only contract view is not proof that a payout was delivered.

## How Disburse fits together

<p align="center">
  <img src="docs/assets/disburse-architecture.svg" alt="Diagram showing the Disburse dashboard, execution-service foundation, PostgreSQL persistence, and NEAR contract boundaries" width="100%" />
</p>

1. **Plan a campaign.** The contract models a campaign with a token, budget, creator, and lifecycle: `Draft` → `Approved` → `Active`, with pause, completion, and cancellation paths.
2. **Fund within controls.** NEP-141 funding is accepted only for allowlisted tokens, an approved campaign, its matching token, and an amount within its budget.
3. **Reserve a payout.** An Operator or Administrator can create a payout for an active campaign. Its input amount is reserved immediately, subject to campaign accounting invariants.
4. **Record operational state.** The service foundation can retain job, attempt, lease, authorization, and policy records in PostgreSQL. These are operational records, not the contract source of truth.
5. **Settle with an explicit trust boundary.** A Verifier can attest matching destination, output token, and exact output amount. The contract does not independently inspect a destination chain or prove a receipt is genuine.

## Accounting and safety model

The contract is authoritative for campaign funding, reservations, spent input, and payout state. It tracks `budget`, `funded`, `reserved`, `spent`, and `available`, enforcing `reserved + spent ≤ funded ≤ budget`.

- Payout creation reserves input funds up front.
- Campaign-scoped idempotency returns the original payout for an identical retry and rejects changed details under the same key.
- Roles are explicit: the owner has implicit Owner and Administrator authority; Operators activate campaigns and create payouts; explicitly assigned Verifiers settle or recover reservations.
- Settlement validates the verifier’s claim against the approved destination, output token, and exact atomic output amount.
- Contract events use NEP-297 `EVENT_JSON:` records.

The payout model includes `Reserved`, `Executing`, `PendingVerification`, `Succeeded`, `Failed`, `RefundPending`, `Refunded`, `ManualReview`, and `ReservationReleased` states. Their presence in code does **not** mean a live provider executes them today.

## Local development

### Prerequisites

- Rust `1.95+`
- Node.js `22.13+` and pnpm
- PostgreSQL 17+ on loopback for real service integration tests
- `cargo-near` only when building WASM

### Contract

From the repository root:

```sh
cargo fmt --all -- --check
cargo test --locked
cargo near build non-reproducible-wasm --locked
```

The build produces an artifact only; it does not deploy a contract.

### Execution service and PostgreSQL

From `execution-service/`:

```sh
pnpm install --frozen-lockfile
pnpm check
```

For isolated local database testing, copy the placeholder configuration and keep it private:

```sh
cp .env.example .env.integration.local
chmod 600 .env.integration.local
```

Configure separate loopback-only development and test roles/databases. Never commit the local file or point these commands at production or shared data.

```text
DISBURSE_DEV_DATABASE_URL=postgresql://disburse_dev:<password>@127.0.0.1:5432/disburse_dev
DISBURSE_TEST_DATABASE_URL=postgresql://disburse_test:<password>@127.0.0.1:5432/disburse_test
```

Then apply additive migrations and run the real isolated integration suite:

```sh
pnpm db:migrate:dev
pnpm db:migrate:test
pnpm test:postgres
```

The PostgreSQL suite validates that it is connected to the dedicated `disburse_test` database and role before writing. It does not silently use mocks or skip database checks.

### Frontend

From `frontend/`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. The dashboard works as a demo without an API. To enable its optional server-side read panels, configure a trusted host-composed API endpoint with `DISBURSE_EXECUTION_API_BASE_URL`; never place database URLs or service secrets in frontend environment variables.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Repository map

```text
src/                  NEAR contract, state types, and Rust tests
execution-service/    TypeScript read API, discovery, persistence, providers, and tests
frontend/             Next.js marketing site and dashboard
docs/                 Architecture, security, integration, and deployment documentation
```

## Verification commands

| Area | Command |
| --- | --- |
| Contract format and tests | `cargo fmt --all -- --check && cargo test --locked` |
| Contract WASM build | `cargo near build non-reproducible-wasm --locked` |
| Execution-service deterministic checks | `cd execution-service && pnpm check` |
| Execution-service PostgreSQL tests | `cd execution-service && pnpm test:postgres` |
| Frontend checks | `cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm build` |

No browser end-to-end suite or all-in-one runtime command is currently included. A passing build or unit test does not establish deployment, transfer execution, cross-chain finality, or settlement readiness.

## Important boundaries

- The contract stores expected output values but does not execute cross-chain transfers.
- The NEAR Intents 1Click adapter requests `EXACT_OUTPUT` quotes with `dry: true`; these are previews, not orders, deposits, or execution guarantees.
- A verifier attestation is a trusted assertion, not independent destination-chain verification.
- PostgreSQL job state is operational state; contract state remains authoritative for on-chain accounting.
- The frontend’s demo forms do not persist data or submit contract transactions.

## Documentation

- [Execution-service API](docs/execution-service-api.md)
- [Execution-service architecture](docs/execution-service-architecture.md)
- [Execution security and threat model](docs/execution-security.md)
- [PostgreSQL setup and schema boundaries](docs/postgres-execution-service.md)
- [Payout settlement and verifier trust model](docs/payout-settlement.md)
- [NEAR Intents integration boundary](docs/near-intents-integration.md)
- [NEAR event discovery and indexing](docs/near-payout-discovery.md)
- [Testnet deployment readiness](docs/testnet-deployment.md)

## License

No repository `LICENSE` file is present. The root package metadata declares `ISC`; confirm the intended project-wide license before relying on it.
