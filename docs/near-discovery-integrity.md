# NEAR discovery integrity and recovery

## Authority and scope

NEAR contract views remain the authoritative source for payout existence, status, and accounting.
FastNear and the local index are observations. Historical recovery is read-only: it does not submit
transactions, change contract state, release reservations, settle payouts, or create/delete execution
jobs. The local JSON repository is single-writer and uses an atomic snapshot; it is not a shared
multi-process store.

## Block and event identity

Each archived block is keyed by network, contract, and height and stores its provider, block hash,
parent hash, number of matching contract receipts/logs, a SHA-256 hash of the canonicalized
contract-executor receipt outcome/log payload, and first/last observation times. Each event is
keyed by network, contract, block hash, transaction hash, receipt ID, and original log index. Its
exact provider log is retained with a separate SHA-256 canonical payload hash, provider identity,
processing time, and first observation time. JSON event payload object keys are recursively sorted
for the hash; the raw log remains unchanged. For malformed or non-JSON logs, the exact bytes are
hashed. This detects a changed response under an already observed identity; it does not prove the
provider response is authentic or complete.

Repeated identical event/block observations are idempotent. A block hash, parent, receipt/log count,
provider, or payload-hash difference creates an incident and preserves the original archive record;
the new block values are preserved in the incident. A changed event identity payload likewise leaves
the original event untouched and stores the new raw payload and hash in the incident. The page stops
before its events are accepted. Event and cursor commit together; trailing empty-block cursor
checkpoints commit only after all page events commit. A failed event write leaves the previous durable
cursor. A fetched block observation may be archived ahead of the cursor; that is intentional and
causes replay to compare it before processing.

The FastNear adapter validates configured first-block/network identity, requested height, receipt
execution block hash, mid-block cursor hash, and parent-hash continuity. The repository also checks
the archived adjacent block and each contiguous pair in a page. Missing heights, mismatched parents,
malformed metadata, wrong network/contract, cursor corruption, and malformed recognized Disburse
events stop processing. Unknown standards, versions, and event names remain observable and can be
advanced because they are not recognized payout events. Global source readiness blocks on unresolved
integrity incidents. Temporary outage, rate-limit, and view-reconciliation incidents do not by
themselves block an otherwise safe retry.

## Recovery procedure

1. Stop normal ingestion when an integrity incident appears. Preserve and copy the repository file
   and its backups before attempting recovery. Do not edit cursors or archived rows by hand.
2. Read the incident's expected/observed values and action. Identify the last known good durable
   cursor and bound the affected block range. Use an independently trusted deployment height where
   available; do not infer a missing payout from absent events.
3. Run `PayoutDiscoveryProcessor.recoverRange(startHeight, endHeight, nowMs)`. Recovery has a
   separate persistent cursor and run record, fetches bounded pages, archives/compares every block,
   idempotently replays events, and re-reads known payout views from NEAR. It resumes after restart
   from its persisted source cursor. It does not create/delete execution jobs.
4. A fully supplied range with no block/event conflict and successful current contract-view
   reconciliation is recorded as validated. Missing provider history, a historical conflict, or
   failed/missing contract views leaves the recovery unavailable/conflicted and requires manual
   investigation. Original history is never automatically replaced. Conflicting block/event
   incidents remain open and normal ingestion stays paused. A successful rescan can resolve
   continuity, missing-history, provider/configuration, transient malformed-response, archive-write,
   and reconciliation incidents in the validated range; it cannot resolve conflicting historical
   block/event observations.
5. Only an operator with an independently justified explanation should resolve an unresolved
   conflict. The current API intentionally has no “accept new canonical history” or destructive
   rollback operation. Until such a reviewed procedure exists, retain the pause and preserve both
   observations. Resolved range incidents are only cleared after a successful bounded replay and
   payout-view reconciliation.
6. After resolving the underlying operational issue, verify the current payout/accounting views and
   inspect the recovery record before resuming normal polling. A provider success response alone is
   not evidence to execute or settle a payout.

Recovery validates only records returned by the selected provider for the requested range. A missing
previously indexed event is detected when its containing block's contract receipt/log count or
canonical block payload hash differs. FastNear does not provide an independently authenticated
historical completeness proof, so a consistent but incomplete response cannot be ruled out.

## Incident operations

The file repository records stable incident type, network, contract, optional block/event identity,
expected and observed values, first and most recent timestamps, occurrence count, status, and a
required operator action. Types include outage, rate limit, missing history, malformed response,
block continuity, network mismatch, conflicting historical block/event, cursor corruption, archive
write failure, and reconciliation failure. `DiscoveryIntegrityError` returns an explicit failure to
the caller. Keep credentials and secrets out of incident context.

Inspect repository snapshots and `getDiagnostics()` from the source. The indexer is healthy only when
polling succeeds, cursor progress is explainable, and there are no blocking open incidents. A
successful provider call does not resolve a historical conflict.

## Archive, backup, and limitations

The local file archive is adequate for a single local process: JSON snapshots are written to a
0600 temporary file, fsynced, atomically renamed, and the containing directory is fsynced. It stores
only matching Disburse executor outcomes and exact matching log payloads, not unrelated contract
data. Make encrypted, access-controlled, versioned backups of the snapshot and validate restore
procedures. Retain incident/recovery records and archive backups according to the operator's legal
and storage policy. The reference SQL schema has matching block/event/incident/recovery fields but
is not migrated or used by the package. No multi-writer safety is claimed.

FastNear's public documentation describes finalized block queries and sequential historical reads,
but no formal retention SLA was found. Endpoint responses may indicate missing old data; no retention
duration is assumed. Testnet and mainnet may have different practical availability, and matching
receipt outcomes/logs are part of the returned block object but have no separately documented
retention guarantee. Consult [provider evaluation](near-event-provider-evaluation.md) for source
classifications and references. Local archiving improves investigation/replay of previously seen
events; it cannot fill an unobserved gap or prove provider authenticity.

Contract-view reconciliation preserves the last valid observation if RPC is unavailable. A missing
view is recorded as a discrepancy, not proof that a payout was never created. The contract exposes
no payout enumeration API, so IDs not already observed cannot be reconciled by this service.
