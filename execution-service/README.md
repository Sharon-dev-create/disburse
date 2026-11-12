# Disburse execution-service foundation

This is a separate strict TypeScript package containing provider-neutral execution interfaces and
a read-only NEAR payout discovery foundation. It does not submit transactions, sign NEAR
transactions, configure a PostgreSQL connection, or move funds.

## What is here

- `src/domain`: exact-string payout/job identifiers and normalized contract payout views.
- `src/state-machine`: allowed operational transitions and safety preconditions.
- `src/providers`: provider adapter boundary and restart reconciliation policy.
- `src/providers/networks.ts`, `recipient.ts`, and `refund.ts`: canonical network identities,
  chain-aware recipient checks, and payout-bound refund policy fingerprints. The in-memory refund
  repository is a test double; a PostgreSQL adapter is also available under `src/persistence`.
- `src/providers/signing.ts`: policy evaluation and a Created/Approved/Consumed/Expired/Revoked
  authorization lifecycle with local hash integrity checks. The deterministic in-memory repository
  is a test double; the PostgreSQL adapter provides durable state transitions. Neither a hash nor a
  repository substitutes for an authenticated signer.
- `src/providers/quote.ts` and `src/providers/near-intents`: provider-neutral quote-only types and a deterministic-testable NEAR Intents 1Click `dry: true` adapter. It has no deposit, execution, tracking, signing, or settlement methods.
- `src/verification`: independent evidence-verification interface.
- `src/near`: read-only, Operator/Admin, and Verifier contract client boundaries.
- `src/near/rpc.ts`: read-only JSON-RPC contract reader for existing ABI views.
- `src/api/http.ts`: authenticated read-only HTTP endpoints for payout and campaign accounting views.
- `src/near/providers/fastnear-neardata.ts`: finalized-block historical event source for FastNear
  NEAR Data with bounded HTTP retries and opaque block/log cursors.
- `src/discovery`: NEP-297 decoder, replayable source interface, durable local file repository,
  discovery processor, and chain-view reconciler.
- `src/persistence`: job/lease repository interface plus test-only in-memory implementation.
- `src/persistence/postgres-security-repositories.ts`: PostgreSQL authorization and refund-policy
  repository adapters behind an injected query function. They reuse the existing PostgreSQL
  operational store and add no driver dependency. The reference DDL is in `sql/schema.sql` and
  must be applied through a reviewed migration before constructing these adapters in a service.
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

The read API is a library boundary, not a fully composed production service. It requires a
host-supplied request authorizer, validates the configured RPC network and contract ABI before
binding, and exposes no quote, authorization, execution, refund, verification, or settlement
operations. See [`../docs/execution-service-api.md`](../docs/execution-service-api.md) for routes
and limits.

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

For supported local tool versions, isolated PostgreSQL setup, and the current runtime boundary, see
[`../docs/execution-service-development.md`](../docs/execution-service-development.md).

## Not production-ready

There is no PostgreSQL driver/configuration, production worker loop, destination-chain verifier,
signer integration, secret store, or testnet execution flow yet. The durable adapters exist but are not wired into
application composition; their tests use a deterministic SQL mock, not a live PostgreSQL server.
EVM mixed-case recipients use a local Keccak-256 EIP-55 implementation because this package does not
currently include an audited Ethereum checksum library; replace it with a reviewed maintained
dependency before production use. NEAR Intents quotes remain preview-only and exact-output committed
execution compatibility is not established.
The file-backed discovery adapter is intended for local/single-writer operation only. See
[`../docs/execution-service-architecture.md`](../docs/execution-service-architecture.md) and
[`../docs/execution-service-threat-model.md`](../docs/execution-service-threat-model.md) for
integration requirements and security boundaries.

See [`../docs/near-intents-integration.md`](../docs/near-intents-integration.md) for the API research,
quote-only boundary, exact-output compatibility assessment, and unresolved integration blockers.
e713f5839c0453bf284e43d547a2fa98c0c0056d413fa334
8501e82ac1ae7f720d1e483f40e9b216b4b45f0e9e092882
fd3f4f2377cb4560e80e7b438e8e2bc8aacda1e44d2f4f02
e5d006a6a2978c6193ab14cf3431feac68d8fc8babb21b08
