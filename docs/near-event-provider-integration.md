# FastNear NEAR Data event provider integration

## Configuration

The read-only adapter is `FastNearNearDataEventSource` in
`execution-service/src/near/providers/fastnear-neardata.ts`. It accepts only `mainnet` or `testnet`
and needs an explicit starting block and Disburse account. Its default endpoints are:

- Testnet: `https://testnet.neardata.xyz`
- Mainnet: `https://mainnet.neardata.xyz`

Optional `NEAR_DATA_ENDPOINT` supports a reviewed proxy or self-hosted compatible endpoint.
`FASTNEAR_API_KEY` is optional for the public service and is sent as a query parameter when set.
Do not put credentials in the repository or logs. A placeholder-only example is in
`execution-service/.env.example`.

```sh
NEAR_NETWORK=testnet
DISBURSE_CONTRACT_ID=example.testnet
NEAR_DISCOVERY_START_BLOCK=42376888
# Optional:
# FASTNEAR_API_KEY=replace-with-a-provider-key
# NEAR_DATA_ENDPOINT=https://testnet.neardata.xyz
```

The values above are examples, not a claim that the example account is deployed. Select the start
height from a trusted deployment record. The adapter factory `fromEnvironment()` validates required
settings and never submits transactions.

## Retrieval, identity, and cursor

The adapter reads the provider's finalized head, then walks finalized blocks in ascending height.
It sorts shards by numeric shard ID, keeps receipt outcomes in provider order, and retains log order
within each outcome. The API documentation specifies the response schema but does not separately
state an array-ordering SLA; the adapter preserves the ordered arrays from each immutable finalized
response. It filters by execution `executor_id` matching the configured contract and
emits every matching log so unsupported/malformed events remain observable through the existing
decoder. `eventIndex` is the original index in that receipt's `logs` array, including non-NEP-297
logs. Receipt ID, transaction hash, block hash, and height come from provider response fields.
Missing matching-outcome identity metadata is an error; no identity is inferred.

Cursor strings are opaque `near-data:v1:` base64url JSON containing the next block height, offset
within matching contract logs, the previous finalized block hash, and (when resuming within a block)
the current block hash. `readFrom(height)` starts at that inclusive height. A page can persist a
checkpoint beyond its last event, including across empty blocks. The discovery processor writes
each event and its event cursor atomically, then persists the page checkpoint only after every event
in that page is durably processed. If page checkpoint persistence fails, restart resumes from the
last event cursor and safely rereads any trailing empty blocks.

This checkpoint extension is needed because the original Milestone 9 page contract could not persist
progress through blocks that contained no matching logs. Event/job identity remains unchanged and
duplicate delivery remains idempotent.

## Finality and recovery

Only `/v0/block/{height}` finalized data is consumed; the optimistic endpoint is never used. The
adapter checks expected block height, outcome block hash, cursor block hash when resuming mid-block,
and parent hash continuity at block boundaries. HTTP failures, 429s, timeouts, malformed JSON,
missing receipt metadata, and chain mismatches throw before the affected page checkpoint can
advance. GET retries are bounded (default three attempts) with bounded exponential backoff.

The provider reports finalized blocks, not provisional events and subsequent retractions. Therefore
there is no normal orphan-event path in this adapter and no rollback of committed discovery rows.
Parent-hash checks detect a discontinuity at the next checkpoint boundary; they do not audit all
older finalized history continuously or defend against a provider rewriting old data while
preserving a linked suffix. If that integrity incident is suspected, stop ingestion, retain the
index snapshot for audit, replay from a trusted earlier finalized height into a clean index, and run
contract-view reconciliation. The local JSON repository remains single-writer only.

## Testnet status

Repository/configuration search found no configured Disburse testnet account or deployment record.
The `disburse.testnet` strings in tests are fixture identifiers. No transaction or deployment was
attempted. Real Disburse event ingestion, payout view verification, and a deployment-height
backfill therefore remain blocked pending an authorized deployment record and contract account.

Read-only live-provider check: the FastNear testnet finalized-block endpoint returned block
`276635012` (10 shards, 4 receipt execution outcomes, one actual log). The response contained
receipt `Ckh3U4JaoKbg78qyxy7St3ZVzNpBaYKvjnd87NsMrqnH`, originating transaction
`AWn5ZDpRLh7JGRHuNpFtSAdVJx8K7UVDVMksrAsu3yuk`, executor
`ve.v5.oneupmarkets.testnet`, and block hash
`BPxLKXNs2gGZuDEmms9P29Wu9TnnJZmhFuTZC6qQtof2`. That actual
provider payload was passed through the adapter parser, which emitted the receipt/log identity.
This is unrelated testnet contract activity, not a Disburse event. A separate read of block
`100000000` returned four shards and two receipt outcomes but no Disburse executor logs. Adapter
HTTP fixtures remain deterministic and do not stand in for a deployed Disburse integration.

## Operational signals and limitations

`getDiagnostics()` reports configured network/account/start height, connection status, finalized-only
policy, last observed and finalized block heights, last page cursor, events retrieved, blocks scanned,
pages read, HTTP request count, and last successful page time. Processor results report processed,
duplicate, unknown, malformed, and job counts plus cursor and `hasMore`. Reconciliation results
report checked/changed/missing/failed counts; repository failure records retain provider error
classification. Orphan retractions are explicitly unsupported because the provider source is
finalized-only. The adapter avoids raw response and credential logging.

The service must still add deployment-specific metrics/alerts and a transactional multi-worker
repository before production. Public-provider rate limiting and archive availability can delay
backfill. A contract payout missing from an incomplete index is not evidence that it does not exist.

## Historical retention classification

The official block reference describes finalized block lookup and a missing/null response when a
height is unavailable. The provider also documents sequential historical reads, but does not state a
retention period or archival SLA. We therefore distinguish endpoint capability from a durable
retention promise: **no formal retention SLA was found**. We observed historical blocks available
during a read-only check, but that is not a guarantee. The documentation does not give receipt
outcomes/logs a separate retention commitment from the enclosing block response. Testnet and mainnet
practical availability are not established as equal. If a requested height is missing, the adapter
fails with `missing-history`; the indexer records an incident and does not advance through that
height as if it were empty.

Block/event archival, exact raw log preservation, cursor guarantees, and bounded recovery are
specified in [`near-discovery-integrity.md`](near-discovery-integrity.md). The local archive can
preserve only what the indexer actually observed. It does not authenticate FastNear or prove the
absence of omitted historical events.
