# M5-D.3 related lease-path audit

Local source review and regression validation; independent re-review remains required. No schema or public repository API changed.

| Path | Classification | Evidence and boundary |
|---|---|---|
| Legacy acquisition / reclamation | SAFE for inspected ownership invariant | claimNext locks job with SKIP LOCKED, compares state/version and increases fencing counter; reclaimed A/B test and existing claim races pass. Unused existing lease deletion may legitimately affect zero rows. |
| Legacy lease ownership validation | FIXED | hasValidLease locks matching lease, then checks current database time in a new statement plus exact owner/fence/job version/counter. Actual lease-row wait test rejects expiry. |
| Nonterminal transitions | FIXED | final UPDATE includes expected source/version, job fence and matching unexpired owner/fence; final-write contention rejects without mutation. |
| Terminal transitions | FIXED shared deadline checks; existing atomic semantics preserved | conditional job UPDATE followed by guarded exact-one DELETE; expiry at later deletion rolls provisional state/version back. |
| Owner release | FIXED | exact-one DELETE required before atomic job-version bump. Zero-row, duplicate, wrong owner/fence/version and deletion-then-failure tests pass. |
| Renewal | FIXED shared clock semantics | current-time deadline validation and extension; expired later update rolls provisional version back. Existing real renewal API remains functional. |
| Attempts / recorded failures | FIXED shared fresh-clock postcheck; existing rollback retained | post-write advanceLeaseVersion uses current clock while owner/job locks persist. Contention tests roll back attempt insertion and failure metadata/version. |
| Version helper | SAFE within reviewed callers | optimistic rowCount=1 check; leased transitions pass final SQL guard, release calls only after verified deletion, recovery is separate authority. Not a public mutation API. |
| Expired recovery | SAFE for inspected cleanup semantics | existing job lock, state/version conditions, matching expired lease/fence DELETE rowCount=1 and transaction rollback. Legitimate cleanup preserved; stale owner remains rejected. |
| Audit / evidence persistence | SAFE within reviewed scope | job/attempt writes are transactional; no new audit-event table or success-event writer introduced. Injected rollback and expiry tests leave no partial records. |
| Administrative lease cleanup API | NOT APPLICABLE | no new admin bypass introduced; recoverExpiredLeases remains the existing cleanup interface. |
| Native reconciliation persistence | SAFE for existing reviewed invariant, unchanged | five D.1 regressions and existing native fencing/restart tests pass. Separate read-only evidence subsystem; no shared native-source change. |

The lease correctness invariant applies at the final protected SQL write. The job row is retained through commit, preventing conforming takeover between validation and commit. Commit acknowledgement can arrive after expiry. Direct privileged database mutations, future triggers, wall-clock jumps and external side effects are not fenced by a database lease alone.

Acquisition retains existing timestamp/scheduling behavior. Under an unusually long acquisition statement a returned short lease can already be expired; fresh owner-write validation rejects it. This is a liveness/TTL limitation, not permission for an expired mutation. No unreviewed scheduler/renewal architecture was added.

Payment invariants are unchanged: PostgreSQL cannot make an on-chain transfer, consume native approval, release campaign reserve, retry an uncertain transfer or fabricate callback settlement. M5D2-03 (RPC response materialization before byte cap), actual Tidepool compatibility, live recipient verification, authenticated recovery and operational deployment gates remain unresolved outside this scope. Previous M5-D.2 FAIL findings remain historical evidence; this local remediation does not rewrite their verdict.
