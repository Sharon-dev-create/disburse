# Disburse execution-service foundation

This is a separate strict TypeScript package containing provider-neutral interfaces and a
deterministic operational-state foundation. It does not submit real transactions, connect to a
provider, connect to PostgreSQL, sign NEAR transactions, or move funds.

## What is here

- `src/domain`: exact-string payout/job identifiers and normalized contract payout views.
- `src/state-machine`: allowed operational transitions and safety preconditions.
- `src/providers`: provider adapter boundary and restart reconciliation policy.
- `src/verification`: independent evidence-verification interface.
- `src/near`: read-only, Operator/Admin, and Verifier contract client boundaries.
- `src/persistence`: job/lease repository interface plus test-only in-memory implementation.
- `src/coordinator`: coordinator/discovery ports and deterministic bounded references.
- `tests`: deterministic tests for transitions, duplicate discovery, leases, restarts, and ambiguous
  outcomes.
- `sql/schema.sql`: reference PostgreSQL schema. Package commands do not execute it.

The database is an operational job store, not a financial ledger. The contract remains authoritative.
Provider claims require independent verification, and ambiguous submissions go to reconciliation or
ManualReview rather than automatic resubmission.

## Commands

Run from this directory after installing dependencies:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm check
```

## Not production-ready

There is no PostgreSQL repository, worker loop, NEAR RPC client, provider adapter, chain verifier,
signer integration, secret store, or testnet execution flow yet. See
[`../docs/execution-service-architecture.md`](../docs/execution-service-architecture.md) and
[`../docs/execution-service-threat-model.md`](../docs/execution-service-threat-model.md) for
integration requirements and security boundaries.
