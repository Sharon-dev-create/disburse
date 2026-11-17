# M5-D.4 native reconciliation lease verification

Reviewed source: `020cb7f79b5f86889f764f5dec2c8291e99094a3`, 2026-11-17. Independent adversarial review pass by the same assistant; not a third-party certification. No application source or schema file changed.

## M5D-R01: independently confirmed corrected

The fresh independent fixture creates a unique native attempt/job, acquires a 500 ms lease, obtains its job row FOR UPDATE in another transaction, dispatches complete, proves actual blocking with pg_blocking_pids, then holds the lock for another 900 ms. The worker rejects after **909.47 ms** with Stale reconciliation fence/lease. The recorded history retains Processing and the original worker/fence/expired deadline, with zero decisions and observations.

A valid 5000 ms lease with a 50 ms lock hold succeeds after **55.26 ms** and writes exactly one permitted ManualReview fixture decision. This is a repository authorization fixture, not payment evidence.

An additional audit holds a SHARE relation lock before the final job UPDATE, after the decision INSERT has already occurred. After **902.48 ms** on a 500 ms lease, the UPDATE affects zero rows; complete throws and the decision rolls back. Fresh existing integration tests additionally verify expiry during an evidence-claim uniqueness wait, including provisional observation rollback.

[Independent fixture](evidence/milestone-5/m5d4-independent-review/adversarial.mjs), [exact timings/state](evidence/milestone-5/m5d4-independent-review/adversarial-results.json), [fresh PostgreSQL suite](evidence/milestone-5/m5d4-independent-review/postgres-tests.log).

## Native transaction flows

| Path | Locked/read/written rows | Authorization and atomicity |
|---|---|---|
| enqueue | insert immutable job identity/locator; lock that job to compare | one transaction; conflicting locator/identity rolls back; no completion authority |
| claim/reclaim | candidate job FOR UPDATE SKIP LOCKED; update same job | Queued or expired Processing; increments fence; sets worker/current-clock deadline atomically |
| complete | job FOR UPDATE; read fresh lease; observations; receipt/transaction unique claims; decision; job | Processing + exact worker/fence + immutable identity/locator; decision INSERT and final UPDATE both require fresh unexpired ownership and rowCount 1; rollback covers all provisional mutations |
| terminal recheck | conditional job UPDATE | only Done/ManualReview; increases fence, clears owner/deadline, retains identity and sticky conflict; not an executing-worker lease bypass |
| history | job, observations and decisions; rehash observed payloads | read-only; does not authorize settlement or another transfer |

Source references: `execution-service/src/reconciliation/postgres.ts:148` begins complete; :150 locks; :155 evaluates clock_timestamp in a distinct statement; :159 checks owner/fence/state; :167 compares immutable identity/locator; :227 conditionally inserts decision; :241 conditionally completes job; :258 rolls back on error. No native renewal or separate owner-release API exists. Native renewal test coverage is a synthetic authorized database extension, not evidence of a runtime renewal method.

## Lock waits, time and consistency boundary

A lock check at the start is insufficient: observation uniqueness, receipt/transaction claims and decision insertion can wait later. The fresh final UPDATE is essential. It executes while the job row remains locked, with current owner/fence/state/deadline predicates. Both affected-row checks must equal one; partial historical evidence or claims cannot survive a rejected transaction.

clock_timestamp evaluates current server wall time. now()/transaction_timestamp freeze at transaction start, and statement_timestamp freezes at statement start. The current native validity guards do not use those frozen clocks. Existing triggers compare immutable data and do not perform an external blocking operation after the final predicate.

The guarantee is current lease authority at the protected mutation, not COMMIT acknowledgement before expiry. Commit/WAL scheduling may finish later; conforming reclamation cannot take over the held job row. Privileged direct SQL, future triggers and database clock corrections require operational controls. Immutable triggers do not defend against a database owner who can disable them.

Concurrent claims/decisions, stale/reclaimed fences, duplicate completion, malformed evidence rollback, sticky conflict history and actual SIGKILL/fresh-process recovery passed the fresh existing suite. The local live-RPC suite further races two completions on the same claim and requires exactly one writer, while preserving on-chain accounting.

Reconciliation is still a one-shot read-only evidence subsystem. Two configured source IDs/URLs are an operational trust assumption; local aliases of one validator do not prove operator independence. No native lease operation can sign/broadcast a token transfer, consume contract approval, release campaign reserve, retry an unknown transfer or perform on-chain settlement. Authenticated recovery remains blocked.
