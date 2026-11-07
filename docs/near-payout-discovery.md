# NEAR payout discovery

## Contract facts verified from source and ABI

`src/lib.rs` emits the following NEP-297 events under `standard = "disburse"`, `version = "1.0.0"`:

| Event | Meaning |
|---|---|
| `payout_reserved` | Newly allocated payout ID; input reservation has been made. |
| `payout_execution_started` | Operator/Admin moved the payout to `Executing`. |
| `payout_pending_verification` | Operator/Admin recorded `PendingVerification`; this is not proof of destination settlement. |
| `payout_execution_failed` | Operator/Admin recorded failure evidence. |
| `payout_manual_review` | Operator/Admin quarantined an uncertain payout. |
| `payout_settled` | Verifier settled the payout and moved reserved input to spent. |
| `failed_payout_reservation_released` | Verifier released a failed payout reservation. |
| `manual_review_execution_confirmed` | Verifier confirmed an execution and returned the payout to pending verification. |
| `manual_review_non_settlement_confirmed` | Verifier released a manual-review reservation. |

The payout store is a NEAR `LookupMap<u64, Payout>` with prefix `payout-records`; it is not
enumerable. `next_payout_id` is private state and there is no payout count or listing view. The ABI
does expose `get_payout`, `get_campaign_payout`, `get_payout_by_idempotency`,
`get_campaign_payout_accounting`, `get_campaign_count`, `has_role`, and `is_paused`. Campaign count
does not bound payout IDs. Neither guessed ID polling nor these views can discover all payouts.

## Implemented pipeline

`NearContractReader` performs only NEAR JSON-RPC `query/call_function` and `status` requests. It is
configured with an expected network and contract, verifies the RPC chain ID, serializes u64 call
arguments without floating point, validates u64/u128 response values, and distinguishes `null`
views from RPC, timeout, and malformed-response errors. The reader includes the ABI's payout,
idempotency, accounting, pause, and role views.

`NearEventSource` supports cursor continuation and historical reads from a source-specific
position. `decodeNearEvent` validates the actual NEP-297 envelope, known event payload fields,
amounts, versions, and bounded raw log size. Unknown event types/standards/versions and malformed
known events are persisted as observable records and do not crash later event processing.

`PayoutDiscoveryProcessor` processes events in source order. For each known payout event it reads
the current contract payout. A reservation event must match the returned payout and campaign IDs,
input/output token identities, and atomic amounts. It creates an execution-service job only when
the current on-chain status is `Reserved`; other statuses are observations and never executable
work. Subsequent lifecycle events only refresh the current view. The event's asserted status is
never used to overwrite the contract view.

`PayoutReconciler` rereads all payout identities learned from indexed events and persisted
observations. It refreshes status from the contract, records status changes, missing views, and RPC
errors, and retains the last valid observation during an RPC outage. Missing and failed reads are
different outcomes. Reconciliation does not submit transactions, adjust accounting, or authorize
execution.

`DurableFileDiscoveryRepository` is a local single-writer implementation. It stores cursors,
deduplicated events, observations, discrepancies, and discovered operational jobs in one versioned
JSON snapshot. Each event record and its cursor update are written together through fsync and
atomic rename; a failed write leaves both unchanged. The repository can be reopened after process
restart. It is not a multi-process database implementation. `execution-service/sql/schema.sql`
contains reference PostgreSQL tables and uniqueness constraints for a future transactional
deployment; it is never applied by package commands.

Event uniqueness uses network, contract, block hash, transaction hash, receipt ID, and event
position. Payout uniqueness uses network, contract, and payout ID. Repeated delivery is idempotent;
conflicting content under the same chain identity is rejected. The cursor is advanced only in the
same repository commit as the event, observation, discrepancy, and optional initial job.

## Historical retrieval and limits

NEP-297 events are contract log strings. A normal view call cannot enumerate historical logs.
There is no live/indexer-specific event source in this package, so historical backfill and gap
detection are **not operationally complete**. `MockNearEventSource` is deterministic test support,
not evidence of production event availability. A production adapter must use a provider that offers
replayable historical events, stable receipt/log identity, finalized ordering, and documented
retention and reorg behavior. The adapter must expose opaque cursors and return all events after the
saved position. If the provider's retention starts after deployment, payouts before that point
cannot be proven absent from event data.

If an event source is unavailable, processing stops before cursor advancement. If a source returns
a finalized reservation event but the current view is missing, the discrepancy is persisted; that
absence is not treated as evidence that no payout existed or that it is safe to execute. If a
cursor is corrupt or unknown to a provider, an operator must recover it from a trusted finalized
block/receipt position or replay from a known earlier position. Replay is safe due to event and job
uniqueness.

## Operational setup before testnet

1. Select a historical NEAR event indexer and configure network, contract, endpoint, timeout, and
   finality/reorg policy.
2. Replace the local file store with a transactional PostgreSQL adapter that commits event,
   observation/job, and cursor in one database transaction and serializes competing indexers.
3. Establish a trusted initial backfill position and validate source retention and event identity.
4. Monitor cursor lag, malformed/unknown events, discrepancies, RPC errors, and reconciliation
   age. Do not turn these alerts into automatic payout retries.
5. Exercise backfill, restart, provider outage, source reorg, and contract-view mismatch against a
   controlled testnet before connecting execution workers.

No event-provider credentials, database connection, migration, signing key, or transaction
submission is included in this milestone.
