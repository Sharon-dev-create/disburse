# M5-E.1 execution safeguards and payment preservation

Reviewed 2026-11-17 at `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8`. Local/read-only audit only. [Structured evidence](evidence/milestone-5/m5e1-independent-review/results.json). Separate adversarial pass by the same assistant, not third-party certification.

## What is enforced

Host composes only read capabilities, a GET API and bearer authorizer; no signer, private-key lookup, payout worker, authorization consumption or broadcast interface. Missing required configuration, malformed mode, wrong network/contract in restricted mode and missing API authentication fail closed. Independent fixture exercised missing/malformed/conflicting identity, denied mutation and auth gates, dependency failure and reconnect. Fresh existing tests cover generic paused startup, active-mode identity, unavailable DB and routes. No runtime configuration or credentials were opened or changed.

Restricted active-Testnet mode is **explicit**, not the default DB setting: true pins Testnet/isolated contract, old deployed code hash/owner, token/Operator checks, loopback/local-only host and read-only PostgreSQL pool sessions; startup checks migrations rather than applies them. If mode is absent/false the generic paused host can apply migrations and is not equivalent to read-only DB, although it still has no execution capability. Do not infer default read-only database access from no payout signer. Future candidate deployment would intentionally invalidate the current old-code pin and requires separately reviewed configuration work.

No signing identity/custody or real environment correctness was verified. Test DB isolation was independently checked as disburse_test role/database on 127.0.0.1:19549. Mainnet execution was never attempted. Network errors/readiness changes cannot instantiate a worker or signer. Existing process-restart/lease tests and local observer restart pass; an actual PostgreSQL server restart was not separately performed. A database restart cannot add a capability absent from the host composition; this is structural reasoning, not a live restart experiment.

## What is dormant

`operations/safeguards.ts` checks isolated network/token/contract, <=100000 atomic payout, <=1000000 campaign exposure, <=4 pending, one attempt, bounded timeout, emergency-stop boolean and independent identities. Always executionEnabled:false. No host/worker dispatch path consumes it. Caller-supplied recipientVerified is not ownership proof. These policies are local checks, not enforced live spending, rate, retry, emergency-stop or custody controls.

## Native/payment preservation

Rust, schema, native/legacy repositories, authorization/refund code and historical layout are unchanged from D.4. Fresh build identity matches reviewed candidate. Source reinspection confirms explicit Executor and independent Approver/reserver, immutable payout/token/recipient/amount binding, expiry/revocation checks at entry and storage callback, monotonically bound attempt, one consumed approval, TransferPending before dispatch and private self/current-attempt settlement. Success moves reserved to spent once; token failure, malformed result, panic/OOG or missing callback preserve truthful unresolved locks. Legacy mutation restrictions and historical Borsh compatibility remain intact in fresh real receipt/migration tests.

Six fresh adversarial lease cases confirm: expired native row-lock completion rejects; valid short contention succeeds; expiry after decision INSERT rolls back final update; legacy post-lock expired transition and release reject with unchanged state/version; delayed acquired lease cannot authorize a later protected write. Existing 46 PostgreSQL tests cover stale fences, worker takeover, repeated/zero-row release, concurrency, rollback, cleanup and process death/restart.

Reconciliation adds only bounded reads and local evidence classification. Forged authorization/incomplete graphs remain ManualReview. No signer, on-chain settle/release, automatic resend or manual-success override was introduced. Distinct configured RPC origins do not prove independent operators. Authenticated on-chain recovery remains unresolved and blocked; never use off-chain observation as settlement authority.
