# Disburse execution-service foundation

This is a separate strict TypeScript package containing provider-neutral execution interfaces and
a read-only NEAR payout discovery foundation. It does not submit transactions, sign NEAR
transactions, connect to PostgreSQL, or move funds.

## What is here

- `src/domain`: exact-string payout/job identifiers and normalized contract payout views.
- `src/state-machine`: allowed operational transitions and safety preconditions.
- `src/providers`: provider adapter boundary and restart reconciliation policy.
- `src/verification`: independent evidence-verification interface.
- `src/near`: read-only, Operator/Admin, and Verifier contract client boundaries.
- `src/near/rpc.ts`: read-only JSON-RPC contract reader for existing ABI views.
- `src/near/providers/fastnear-neardata.ts`: finalized-block historical event source for FastNear
  NEAR Data with bounded HTTP retries and opaque block/log cursors.
- `src/discovery`: NEP-297 decoder, replayable source interface, durable local file repository,
  discovery processor, and chain-view reconciler.
- `src/persistence`: job/lease repository interface plus test-only in-memory implementation.
- `src/coordinator`: coordinator/discovery ports and deterministic bounded references.
- `tests`: deterministic execution and discovery tests, including provider HTTP fixtures, restart,
  duplicate delivery, cursor atomicity, and RPC failures.
- `sql/schema.sql`: reference PostgreSQL execution and discovery schema. Package commands do not
  execute it.

The local discovery index is operational state, not a financial ledger. The contract remains
authoritative. Provider claims require independent verification, and ambiguous submissions go to
reconciliation or ManualReview rather than automatic resubmission.

`DurableFileDiscoveryRepository` supports a single local indexer/worker process and implements the
existing `JobRepository` interface, so discovered jobs flow into the operational state machine. Its
atomic snapshot contains block/event archives, incidents, recovery runs, observations, jobs, leases,
discrepancies, failures, and cursors.
Use a transactional database adapter for multiple workers/indexers. The live provider implementation
is read-only and currently has no configured Disburse testnet deployment to ingest. See
[`../docs/near-event-provider-integration.md`](../docs/near-event-provider-integration.md) for
setup and [`../docs/near-payout-discovery.md`](../docs/near-payout-discovery.md) for discovery
limits.

Milestone 10.1 archives block observations and exact matching event logs, records conflicting
historical responses without replacing originals, pauses normal ingestion on integrity incidents,
and supports bounded recovery with its own durable cursor. Recovery reconciles current contract
views and never creates/deletes jobs. FastNear has no documented historical retention SLA; archive
backup and operator investigation remain necessary. See
[`../docs/near-discovery-integrity.md`](../docs/near-discovery-integrity.md) for the operator
procedure and precise limits.

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

There is no PostgreSQL repository, production worker loop, destination-chain verifier, signer
integration, secret store, or testnet execution flow yet.
The file-backed discovery adapter is intended for local/single-writer operation only. See
[`../docs/execution-service-architecture.md`](../docs/execution-service-architecture.md) and
[`../docs/execution-service-threat-model.md`](../docs/execution-service-threat-model.md) for
integration requirements and security boundaries.
