# NEAR event indexing boundary

## Available strategy

The contract emits NEP-297 `EVENT_JSON:` logs and exposes current payout views, but has no payout
enumeration method or payout ID upper bound. The only complete discovery path is therefore a
replayable historical log/receipt index. A basic contract view query is not an event history API.

Milestone 9 adds `NearEventSource` with `readAfter(cursor, limit)` and
`readFrom(startPosition, limit)`. `RawNearEvent` carries network, contract, block height/hash,
transaction hash, receipt ID, event/log index, raw log, and an opaque source cursor. The source must
return deterministic finalized ordering and a cursor that resumes immediately after the event.
`MockNearEventSource` implements these semantics for deterministic tests only.

No third-party indexer was selected or connected. Provider selection requires operational review of
historical retention, finality, reorg behavior, receipt-level event ordering, cursor guarantees,
rate limits, outage behavior, and the ability to replay from an earlier finalized position. Until
such an adapter is implemented and exercised, historical backfill, complete event coverage, and
event-gap detection are not claimed.

## Event identity and cursor rules

The persisted uniqueness key combines network ID, contract account, block hash, transaction hash,
receipt ID, and event index. Transaction hashes alone are insufficient because a transaction may
produce multiple receipts or logs. The opaque provider cursor is stored separately and must not be
used as the permanent event identity.

The processor commits each event and its cursor in one durable repository transaction. A failed
view call or persistence operation does not advance the cursor. Unknown and malformed events are
persisted with bounded raw text and a classification before the cursor advances, so one unfamiliar
event does not block later events and remains visible for investigation. A duplicate delivery does
not create a second event or job but can advance to the duplicate delivery's later source cursor.

Use finalized events to avoid routine reorg rollback. If a selected indexer can return provisional
events, its adapter must add an explicit finality gate and reorg/retraction model before exposing
those events to the processor. The current interfaces do not implement rollback of finalized data.

## Offline behavior and gaps

If the indexer process is offline but the provider retains history, it resumes from the saved cursor
and replays missed events. If provider history has expired or the cursor is irrecoverable, the index
cannot infer that no payouts were created during the gap. A payout absent from an incomplete event
feed is not evidence that the payout never existed and is not authorization to execute.

Reconciliation can only recheck payout IDs already learned from events or persisted records. It
cannot discover an unknown ID because the contract stores payouts in a non-enumerable `LookupMap`
and exposes neither listing nor count. The smallest durable future remedy is a reviewed contract
view such as paginated payout IDs/count (storage-layout neutral if derived safely, but still an ABI
change) or a complete trusted indexer replay from contract deployment. This milestone does not
change the contract.
