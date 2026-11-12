# Execution service read API

The execution service now provides a small authenticated HTTP boundary around
the existing read-only NEAR contract client. It exposes finalized contract
views only. The API does not submit contract transactions, request 1Click
quotes, create execution authorizations, operate a worker, or report
destination-chain settlement.

## Endpoints

All responses are JSON. Except for liveness, every endpoint requires the host
application's `authorize(request)` callback to approve the request. The API
does not prescribe an identity provider or implement a static bearer token.
Keep authentication credentials server-side; do not put them in the frontend
or browser requests.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness only; it does not query NEAR. |
| `GET` | `/v1/payouts/{payoutId}` | Current payout view from the configured contract. |
| `GET` | `/v1/campaigns/{campaignId}/payouts/{payoutId}` | Payout view scoped to its campaign. |
| `GET` | `/v1/campaigns/{campaignId}/accounting` | Current campaign payout accounting. |

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
block-coherent execution authorization.

Network and asset identifiers, token amounts, recipient formats, status
values, and returned contract references are validated at runtime. NEAR and
EVM address syntax checks are not proof of ownership or delivery. The API does
not infer that a quote, submitted transaction, or contract status independently
proves destination-chain settlement.

## Composition and startup checks

`startExecutionApiServer()` accepts a configured `NearContractReader` and a
host-supplied request authorizer. It verifies the RPC-reported NEAR network and
calls the existing `is_paused` view before binding the listener; this detects
network or ABI mismatch but does not prove that the configured deployment is
approved or production-ready. Bind to loopback by default and put deployment-
grade TLS, identity, authorization policy, rate limiting, and audit logging in
the trusted host environment.

No Disburse testnet deployment is currently evidenced in this repository.
Therefore the API can be tested with deterministic RPC fixtures, but a live
contract API integration has not been run. The API is not wired into the
Next.js frontend.

## Deliberately unavailable operations

The API has no quote endpoint, authorization creation/approval/consumption
endpoint, execution-status or worker endpoint, refund endpoint, reconciliation
endpoint, verification endpoint, or settlement endpoint. Although quote and
authorization policy primitives exist, a coherent block-pinned reservation
read, authenticated signer, production worker/provider, durable execution-job
repository, independent destination verifier, and live contract writer are
not implemented and wired together. Adding routes for them would imply
capabilities the service does not have.
