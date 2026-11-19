# M5-F.1C authorization expiry remediation

Local remediation inspected on 2026-11-18, starting at `b610cb44136f71923ef216ff082637c24c4d5389`. The initial 119 application hashes matched M5-F.1B. Initial unrelated review-document changes are preserved in `evidence/milestone-5/m5f1c/baseline.json` and `initial-working-tree.diff`. This implementation is awaiting independent re-review; it is not Testnet execution approval.

## Reproduced defect

`PostgresAuthorizationRepository.consume` checked expiry with `statement_timestamp()` in an UPDATE that could wait for another connection's row lock. PostgreSQL statement time stays fixed at statement start. The application preflight also precedes that wait. Consequently, releasing a lock after expiry could still permit consumption, with a backdated `consumed_at`.

Fresh pre-fix reproduction: expiry `18:37:31.560Z`, blocker released `18:37:31.587Z`, consumption accepted and timestamped `18:37:29.584Z` on 2026-11-18. The test observed the actual blocked consumer using `pg_blocking_pids`, then waited against the database deadline. It failed the assertion that consumption must be rejected. Approval and revocation had the same directly related timing defect and also failed their new contention tests. All three original failures are retained in `evidence/milestone-5/m5f1c/before-fix.log`.

## Minimal implementation

Only production file changed: `execution-service/src/persistence/postgres-security-repositories.ts`.

Each authorization lifecycle UPDATE now starts with two materialized CTEs. `locked_authorization` obtains `FOR UPDATE` on the authorization ID. Its dependent `authorization_decision` samples `clock_timestamp()` once after that lock has been acquired. The conditional UPDATE holds the lock through its decision and uses that same sampled value for expiry checks and audit timestamps. This remains a single atomic SQL statement and preserves the existing `PostgresQuery` interface, with no pool/transaction API change or schema migration.

Consumption still requires Approved lifecycle and the verified immutable authorization hash in its final UPDATE. Expiry is exclusive: `authorization_expires_at > decided_at` is required; equality rejects. The existing preflight verifies policy, request, quote and reservation bindings, but cannot override the final database clock. No TTL extension, grace period, retry or authorization weakening was introduced.

Approval, revocation and expiry marking use the same lock/time ordering. An expired authorization becomes Expired instead of Approved or Revoked. Existing terminal lifecycle and idempotent fallback behavior is retained. A failed consumption can intentionally mark an overdue authorization Expired, but never Consumed. A surrounding caller transaction can roll all writes back.

The unit SQL test double now recognizes a CTE-backed UPDATE before matching its embedded SELECT, and checks the updated expiry predicate. This corrects the mock dispatch rather than changing production behavior. New integration coverage is in `tests/integration/postgres-authorization-expiry.test.ts`.

## Related-path audit and limits

Authorization creation verifies hashes and persists immutable bindings; existing triggers and unique constraints remain unchanged. Quote expiry/freshness already bounds authorization expiry in `providers/signing.ts`. Refund policies have insert-only immutable approval/binding semantics, without a reusable expiring-consumption lifecycle.

Job transition/fencing paths in `postgres-job-repository.ts` already lock job and matching lease rows, use fresh `clock_timestamp()` for final lease validity and conditional mutations, and roll back stale updates. Lease renewal rechecks freshness and rolls back on zero-row renewal. Lease acquisition/cleanup uses statement time conservatively with locked rows; audit timestamps alone do not grant authority. No job/lease/reconciliation code was modified. Existing lease, rollback, restart and immutable-binding tests passed. This focused review did not reproduce another expiry vulnerability outside the corrected authorization lifecycle.

The protected decision time is after row-lock acquisition, not commit time or later signing time. Database clock accuracy remains an operational dependency. This fix does not authorize live workers or guarantee external settlement. Higher isolation callers may receive serialization errors and must not treat them as authorization success.
