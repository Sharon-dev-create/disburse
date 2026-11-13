# Disburse execution-service

This package contains the Disburse execution-service TypeScript foundation and a runnable **local, read-only HTTP host** for demo/integration use.

The host composes existing components:
- PostgreSQL pool, migrations, and durable job repository reads
- Read-only NEAR JSON-RPC contract reader (existing views only)
- Authenticated read-only HTTP API routes (`src/api/http.ts`)

It does **not** execute payouts, sign transactions, store private keys, submit NEAR Intents deposits, verify destination-chain settlement, or expose public mutation routes.

## Architecture

```text
Frontend (Next.js server-side data loading)
  -> Execution API Host (Node.js, authenticated read-only)
     -> PostgreSQL (migrations + persisted execution job reads)
     -> NEAR RPC (read-only contract views / readiness checks)
```

**Component responsibilities**
- **API layer (`src/api/http.ts`)**: route handling, request validation, auth callback enforcement, response shaping/validation, error mapping.
- **Host (`src/host/*`, `src/host.ts`)**: environment validation, PostgreSQL pool creation, migration execution, repository/reader composition, server startup, graceful shutdown.
- **Persistence (`src/persistence/*`)**: config, pool, checksummed migrations, PostgreSQL job/security repositories.
- **NEAR client (`src/near/rpc.ts`)**: read-only JSON-RPC transport and contract reader, network verification, paused-state/readiness view.
- **Domain/discovery/provider modules**: existing provider-neutral primitives and read-only discovery foundations (not wired into this HTTP host for live execution).

## What it does

- Starts a local HTTP server with authenticated read-only endpoints.
- Runs existing PostgreSQL migrations (`0001`–`0003`) on startup (safe, checksummed, deterministic).
- Verifies configured NEAR network and performs contract readiness checks (including paused/read-only condition) before binding.
- Serves contract accounting/payout views and persisted execution-job list/detail reads where available.

## What it does not do

- No background workers or automatic payout execution.
- No transaction signing, wallet access, private-key handling, or contract mutation.
- No NEAR Intents deposit submission or destination-chain settlement verification.
- No public mutation endpoints, no production authentication/identity system.
- No mainnet deployment or real-money transfer flow.

Persisted execution jobs are operational state, not proof of successful destination-chain delivery. Contract state and execution-job state are separate.

## Environment setup

Copy `.env.example` to an untracked local file (for example `.env.local`) and set values.

Required host variables (actual names):
- `DISBURSE_API_HOST` (default `127.0.0.1`)
- `DISBURSE_API_PORT` (default `4000`)
- `DISBURSE_EXECUTION_API_DEMO_TOKEN` (server-side shared demo token, >=16 chars; **local/demo only**)
- `DISBURSE_POSTGRES_TARGET` (`development` | `test` | `production`, default `development`)
- `DISBURSE_DEV_DATABASE_URL` / `DISBURSE_TEST_DATABASE_URL` / `DISBURSE_DATABASE_URL` (based on target)
- `NEAR_NETWORK` (`mainnet` | `testnet`)
- `NEAR_RPC_ENDPOINT` (HTTP/HTTPS NEAR RPC endpoint)
- `DISBURSE_CONTRACT_ID` (must match configured NEAR network suffix)

Optional:
- `DISBURSE_NEAR_RPC_TIMEOUT_MS` (default `10000`)
- PostgreSQL pool/timeout vars supported by existing config: `DISBURSE_DB_POOL_MAX`, `DISBURSE_DB_CONNECTION_TIMEOUT_MS`, `DISBURSE_DB_QUERY_TIMEOUT_MS`

Configuration is validated at startup and fails with actionable, non-sensitive error messages. Connection strings, passwords, tokens, and private keys are never printed.

## Authentication (local/demo)

- Protected routes require `Authorization: Bearer <token>`.
- The host uses a **server-side shared demo token** from `DISBURSE_EXECUTION_API_DEMO_TOKEN`.
- Missing, malformed, or incorrect credentials are rejected (401).
- Credentials are compared safely and never logged.
- Authorization is never silently disabled when configuration is missing.
- `/healthz` is liveness-only and does not require auth or contract reads.

**Limitation:** this is for local/demo use only and is **not** production identity authentication, authorization policy, or user management.

## PostgreSQL setup and migrations

- Uses existing migration system in `src/persistence/postgres-migrations.ts` and SQL files in `sql/migrations/`.
- Preserves migrations `0001`, `0002`, and `0003` (no rewrites/deletes).
- Startup runs `applyPostgresMigrations(...)` in order; checksums/history are validated and advisory locks protect migration application.
- No automatic database resets, drops, or truncation.
- Existing database target protections remain enforced (development/test targets must be local and correctly named/roled per `loadPostgresRuntimeConfig`).

Example local migration commands (existing scripts):
```sh
pnpm db:migrate:dev
pnpm db:migrate:test
```

## Starting the service

From `execution-service/`:

```sh
pnpm install --frozen-lockfile
# set required env vars (untracked .env.local or exported env)
pnpm start
```

`pnpm start` runs `node --experimental-strip-types src/host.ts`.

## Starting the frontend against the host

From `frontend/`:

```sh
pnpm install
# set DISBURSE_EXECUTION_API_BASE_URL=http://127.0.0.1:4000
# set DISBURSE_EXECUTION_API_DEMO_TOKEN to the same server-side demo token (never NEXT_PUBLIC)
pnpm dev
```

The frontend server-side execution API loader forwards incoming auth/cookie headers when present and can attach the configured server-side demo token for local/demo access without exposing it to browser JavaScript.

## Verifying API connectivity

With the service running and a valid token:

```sh
curl -sS http://127.0.0.1:4000/healthz
curl -sS -H "Authorization: Bearer $DISBURSE_EXECUTION_API_DEMO_TOKEN" \
  http://127.0.0.1:4000/v1/campaigns/<campaignId>/accounting
```

Protected routes return 401 without/with invalid credentials. Contract and persisted-job data depend on configured NEAR contract and PostgreSQL state.

## Tests and checks

From `execution-service/`:

```sh
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm check
# Protected PostgreSQL integration suite (requires isolated local test DB)
DISBURSE_TEST_DATABASE_URL=postgresql://disburse_test:...@127.0.0.1:5432/disburse_test pnpm test:postgres
```

`pnpm test` runs `tests/*.test.ts` (including host config/auth/startup/API composition tests). `pnpm test:postgres` runs real PostgreSQL integration tests against the protected `disburse_test` target (no SQL mocks).

## Current demo limitations

- Read-only host only: no worker loop, no provider execution, no signing, no settlement verification, no refunds.
- Demo shared token auth is local-only and not a production identity model.
- Requires a reachable, configured NEAR contract (network-verified and paused for this host milestone) and a configured PostgreSQL database.
- No standalone production deployment artifacts, TLS termination, rate limiting, or audit-grade auth policy in this package.
- Real-money/mainnet payout execution is explicitly out of scope.

See also: `docs/execution-service-api.md`, `docs/execution-service-development.md`, and related docs in `../docs/`.
