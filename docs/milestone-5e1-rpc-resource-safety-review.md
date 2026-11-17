# M5-E.1 RPC resource safety

**PARTIAL:** transport streaming, deadlines, queue/concurrency, retry and receipt budgets pass; decoded inspector JSON protection has a low-severity gap (M5E1-02).

Reviewed 2026-11-17 at `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8`. Local/read-only audit only. [Structured evidence](evidence/milestone-5/m5e1-independent-review/results.json). Separate adversarial pass by the same assistant, not third-party certification.

## Transport verification

`near/http.ts` is shared by `near/rpc.ts`, `reconciliation/rpc.ts` and `near/providers/fastnear-neardata.ts`. Fixed-capacity byte buffer bounds accumulated decompressed chunks before UTF-8 decoding/JSON parsing. A chunk may already be allocated by the fetch implementation; this is not a claim to control its internal buffers or global process memory. Content-Length is an early rejection optimization, not the authority. Existing tests cover missing/false length, empty-chunk floods, gzip, terminated responses and strict JSON depth. Independent real-HTTP tests exercised both contract and evidence transports against chunked and gzipped oversized results (four combinations), slow trickle, queue cancellation/saturation/reuse, and 429 streams. Error bodies are cancelled without reading/parsing, a stronger non-materialization boundary than reading to the cap. Real HTTP lying length semantics depend on fetch framing; synthetic responses exercise misleading headers.

Defaults: 4 MiB/response, 10 s attempt including body, 15 s logical read including queue/backoff, four active, 32 queued, two attempts, 100 ms exponential bounded jitter, JSON nesting 64. Hard constructor caps reject invalid options. Permits span retries/backoff and are released on failure/cancellation. Queue cancellation removes the waiter. Backoff observes cancellation. Active actual fetch signals are aborted; custom nonconforming injected fetches are raced and late responses cancelled. No claim is made that arbitrary injected promises can be forcibly stopped.

Only timeout/unavailability/429/5xx read failures retry. JSON/RPC semantic/resource errors do not retry. Actual three-attempt 429 exhaustion observed. Runtime mutation allowlists prevented broadcast submission before fetch (zero wire requests). No uncertain transfer can be resubmitted by these clients. One logical call can generate two wire requests by default; 800 logical graph calls means at most 1600 attempts, also bounded by traversal duration. Archive uses configured 1–5 attempts. Limits are per reused client, not a global semaphore across independently instantiated clients.

## Graph and discovery

Defaults: 256 receipt outcomes, depth 32, 800 logical calls, 15 s traversal, four concurrent lookups and 2 MiB aggregate returned JSON/source. Two source observations are independently bounded. Validator rejects duplicates/cycles/multiple references/disconnected/missing nodes. Focused tests reject nodes/depth, missing and duplicate receipt evidence, call/byte/time exhaustion and cancellation; incomplete observation becomes ManualReview with null bundle, never positive settlement evidence.

Recovery defaults are 100 pages / 30 s per invocation and page size <=1000. Existing fresh tests verify failed checkpoint writes do not advance, capped recovery retains the last complete page across restart and a stalled source does not promote the cursor. Recovery timeout begins after setup reads, so it is a page-processing budget, not an end-to-end DB operation SLA. It races custom source reads; the archive source does not accept this external signal, but its own HTTP deadline/concurrency caps still contain outstanding reads. No stronger immediate custom-source shutdown guarantee is claimed.

No host background observer exists. `reconcileOnce` has no exposed shutdown signal; its one-shot observation remains duration bounded, while `observeAttempt` supports explicit cancellation. Host close does not constitute an immediate global cancellation API. Legacy 1Click quote HTTP code is outside these NEAR RPC clients and retains separate response handling; do not extend this certification to that dormant adapter or production.

## Confirmed exception

### M5E1-02 — LOW: Recipient token inspector omits decoded JSON depth guard

- Location: `execution-service/src/near/recipient-preflight.ts:117`.
- Expected: Decoded token-view JSON receives the same nesting cap before parsing as other NEAR view clients.
- Observed: A real HTTP query response with shallow outer JSON and byte-encoded 100-level nested JSON is accepted by TestnetInspector.view despite the shared default JSON depth of 64. The other generic and reconciliation view clients check decoded depth.
- Reproduction: adversarial.mjs: actual bounded transport still accepts deeply nested encoded token JSON; adversarial-results.json records depth 100.
- Impact: Declared JSON-nesting protection is incomplete on this inspection path. The 4 MiB outer streaming byte limit and request deadlines still apply; no unbounded response allocation, stack crash, false technical readiness or payment authorization was demonstrated. nativeRecipientPreflight metadata shape validation rejects this array.
- Recommendation: Apply decoded UTF-8/depth validation consistently before exactJson in TestnetInspector.view, with actual-transport encoded-payload tests.
- Local safety acceptance blocked: no. Controlled operational experiment/production gate: resolve before integration. Close the claimed resource-hardening coverage gap before integrating this preflight into an approved experiment.


The 100-level encoded payload passes actual HTTP transport and TestnetInspector.view. Generic contract and reconciliation views separately guard inner decoded depth. The outer 4 MiB cap remains; malformed metadata cannot yield technical readiness. Close the consistency gap with a local fix and dedicated actual-transport regression before operational integration.

Evidence: [18 focused cases](evidence/milestone-5/m5e1-independent-review/adversarial-results.json), [fixture](evidence/milestone-5/m5e1-independent-review/adversarial.mjs), [service run](evidence/milestone-5/m5e1-independent-review/service-check.log).
