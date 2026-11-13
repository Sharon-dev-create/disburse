# Execution service read API

The execution service provides an authenticated HTTP boundary around the
read-only NEAR contract client and, when supplied by the host, the durable
PostgreSQL job repository. It has no payout mutation or execution routes. The
API does not submit contract transactions, request 1Click quotes, create
execution authorizations, operate a worker, or independently verify
destination-chain settlement.

## Endpoints

All responses are JSON. Except for liveness, every endpoint requires the host
application's `authorize(request)` callback to approve the request. The API
does not prescribe an identity provider or implement a static bearer token.
Keep authentication credentials server-side; do not put them in the frontend
or browser requests.

| Method | Path                                                         | Result |
| ------ | ------------------------------------------------------------ | ------ |
| `GET`  | `/healthz`                                                   | Liveness only; it does not query NEAR or PostgreSQL. |
| `GET`  | `/v1/payouts/{payoutId}`                                     | Current payout view from the configured contract. |
| `GET`  | `/v1/campaigns/{campaignId}/payouts/{payoutId}`              | Current payout view scoped to its campaign. |
| `GET`  | `/v1/campaigns/{campaignId}/accounting`                      | Current campaign accounting and funding-token precision. |
| `GET`  | `/v1/campaigns/{campaignId}/payouts`                         | Up to 100 most-recent persisted job snapshots for the campaign. |
| `GET`  | `/v1/campaigns/{campaignId}/payouts/{payoutId}/execution`    | Persisted execution state and attempts for one campaign payout. |

Identifiers in paths must be canonical unsigned decimal strings within NEAR
`u64` range. The API rejects request bodies and query parameters. Missing
records return `404`; RPC, decoding, and response-schema failures are returned
as upstream errors, not disguised as missing records.

Payout responses include source and destination token identities, exact
atomic-unit strings, decimals, status, and contract references. Raw evidence
blobs are not returned. Campaign accounting amounts remain decimal strings and
are checked for `reserved + spent <= funded <= budget` and
`available = funded - reserved - spent` before serialization. Contract views
and accounting are fetched separately and must not be combined as a
block-coherent execution authorization. Accounting token precision is read
from the campaign's funding-token NEP-141 `ft_metadata` view; if that metadata
cannot be validated, the accounting response fails rather than guessing
decimals.

Persisted-job endpoints require the host to pass the PostgreSQL job repository
as `jobs` when composing `startExecutionApiServer()`. The list is ordered by
creation time descending and capped at 100 records; `data.truncated` identifies
additional records. Each item reports execution state and contract status as
observed when the immutable job snapshot was created. It is not a current
contract read. The campaign-scoped execution detail endpoint returns the same
persisted snapshot plus attempts, exact atomic amounts, persisted timestamps,
and optional lease expiry. It does not expose raw failure descriptions, worker
identity, or fencing tokens.

Persisted job state is operational state, not a financial ledger or proof of
destination-chain delivery. The current contract payout endpoint remains the
source for present contract state. A `Completed` execution job does not mean
independently verified destination-chain delivery.

Network and asset identifiers, token amounts, recipient formats, status
values, and returned contract references are validated at runtime. NEAR and
EVM address syntax checks are not proof of ownership or delivery. The API does
not infer that a quote, submitted transaction, or contract status independently
proves destination-chain settlement.

## Composition and startup checks

`startExecutionApiServer()` accepts a configured `NearContractReader`, a
host-supplied request authorizer, and optionally the durable jobs repository.
All data routes, including persisted-job reads, use the same authorizer. The
server verifies the RPC-reported NEAR network and calls the existing
`is_paused` view before binding; this detects network or ABI mismatch but does
not prove that the configured deployment is approved or production-ready.
Bind to loopback by default and put deployment-grade TLS, identity,
authorization policy, rate limiting, and audit logging in the trusted host
environment.

No Disburse testnet deployment is currently evidenced in this repository.
The Next.js frontend has a server-side client for this API, but the repository
does not contain a standalone API host or identity provider. A host must
compose the reader, PostgreSQL jobs repository, and its own authorization
callback. No credentials or static bearer token are supplied by the frontend.

## Deliberately unavailable operations

The API has no quote endpoint, authorization creation/approval/consumption
endpoint, execution-status or worker endpoint, refund endpoint, reconciliation
endpoint, verification endpoint, or settlement endpoint. Although quote and
authorization policy primitives exist, a coherent block-pinned reservation
read, authenticated signer, production worker/provider, durable execution-job
consumer, independent destination verifier, and live contract writer are not
implemented and wired together. Adding routes for them would imply
capabilities the service does not have.
