# M5-F.1B findings

Review date: 2026-11-18. Source identity: `docs/evidence/milestone-5/m5f1b/source-identity.json`. No implementation was changed during review.

## F1B-M01 — authorization can be consumed after expiry during a row-lock wait

**Severity: MEDIUM. Status: OPEN, reproduced.**

Affected source: `execution-service/src/persistence/postgres-security-repositories.ts:173`–`182`, especially the expiry condition on line 178 and timestamp on line 175. `verifyExecutionAuthorization` validates the caller-supplied pre-wait time in `execution-service/src/providers/signing.ts:526`; this does not protect the later database write. Git blame traces the SQL to `f469fffc`, before M5-F.1A; this is a pre-existing defect found during review, not a newly introduced regression.

Preconditions: a valid Approved durable execution authorization; consumption begins before its deadline; another PostgreSQL transaction holds the authorization row lock until after expiry. The caller can be delayed by ordinary lock contention. No blockchain access is needed to reproduce.

Reproduction uses the actual `PostgresAuthorizationRepository` and existing authorization fixture in the dedicated `disburse_test` database. The executable probe is `docs/evidence/milestone-5/m5f1b/authorization-expiry-lock-probe.ts`; results are in the corresponding `.json`. It creates/approves a synthetic authorization with a 2500-ms TTL, locks its row with `SELECT ... FOR UPDATE`, starts `consume`, waits until PostgreSQL reports the actual blocking relationship, waits past the stored expiry, verifies fresh database time has expired, then releases the lock and inspects the result. The probe reports the discrepancy rather than asserting the unsafe result as intended behavior. It never signs or submits a transaction.

Expected: reject expired consumption and preserve the prior authorization state, or explicitly expire it; never return a new Consumed authorization after waiting past its deadline.

Actual: `consume` succeeds with lifecycle `Consumed`. Expiry was `2026-11-18T17:58:54.458Z`; the lock was released at `17:58:54.761Z`, after expiry. Stored `consumed_at` is `17:58:51.993Z`, the pre-wait statement start, obscuring when the state change actually became possible. `statement_timestamp()` stays fixed throughout the waiting statement.

Impact: the durable execution-authorization deadline is not enforced across row-lock contention, and the stored consumption time can precede the actual update. This is a meaningful authorization/evidence weakness that must be remediated before enabling a consumer for execution. The current host composes no signer/worker; this reproduction demonstrates a database authorization transition, not unauthorized token movement. Native Rust authorization independently rechecks blockchain expiry, so this finding must not be represented as a proven native-contract expiry bypass.

Minimal remediation recommendation: obtain the relevant row lock before final expiry validation, then validate using fresh PostgreSQL wall-clock time and apply an atomic lifecycle/hash/deadline-guarded update with authoritative post-lock time. Preserve single-winner consumption and interface semantics. Simply replacing `statement_timestamp()` in an UPDATE predicate without proving evaluation occurs after lock acquisition is insufficient. Add deterministic expired/valid lock-wait, competing consumer/revoker, rollback and accurate consumption-time regressions. Review related authorization lifecycle transitions for the same timing assumption. No fix was made in this review.

## F1B-L01 — conditional account-creation plan names the existing contract as receiver

**Severity: LOW. Status: OPEN, documentation defect.**

Affected file: `docs/milestone-5f1-controlled-transaction-plan.md:7` and `:8`.

Preconditions: an operator later translates the old non-executable plan into actual account-creation transactions without correcting its receiver fields.

Reproduction: read the first two plan rows. Both use `disburse-m12.testnet → disburse-test-contract.testnet` for CreateAccount actions, including the row intended to create three distinct children. The parent is itself absent and cannot yet sign. The account/key plan elsewhere correctly requires separately approved parent creation followed by child creation.

Expected: separately verified registrar/creation flow targeting the proposed parent, then the controlled parent signing three distinct transactions with each exact child as receiver. No CreateAccount action should target the already existing historical contract.

Actual: the displayed receiver is the existing contract in both rows. These are not executable NEAR action serializations and the parent signer is unresolved.

Impact: operational confusion and failed or misprepared future transactions. The plan explicitly says PARTIAL, non-executable and not authorized, reducing immediate impact; this is not evidence that a transaction ran or that funds moved.

Minimal remediation recommendation: correct receivers/signers in a separately prepared future exact manifest; keep registrar, public keys, amounts and approval boundaries unresolved until verified. Do not reuse these old rows as executable approval material. Earlier evidence was preserved without editing it.

## F1B-I01 — unchanged candidate cannot initialize native functionality on a new account

**Severity: INFORMATIONAL. Status: future deployment blocker.**

Affected source: `src/state/native.rs:11`, `src/native.rs:27` and `src/native.rs:423`.

Preconditions: deploying the current candidate to an account other than `disburse-test-contract.testnet` and attempting native initialization/use.

Reproduction: inspect the hardcoded CONTRACT and bootstrap/runtime checks; existing Rust wrong-account tests independently exercise rejection.

Expected: retain the explicit identity invariant; a new deployment identity requires an approved design and reviewed build rather than silently reusing the artifact.

Actual: initialization and runtime native configuration reject a different current account. The prior assessment accurately documents this. The candidate can be considered only for a separately reviewed upgrade of the named historical isolated account with state/custody preservation; deployment is not approved here.

Impact: future new-account deployment cannot proceed with unchanged WASM. Account absence itself is not a software vulnerability.

Recommendation: choose and separately approve the deployment strategy. If choosing a different account, review identity/binding/migration changes and rebuild/retest; if retaining the named account, separately review exact upgrade, pause, legacy hash, roles, custody and rollback/containment steps. Do not remove the guard during this review.

## Severity totals

Critical 0; High 0; Medium 1; Low 1; Informational 1. No implementation remediation was applied. Regression success does not close F1B-M01: the existing suite does not contain this authorization lock-wait expiry case.
