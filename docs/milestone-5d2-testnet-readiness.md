# M5-D.2 readiness assessment

Assessment date: 2026-11-17. Source and local tests only; no live deployment, operational account audit or token certification is implied. The historical public bytecode was fetched read-only and hash-checked solely for local migration tests.

## Separate decisions

**Interactive workspace: BLOCKED for mutations.** The current dashboard is a read-only/demo interface. `frontend/src/app/dashboard/campaigns/new/layout.tsx` intentionally renders creation unavailable and does not render its child form. The child page itself is browser-only preview code. RecipientDirectory reads demo data. Contract payout/status pages use read APIs and have loading/error/not-found states; they do not implement secure creation, recipient changes or approval submission.

**Controlled Testnet payout execution: BLOCKED.** Local native behavior does not establish the actual Tidepool token's transfer atomicity, return values, receipt graph or gas/storage behavior. The live recipient remains `RECIPIENT_UNVERIFIED`. On-chain authenticated recovery is absent. No deployment, migration, role separation, funding caps or incident response approval is granted here. The new legacy lease finding must be addressed before enabling execution paths that depend on that repository.

## Workspace controls reviewed

| Control | Verified current behavior | Requirement before interactive mutations |
|---|---|---|
| Authentication | host/auth.ts validates a shared demo bearer with timingSafeEqual; frontend execution-api-auth.ts forwards auth/cookie or server-side demo token | real user identity, session lifecycle, revocation and login tests |
| Authorization | contract checks roles independently; API authorizer is a boolean shared-token gate | per-user/per-resource access rules; independent approver/executor workflows |
| API mutations | api/http.ts:165 denies non-allowlisted/read-only requests; :178 supports only GET even outside restricted mode | separately reviewed explicit mutation routes with schemas and permission checks |
| CSRF | no current state-changing browser API; no CSRF protection demonstrated for future cookie-authenticated writes | chosen session model, origin/CSRF policy, replay tests |
| Idempotency | on-chain immutable payout bindings and DB job idempotency exist locally | end-to-end authenticated mutation idempotency and concurrent/replay coverage |
| Audit logging | host lifecycle logs and local immutable evidence exist | attributable user/action/approval audit events, retention and access policy |
| Input validation | canonical IDs, API rejects bodies/query strings, bounded lookup interfaces; demo form only validates locally | server-authoritative schemas, atomic amount parsing and destination verification |
| Rate limiting | no inbound limiter established in reviewed host/API | per-user/IP limits and bounded expensive operations |
| Secrets | demo token read on server; explicit warning against NEXT_PUBLIC; reconciliation RPC has no keychain/signer | real secret lifecycle and deployment checks; shared demo token cannot establish user identity |
| UI states | loading/error/not-found and read-only notices exist in source | authenticated, persisted mutation states and verified execution/evidence displays with integration tests |

The active read-only host composes a read-only PostgreSQL pool, asserts migrations instead of applying them, exposes read capabilities and starts no signer or worker (`host/server.ts:49,114,133`). This review did not inspect or alter real environment secret values. Source guarantees do not certify the current settings of an independently running deployment.

Native M5-D reconciliation history is not wired into the running host/API/dashboard. Existing payout and execution-job displays are not a native receipt-evidence viewer. Exposing history needs read authorization, pagination, evidence provenance/trust labels and tests; local database rows are not proof of payment.

## Readiness matrix

| Capability | Current status | Evidence | Blocker | Required next action |
|---|---|---|---|---|
| Interactive campaign creation | BLOCKED | creation layout hides form; API GET-only | no authenticated mutation workflow | implement and audit identities, permissions, schemas, idempotency and logs under separate approval |
| Recipient management | BLOCKED | RecipientDirectory uses demoRecipients | no verified controlled recipient or persisted authorization workflow | verify recipient control and token storage; design secured management |
| Payout preparation | LOCAL PRIMITIVES VERIFIED; WORKSPACE BLOCKED | Rust binding/reservation tests | no authenticated preparation UI/API | build bounded preparation and immutable approval preview |
| Independent approval | LOCAL CONTRACT VERIFIED; LIVE BLOCKED | native approval/execution role checks and tests | live accounts/roles and operational separation unverified | independently establish signer custody and role separation, then approve exact actions |
| Native token transfer | LOCAL VERIFIED; TESTNET BLOCKED | fresh sandbox receipt evidence | actual Tidepool semantics and recipient unverified | read-only token review, then separately approve capped compatibility test |
| Callback settlement | LOCAL VERIFIED; TESTNET BLOCKED | private callback/accounting/fault tests | live artifact/config/token compatibility | migration review, role/config preflight and exact deployment approval |
| Read-only reconciliation | LOCAL VERIFIED; API INTEGRATION INCOMPLETE | worker/verifier/repository and live local RPC tests | trusted RPC assumption, locator pipeline, no history API/UI | repair legacy lease paths; separately approve bounded observer/read API integration |
| Authenticated recovery | BLOCKED | worker emits observations only; no recovery method | no approved proof/attestation trust model or on-chain authorization | design independently reviewed recovery protocol; never retry uncertain transfer |
| Testnet deployment | BLOCKED | local historical/B migration tests only | recipient/token checks, migration/runbook/limits/roles/monitoring approvals missing | prepare exact deployment artifact and migration rehearsal plus separate authorization |
| Production execution | BLOCKED | local-only reconciliation repository; shared demo auth | no production threat model/operations certification | further independent review, production controls, monitored rollouts and separate approval |

## Controlled execution prerequisites

Review the real token code hash, upgrade/governance controls, ft_transfer ABI, storage registration, atomic failure semantics, success return/event behavior and gas usage. Confirm recipient control without substituting an owner/operator/contract. Pin the candidate contract/WASM and reviewed state layout, rehearse migration against an authenticated state snapshot and define rollback limitations. Verify pause stops new dispatch but does not suppress settlement of an already dispatched token receipt. Establish independent Operator/reserver, Approver and Executor custody, with no owner bypass.

Approve per-payout/campaign/aggregate funding caps, NEAR gas/storage headroom, an exact transaction and observable postconditions. Establish two operationally independent RPC sources, transaction locator capture, alerting for stuck TransferPending/ManualReview and expiring/reclaimed leases, incident ownership and a pause/escalation runbook. Local localhost/127.0.0.1 aliases of one validator do not prove RPC operator independence.

Do not clear reservations, retry uncertain transfers or treat PostgreSQL decisions as settlement facts. Authenticated recovery needs a separately approved trust model and on-chain implementation; read-only reconciliation can remain useful while recovery stays blocked.

Recommended next milestone: **local legacy lease-write remediation and adversarial re-review**, followed by a separately approved authenticated read-only evidence/workspace design. Interactive mutations, controlled Testnet compatibility and deployment are distinct later approvals. No production worker, signing, mutation route or live operation is enabled by this report.
