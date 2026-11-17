# M5-E.1 monitoring and incident readiness

**PARTIAL.** Reviewed 2026-11-17 at `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8`. Local/read-only audit only. [Structured evidence](evidence/milestone-5/m5e1-independent-review/results.json). Separate adversarial pass by the same assistant, not third-party certification.

## Coverage

| Capability | Verified state |
|---|---|
| Error classification | Fixed NearRpcError kinds; retries limited to safe transient reads |
| Structured events | Allowlisted names and validated numeric/hash correlation fields; arbitrary errors/URLs/headers discarded |
| Cardinality | Fixed 12 event dimensions; no payout/account/transaction metric labels |
| Terminal timeout/rate/resource failures | Per-client in-memory counters |
| RPC latency, request count, global exporter | Missing (archive has local request counters, not system telemetry) |
| Discovery lag/checkpoint, backlog, leases/fencing | Event vocabulary or existing snapshots; no complete operational collector/alerts |
| TransferPending age, ManualReview/unknown count, DB failures | No wired global gauges/alerts |
| Process liveness | Unauthenticated /healthz; only process health |
| Dependency readiness | Authenticated /v1/readiness; independent DB/RPC booleans; executionReady always false |
| Discovery/reconciliation freshness | Conservatively false without a running observer |

Default monitor emitter is a no-op and counters are per client; fixed schemas do not mean logs are shipped or that all event categories fire. Independent tests prove structured monitor redaction, fixed readiness during DB/RPC outages, auth rejection and mutation denial. Readiness HTTP 200 carries diagnostic booleans; it is not a successful execution gate. Liveness stays 200 during dependency outage by design. PostgreSQL pool timeouts bound configured probes, but no global readiness request rate limit was added.

## Exception gap

### M5E1-01 — LOW: Startup error sanitization echoes untrusted RPC text and reflected URL credentials

- Location: `execution-service/src/host/server.ts:233`.
- Expected: Startup diagnostics exclude endpoint secrets and arbitrary provider text.
- Observed: A real local status endpoint reflects a synthetic URL-path token as chain_id. NearContractReader includes it in its network-mismatch message; sanitizeHostStartupError preserves that entire message. The normal CLI prints the returned message.
- Reproduction: adversarial.mjs: startup exception redaction adversarial reproduction; adversarial-results.json contains the synthetic canary only, no real secret.
- Impact: Potential credential disclosure/log injection into startup log readers. The provider already sees its URL token; no private key or unrelated database secret was recovered. Startup still fails closed. Existing sanitizer behavior predates M5-E.
- Recommendation: Use a fixed allowlist of safe startup error codes/messages; never copy provider-controlled chain_id or raw error messages into logs. Add adversarial exception/URL-reflection regression coverage.
- Local safety acceptance blocked: no. Controlled operational experiment/production gate: resolve before integration. Resolve before credential-bearing operational startup; this gate does not assert a token-transfer or authorization bypass.


The synthetic status endpoint reflects its request path, proving an RPC URL token can reach startup exception text. This is a concrete lower-severity gap in broad redaction claims; no real secrets were used. It does not establish leakage of unrelated bearer/private-key/DB credentials.

## Incident procedures and gate classification

Existing M5-E runbooks cover RPC/DB outage, oversized evidence, lease conflicts, reconciliation stalls, unknown transfer/missing callback, recipient mismatch, unexpected balance and emergency pause. They correctly preserve cursors/immutable evidence/locks, prohibit resend or fabricated settlement, and require separately authorized pause/recovery actions.

Before one isolated Testnet experiment: close startup exception leakage; have a named observer and stop authority, bounded amount/one attempt, working connectivity, pinned pre/post balances, canonical receipt capture, manual timeout/unknown review and a separately approved pause action. Automated production telemetry is not universally mandatory if equivalent explicit manual supervision is documented and tested. Dormant emergencyStop is not an on-chain stop mechanism; an in-flight transfer cannot be undone by pause.

Before production: integrated safe logs/exporters, latency/error/rate metrics, consistent backlog/lease/fencing/TransferPending/ManualReview gauges, alerts/SLOs, authenticated operator workflow and rehearsed incident/restart procedures. Optional: richer dashboards and long-term tracing once baseline safe monitoring exists. No collector or live worker was enabled for this review.
