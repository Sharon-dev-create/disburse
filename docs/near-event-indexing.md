# NEAR event indexing boundary

## Available strategy

The contract emits NEP-297 `EVENT_JSON:` logs and exposes current payout views, but has no payout
enumeration method or payout ID upper bound. Complete discovery therefore requires replayable
historical receipt logs; a normal view call is not an event history API.

Milestone 10 adds `FastNearNearDataEventSource` behind the Milestone 9 `NearEventSource` interface.
It walks provider finalized blocks from an inclusive block-height start point, filters execution
outcomes by the configured contract account, and emits receipt-level log identities. Provider
evaluation, finality policy, and cursor details are documented in
[`near-event-provider-evaluation.md`](near-event-provider-evaluation.md) and
[`near-event-provider-integration.md`](near-event-provider-integration.md).

## Event identity and cursor rules

The persisted uniqueness key combines network ID, contract account, block hash, transaction hash,
receipt ID, and original log index within that receipt. Transaction hashes alone are insufficient
because one transaction may produce multiple receipts or logs. The provider cursor remains opaque
and is not a permanent event identity.

The source returns logs in ascending block order, then numeric shard order, provider receipt outcome
order within each shard, and original log order within the receipt. It uses provider-supplied
receipt IDs and transaction hashes and fails if matching contract outcomes omit them. The event
index is the original array index, including preceding non-NEP-297 logs.

Each event and its cursor commit atomically with its observation, discrepancy, and optional job.
Only after every event in a fetched page is committed does the processor persist the page
checkpoint. This checkpoint may advance across empty blocks. A failed event write leaves the source
at the last committed event; a failed page checkpoint causes a safe reread of any trailing empty
blocks. Unknown standards, versions, and names are persisted before their cursor advances. A
malformed recognized Disburse event records its exact raw log in an incident and stops at the prior
cursor. Block observations and event records are archived and compared on replay; conflicts preserve
originals and pause normal ingestion. See [`near-discovery-integrity.md`](near-discovery-integrity.md)
for bounded recovery and operator steps.

## Finality and reorganization behavior

The adapter reads `/v0/block/{height}` and `/v0/last_block/final`; it never requests optimistic
blocks. It validates the requested block height, execution outcome block hashes, the block hash
while resuming mid-block, and previous-hash continuity at the cursor boundary. The provider exposes
finalized rather than provisional event data, so the indexer does not need to retract ordinary
unfinalized observations.

There is no provider-documented finalized-event retraction feed and no repository operation for
rolling back finalized events. Parent-hash checks detect a discontinuity at the next block boundary,
but do not continuously audit every prior finalized block or detect arbitrary provider rewrites of
older history. A suspected provider/consensus integrity incident requires stopping ingestion,
preserving the index for audit, rebuilding from a trusted height, and reconciling known payout views.

## Offline behavior and gaps

If the indexer is offline while the provider retains history, it resumes from the durable cursor and
replays blocks. Provider archive retention and uptime are not claimed as an SLA. If history has
expired or the cursor is irrecoverable, the index cannot infer that no payouts occurred in the gap.
A payout absent from an incomplete event feed is not evidence that it never existed or that it is
safe to execute.

Reconciliation can only recheck payout identities learned from indexed events or persisted
observations. The contract's non-enumerable `LookupMap` means it cannot discover an unknown payout
ID on its own. The smallest durable remedy for indexer gaps is replay from a trusted deployment
height or a future reviewed payout enumeration view; this milestone does not modify the contract.

## Repository and testnet limits

`DurableFileDiscoveryRepository` is single-writer local storage. It commits through fsync and atomic
rename and can be reopened after restart, but is not a multi-process transactional database.
`execution-service/sql/schema.sql` remains a reference schema and is never applied automatically.

No deployed Disburse testnet account is configured in this repository. Provider fixtures validate
the adapter and pipeline contracts but are not live Disburse event evidence. See the integration
document for the deployment dependency and production-readiness steps.
