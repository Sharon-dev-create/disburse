# NEAR event provider evaluation

**Reviewed 2026-11-07.** Provider claims below are based on the linked provider documentation and
the adapter's deterministic HTTP tests. A successful testnet Disburse ingestion has not been
observed because this repository has no configured deployed Disburse account.

## Candidates

| Candidate | Testnet and historical replay | Receipt logs and identity | Finality, reorgs, and operations | Decision |
|---|---|---|---|---|
| FastNear NEAR Data (`neardata.xyz`) | Mainnet and testnet endpoints; fetch finalized blocks by height and walk sequentially from an arbitrary start height. The provider documents historical sequential reads. | Full block documents include shards and `receipt_execution_outcomes`; the provider documents a `tx_hash` on each receipt outcome. The adapter uses outcome ID as receipt ID and each log's original index within that receipt. | `/v0/block/{height}` is finalized; `/v0/block_opt/{height}` is optimistic. This adapter only uses finalized data. The provider documents 180 requests/minute without a subscription and optional API-key authentication. Finalized-only input avoids ordinary provisional retractions, but the API does not document a historical retraction feed or guarantee detection of provider-side archive corrections. | **Selected.** Strong fit for arbitrary-height, receipt-level replay with a simple read-only HTTP API and no required account. |
| NEAR Lake / NEAR Lake Framework | Testnet S3 bucket and start-from-height support are documented. Historical traversal is possible by reading block and shard objects. | Block/shard JSON includes execution outcomes and logs; joining receipt outcomes to their originating transaction identity is more work for this contract's identity shape. | S3 Requester Pays and AWS credentials are required for public buckets. The framework is self-hosted/streaming-oriented; operators own durable cursoring, reorg policy, and service availability. | Viable alternative if we operate the indexer/S3 consumer; more operational burden for this initial read-only adapter. |
| FastNear Transactions API | Testnet host and bounded block-range endpoint are documented. | The documented block-range response is block metadata; receipt lookup and transaction-history endpoints are separate, requiring additional joins to reach logs. | API key required by current docs; history service constraints/rate limits are provider-managed. | Not selected because the documented range endpoint is less direct for complete receipt-log scanning. |
| Self-hosted NEAR Indexer Framework | Testnet indexing is supported; start point and history depend on the operator's node/archive setup. | Can expose raw shard/receipt execution messages and logs. | Requires archive node/indexer operations, durable storage, monitoring, and an explicit finality/reorg policy. | Suitable for a later deployment with dedicated infrastructure; not needed to validate the existing source boundary. |

## Selected provider: FastNear NEAR Data

The adapter calls `GET /v0/last_block/final`, then sequential `GET /v0/block/{height}` requests.
It scans shard IDs in ascending order and preserves each shard's receipt execution outcome order
and each receipt's log order. Only execution outcomes whose `executor_id` equals the configured
Disburse account are emitted. It carries the returned block hash, receipt ID, originating
transaction hash, and the original log array index without synthesizing identifiers.

Finalized blocks are the adapter's inclusion/finality boundary. NEAR consensus describes finalized
blocks as blocks that cannot be reverted by a future final-chain extension. The adapter persists
the block hash at its cursor boundary and checks block `prev_hash` continuity on subsequent reads.
It does not poll optimistic blocks, so an unfinalized event cannot enter the discovery processor.
There is no orphan/retraction implementation for finalized history: the provider API does not
document a rollback feed, and this repository does not yet support deleting/reverting an indexed
event. A provider correction or consensus safety failure therefore needs operator investigation
and a controlled rebuild/reconciliation; it is not silently repaired.

The adapter retries idempotent GETs at most three times by default, with bounded exponential delay.
It respects a configured timeout, classifies rate limits and transport errors, and does not return a
cursor after an unsuccessful block read. Public usage is documented at 180 requests/minute per IP;
long historical scans are sequential and may take substantial time. No historical retention SLA or
provider uptime SLA is claimed here. Verify the provider's live retention and commercial terms
before production use.

Replace the provider by implementing `NearEventSource` and preserving the same ordering, identity,
finality, and cursor guarantees. Do not change `PayoutDiscoveryProcessor` to add provider-specific
parsing.

## Sources

- [FastNear NEAR Data server documentation](https://github.com/fastnear/neardata-server)
- [FastNear NEAR Data API reference](https://docs.fastnear.com/neardata)
- [FastNear Transactions API block range](https://docs.fastnear.com/tx/blocks)
- [NEAR Lake Indexer](https://github.com/near/near-lake-indexer)
- [NEAR Indexer Framework](https://github.com/near/nearcore/tree/master/chain/indexer)
- [NEAR consensus specification](https://github.com/near/nearcore/blob/master/docs/ChainSpec/Consensus.md)
