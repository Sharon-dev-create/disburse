# M5-D.4 legacy lease verification

Reviewed source: `020cb7f79b5f86889f764f5dec2c8291e99094a3`, 2026-11-17. Existing D.3 source and tests were inspected and rerun; earlier implementation reports were background only.

## M5D2-01: nonterminal transition independently confirmed corrected

The independent fixture acquires a valid 500 ms worker lease, then blocks the real final UPDATE using a compatible SHARE relation lock. A PostgreSQL blocking barrier precedes the 900 ms hold. The conditional update returns zero rows after **904.63 ms**, and the method reports an explicit stale error. Before/after snapshots are identical: no Preparing transition, version increment, attempt or failure mutation survives.

Fresh existing tests also use an actual lease-row FOR UPDATE wait across expiry, verify a current owner under contention, wrong worker/fence/version, reclaimed generations and concurrent old/new transitions. The current owner alone may commit.

`hasValidLease` locks the matching lease before a separate fresh clock_timestamp query, while retaining expected job version and both lease/job fencing checks. `transition` validates allowed lifecycle and passes the lease into the final UPDATE: job source state/version/fence and matching lease owner/fence/current deadline are SQL predicates. Unleased discovery/recovery transitions preserve their prior state-specific semantics; protected states reject a missing lease.

## M5D2-02: zero-row release independently confirmed corrected

The independent fixture blocks the real lease DELETE across the same deadline. It returns rowCount 0 after **903.11 ms**. deleteCurrentLease throws before bumpVersion, and the entire job snapshot, including version and lease, remains unchanged. Existing fresh tests separately verify successful release increments exactly once, duplicate release rejects unchanged, wrong identities cannot release, and an injected failure after a successful deletion restores both lease and version.

releaseLease consumes one matching, unexpired worker/fence lease inside the same transaction as its optimistic job-version update. The job row remains locked throughout. A later commit/response after the original deadline is not a stale unauthorized release: the valid deletion already consumed its authorization and a conforming new claimant cannot take the job until commit.

[Independent fixture/state](evidence/milestone-5/m5d4-independent-review/adversarial-results.json), [fresh full PostgreSQL results](evidence/milestone-5/m5d4-independent-review/postgres-tests.log).

## Transaction-flow audit across related paths

| Operation | Flow | Classification |
|---|---|---|
| claimNext | eligible/expired candidate job FOR UPDATE SKIP LOCKED → recover eligible prior state → remove expired lease if present → conditional version/fence increment → unique lease INSERT → commit | SAFE for inspected ownership invariant; zero expired deletions can be legitimate for an unleased queued job |
| renewLease | job lock → matching lease lock → fresh current authority check → provisional job-version increment → exact owner/fence/current-deadline conditional renewal → required returned row → commit | SAFE; later renewal failure rolls provisional version back |
| transition | job lock → source/version check → matching lease lock/current validation → permitted transition check → guarded job UPDATE → guarded lease DELETE for Queued/Completed/Abandoned → commit | SAFE; original defect corrected; late deletion failure rolls state/version back |
| appendAttempt | job/lease locks and authority → uniqueness/sequence validation → attempt INSERT → job count/version UPDATE → fresh lease postcheck → commit | SAFE for reviewed paths; expiry rolls provisional attempt/job changes back |
| recordFailure | job/lease locks/current authority → provisional failure/version UPDATE → fresh lease postcheck → commit | SAFE for reviewed paths; late expiry rolls metadata/version back |
| releaseLease | job/lease locks/current authority → exact-one conditional lease DELETE → expected-version job bump → commit | SAFE; zero-row or duplicate deletion cannot increment version |
| recoverExpiredLeases | expired joined jobs FOR UPDATE SKIP LOCKED → state-specific Queued/ManualReview/cleanup mutation → exact-one same-fence expired lease DELETE → commit | SAFE for inspected cleanup; failure rolls transaction back; stale worker not granted authority |
| version helpers | internal optimistic UPDATE with required rowCount 1 | SAFE within reviewed callers; not an external authorization API |
| audit/evidence writes | job/attempt metadata shares enclosing transaction | SAFE within inspected scope; no new detached success event writer |

Mutating transaction() uses BEGIN/COMMIT with default READ COMMITTED and explicit row locks. Errors invoke ROLLBACK; read-only repository methods separately use REPEATABLE READ READ ONLY. The current schema's immutable identity trigger is simple comparison; no reviewed trigger performs blocking external work after a final guard. Database owners can bypass protections; arbitrary privileged writes are outside the worker API model.

Frozen statement timestamps remain for audit metadata, acquisition eligibility and authorized expired cleanup. Current-owner deadline checks use clock_timestamp after locks and at final guards. Cleanup checks a lease already expired and serializes through the job row; it is distinct authority from worker-initiated release. Reclamation raises the generation; same-worker identity alone never substitutes for its fence and version.

## Delayed-return limitation

An isolated fixture delays the return path 900 ms after a successful 500 ms lease INSERT. The returned lease is expired; its subsequent protected transition correctly rejects. This is a scheduling-delay model and availability consideration, not a physical acquisition lock race or a confirmed material lease-safety defect. The first attempted table-lock acquisition fixture was invalid because the worker already held ROW EXCLUSIVE from cleanup; that attempt timed out and is retained as a fixture-development note. It is not counted as a successful verification.

The review identifies no remaining material lease-safety defect in these paths. This does not certify that a future execution worker can safely perform external side effects merely because a database lease exists. No application source, schema, live configuration, transfer or recovery implementation was modified.
