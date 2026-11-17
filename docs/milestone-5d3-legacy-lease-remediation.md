# M5-D.3 legacy lease remediation

Local implementation on 2026-11-17, baseline `fe2a015bcd9378432ac9df3fe555acc1ebae6b52`, clean `main...origin/main`. The legacy source SHA matched the vulnerable M5-D.2 reviewed snapshot before implementation. Earlier D.1 narratives removed in the approved documentation cleanup were read from revision 24193ab without restoring or modifying them. Existing D.2 reports and all earlier raw evidence remain unchanged.

## Root causes and reproduction

M5D2-01: transition validated ownership before a later SQL UPDATE could wait, then nonterminal updates checked only state/version. M5D2-02: release ignored the conditional DELETE's affected-row count and unconditionally bumped job version.

Two new integration tests were executed against the unchanged vulnerable implementation before remediation. Both failed their safety assertions because the operations incorrectly succeeded. Each used a 500 ms lease, an independent transaction and a real PostgreSQL blocking barrier followed by a 900 ms hold.

| Operation | Before fix | After fix |
|---|---|---|
| Leased → Preparing | Accepted after 917.22 ms; UPDATE rowCount 1; version 2 → 3 | Rejected after 910.87 ms; rowCount 0; version stays 2, state Leased |
| Owner release | Accepted after 908.40 ms despite DELETE rowCount 0; version 2 → 3, expired lease retained | Rejected after 906.89 ms; DELETE rowCount 0; version stays 2 and original lease retained |

[Before snapshots](evidence/milestone-5/m5d3/before-reproductions.json), [after snapshots](evidence/milestone-5/m5d3/after-reproductions.json), and full before/after regression logs retain owner, fence, expiry, wait duration, database time and persisted state. The same regression assertions failed before and passed after. Initial test setup/typing failures are retained separately and are not counted as successful vulnerability reproductions.

## Exact implementation

Only `execution-service/src/persistence/postgres-job-repository.ts` changes in application source. Public interfaces, schemas and migrations are unchanged.

- `hasValidLease` acquires the matching lease FOR UPDATE after locking the job. A separate statement then validates owner/fence/expiry with clock_timestamp(), retaining job-version and fencing-counter checks. Validity cannot be a projection calculated before waiting for the lease row.
- `transition` passes its validated lease into `updateJobState`. The conditional UPDATE checks source state, expected version, job fencing counter, and an existing matching owner/fence with a fresh unexpired lease. Exactly one row must change. State-machine validation remains in place. Existing unleased discovery/recovery paths keep their prior behavior; states requiring worker authority still reject a missing lease.
- `releaseLease` uses the existing guarded `deleteCurrentLease` helper. It requires exactly one deleted matching, unexpired owner/fence row before bumping the version in the same transaction. Duplicate/stale release throws; it does not report a successful no-op or increment again.
- Directly related current-owner deadline checks in renewal, post-attempt/failure validation and lease deletion use clock_timestamp(). Renewal also calculates its new deadline from current database time. This prevents the same frozen-statement-time pattern in shared lease helpers.

Lock order remains job row → lease row → conditional mutation. Both stay locked through commit. Failure throws StaleExecutionJobError and transaction() rolls back provisional job, lease and attempt changes. The release's successful deletion is the authorization-consuming step; its following version update is atomic and cannot race a conforming claimant, even if commit acknowledgement arrives later.

clock_timestamp() is used for lease authority because now()/transaction_timestamp() freeze at transaction start and statement_timestamp() freezes at statement start. Statement timestamps remain suitable for ordinary audit metadata. The guarantee is the validated mutation boundary, not a deadline for COMMIT acknowledgement. Privileged direct SQL, arbitrary future blocking triggers and wall-clock corrections remain operational assumptions.

## Cleanup and payment safety

Owner release continues to require an unexpired matching lease. Legitimate expired cleanup remains available through recoverExpiredLeases: Leased → Queued, ambiguous executing states → ManualReview, existing terminal cleanup behavior retained, with exact deletion/version checks and rollback. claimNext can reclaim expired ownership with a larger fence. Stale owners gain no cleanup authority. Owner release still preserves its original job-state semantics; no payout funds are released.

Rust, NEP-141 scheduling, independent approvals, immutable bindings, private callbacks, campaign accounting, native reconciliation, read-only host/configuration and frontend remain unchanged. No schema migration, signer, execution route, retry/reset or on-chain recovery was added. Remaining M5D2-03 RPC-body streaming hardening, live token semantics, recipient verification and deployment prerequisites remain outside this local fix.

This is implementation validation, not independent security approval. See [concurrency results](milestone-5d3-concurrency-regression-results.md), [related-path audit](milestone-5d3-lease-path-security-audit.md), [complete validation](milestone-5d3-validation-results.md) and [structured evidence](evidence/milestone-5/m5d3-remediation-results.json).
