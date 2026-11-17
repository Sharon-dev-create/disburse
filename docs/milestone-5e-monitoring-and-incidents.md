# M5-E monitoring and incidents

OperationalMonitor emits only predefined event names, timestamps and explicitly validated correlation fields. It discards arbitrary errors, headers, URLs, credentials and configuration. Metrics use fixed event names only, not payout/account/transaction IDs. Bounded HTTP clients record terminal timeout/rate-limit/resource/uncertainty counters. The monitor supports checkpoint, lease/fence, callback, ManualReview and restart categories; these categories are not all wired into existing repositories. Persistence and lease code were preserved for the D.4 safety boundary.

/healthz remains process liveness. Authenticated GET /v1/readiness reports read-only database and RPC probes, discovery/reconciliation freshness conservatively false without a running observer, and executionReady:false always. It exposes no account IDs, connection strings or secrets. No public metrics server or background collector was started. Dependency probes are read-only; RPC requests are bounded and database queries retain pool timeouts.

Metrics to collect before operational rollout: request latency/count/error ratio, rate limits, discovery lag and checkpoint failures, backlog, active/expired leases, fence rejections, TransferPending age, ManualReview/unknown counts, transaction failures and restarts. Current instrumentation is partial; remaining gauges require an approved read-only collector and consistent snapshots. Do not label execution ready from liveness or absent local records.

| Incident | Detection and containment | Evidence/investigation | Recovery/escalation |
|---|---|---|---|
| RPC outage or rate limit | classified errors/readiness; stop affected collection | retain last durable cursor and endpoint category | bounded read retries, resume same cursor; no payout resubmission |
| Oversized/malformed response | resource/malformed failure; cancel stream | retain safe category, limit and snapshot locator | inspect provider independently; no automatic limit increase |
| PostgreSQL outage | readiness/transaction error; stop persistence | retain immutable source locators; redact connection secrets | restore DB and validate migrations/ownership before resuming |
| Lease conflict/expiry | stale/fence rejection; abandon stale write | worker/job/fence and transaction history | reclaim through existing fenced API only; never override ownership |
| Reconciliation backlog | age/backlog alert; limit work | inspect bounded observations/checkpoints | resolve provider/DB issue, resume bounded reads |
| Unknown transfer/missing callback | ManualReview or old TransferPending; stop dispatch | exact canonical token/callback receipts and binding | preserve locks/reserve; authenticated recovery remains blocked |
| Unexpected balance | custody/accounting mismatch; stop dispatch | pinned balances, incoming/outgoing receipts and campaign ledger | independent investigation; no ad-hoc rescue/ledger edit |
| Recipient mismatch | preflight/binding rejection | approved immutable destination and ownership evidence | invalidate evidence; require new approved workflow, no substitution |
| Wrong network/configuration | startup/preflight mismatch | safe config fingerprint and source revision | correct local configuration under review; no fallback network |
| Unauthorized execution | denied route/policy/role | safe caller/correlation audit evidence | stop and escalate custody review; no privilege bypass |
| Emergency pause | operator incident escalation | preserve in-flight state and receipt graph | separately authorized on-chain pause stops new dispatch; allow truthful callback settlement, never reset pending locks |

All unresolved cases keep execution disabled. Incident procedures do not grant authority to deploy, pause, transfer, release reserve or settle from off-chain observations.
