# Disburse frontend

Next.js frontend for Disburse demo flows. Execution-service data is loaded server-side (no browser-side execution API calls, no Next.js API proxy routes).

## Architecture (demo integration)

```text
Frontend (server components / server-side loaders)
  -> Execution API Host (authenticated read-only)
     -> PostgreSQL / NEAR Read-only RPC
```

The frontend reads contract accounting/payout views and persisted execution-job state from the execution service. Contract state and execution-job state are displayed separately and are not treated as proof of destination-chain delivery.

## Environment setup

Copy `.env.example` to an untracked local file (for example `.env.local`):

- `DISBURSE_EXECUTION_API_BASE_URL` (server-only, e.g. `http://127.0.0.1:4000`)
- `DISBURSE_EXECUTION_API_DEMO_TOKEN` (optional local/demo-only server-side shared token sent as `Authorization: Bearer <token>` to the execution service; **never** `NEXT_PUBLIC_*`)
- `NEXT_PUBLIC_LAUNCH_URL` (optional marketing CTA only)

The demo token is attached only on the server when configured and no incoming authorization header is present. This is not production identity authentication.

## Local development

```sh
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Start the execution service first when viewing dashboard pages that depend on execution data. See `../execution-service/README.md`.

## Verify API connectivity

- Ensure `DISBURSE_EXECUTION_API_BASE_URL` points to the running execution host.
- If the host requires demo auth, set matching `DISBURSE_EXECUTION_API_DEMO_TOKEN` in the frontend server environment.
- Open dashboard routes that load campaign accounting/payout/execution data and confirm success/error states render without exposing sensitive details.

## Tests and checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Current demo limitations

- Read-only integration only: no payout execution, signing, settlement verification, or mutation routes.
- Demo-only campaign/recipient creation flows in the UI are separate from authoritative backend records.
- No production auth/session management; server-side demo token is for local use only.
