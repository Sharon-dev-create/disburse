# M5-D.2 lease-fencing verification

Reviewed 2026-11-17, HEAD `8b2c068bfb31eb47ec4ed61194a1a98c2ea5149a`, including the staged D.1 repository change and untracked D.1 regression tests. HEAD later advanced externally to `24193abb93bcf4ca293179c6e5952ab3b87bf275` without changing the reviewed source/WASM hashes. No Git mutation was issued by this reviewer. This is a separate adversarial review by the same assistant, not a third-party certification. [Baseline and source hashes](evidence/milestone-5/m5d2/baseline.json) identify the working tree; HEAD alone does not identify the fix.

## Original defect: independently confirmed fixed

[Fresh before/after evidence](evidence/milestone-5/m5d2/lease-reproduction-repeat.json), generated with [this reproduction](evidence/milestone-5/m5d2/lease-reproduction.mjs), compares the preserved pristine pre-fix class with the current class. Both use unique synthetic jobs, a 500 ms lease, an independent row-lock holder and a `pg_blocking_pids` barrier before a 900 ms database sleep. Baseline accepted after 924.34 ms, committed one decision and cleared its lease. Current rejected after 919.17 ms with `Stale reconciliation fence/lease`; state stayed Processing with the original fence/owner/expired lease and zero decisions, observations, receipt claims or transaction claims.

The first attempt is preserved in `lease-reproduction.json`: build load delayed the baseline until it was already expired, so both versions rejected. That attempt does not reproduce the original bug. The repeat above does. No production source was reverted to run the baseline.

## Transaction analysis

`execution-service/src/reconciliation/postgres.ts:148` begins the transaction; line 150 acquires the job row with FOR UPDATE without projecting validity. A distinct statement at line 155 evaluates `clock_timestamp()` after the lock. Lines 159–170 check Processing, worker, exact fence, unexpired lease, immutable identity and immutable transaction locator.

Observation inserts and immutable receipt/transaction claims follow in the same transaction. Their uniqueness/FK locks can wait after this initial check. The decision INSERT SELECT (line 227) repeats worker, fence, state and fresh clock predicates. The job UPDATE (line 241) repeats them again. Both must affect exactly one row. Any failure invokes ROLLBACK at line 258, undoing all provisional observations, claims, decisions and job changes. ManualReview and success/failure observations share this implementation.

No `now()` or `transaction_timestamp()` is used for native lease validity. Those functions would freeze time at transaction start. `statement_timestamp()` freezes at statement start and is also unsuitable for a predicate whose statement can wait before evaluation. `clock_timestamp()` obtains current server wall time when evaluated. Wall-clock corrections remain an operational assumption; this is not a monotonic-clock guarantee.

A second independent [test](evidence/milestone-5/m5d2/final-update-lock.mjs) blocks the final UPDATE on a SHARE relation lock after its decision INSERT has completed. A real blocking barrier precedes the 900 ms wait. [Result](evidence/milestone-5/m5d2/final-update-lock.json): UPDATE rowCount 0, explicit rejection, zero committed decisions/observations. The existing D.1 receipt-claim contention test additionally checks provisional observation rollback before the decision INSERT.

The job row remains locked through COMMIT, so another conforming claimant cannot take ownership in between. COMMIT/WAL flush, deferred constraint work or scheduling can finish after the deadline. The reviewed invariant is ownership and validity at the final SQL write, not an expiry deadline for COMMIT acknowledgement. Existing triggers do not perform blocking external operations after the final predicate. Arbitrary future triggers, privileged SQL, or direct database-owner changes require a new review; predicates are repository controls, not an independent database authorization policy.

## Adversarial coverage

| Scenario | Result | Fresh evidence |
|---|---|---|
| A: 500 ms lease, 900 ms row wait | PASS: rejected, no partial writes | lease-reproduction-repeat.json; PostgreSQL expired-after-lock test |
| B: valid owner and lease | PASS | valid-after-short-row-lock test |
| C: reclamation after expiry | PASS: old fence rejected | PostgreSQL expired-fences test; concurrent-completion.json |
| D: renewal | PASS for modeled native DB extension; no native renewal API exists | PostgreSQL database-fixture-renewal test |
| E: stale generation/wrong worker | PASS | PostgreSQL wrong-owner-and-fence test |
| F: conflicting concurrent writers | PASS: old A rejects; current B alone commits | concurrent-completion.json; one-claim test |
| G: rollback | PASS, including a wait after decision insertion | final-update-lock.json; evidence-claim test; malformed-observation test |
| H: restart | PASS: actual SIGKILL child and distinct fresh worker process | PostgreSQL real-SIGKILL test, not just a simulation |

The separate legacy repository has a real renewal API. Its independently contended renewal rejected after about 909 ms; this is different from the synthetic native renewal fixture. Existing integration tests cover its ordinary renewal behavior.

## All related paths

| Path | Classification | Reason / reference |
|---|---|---|
| Native decision, evidence attachment, Done, observed failure and ManualReview | SAFE within reviewed repository invariant | postgres.ts complete: lock, fresh predicates, affected-row checks, rollback |
| Native receipt/transaction claims | SAFE transactionally | inserted before guarded completion; rollback covers provisional claims |
| Native acquisition/reclamation | SAFE | postgres.ts claim: atomic SKIP LOCKED with increasing fence |
| Native enqueue | SAFE | immutable identity/locator; no leased completion |
| Native recheck | SAFE within current local caller boundary | terminal-only, increases fence, retains sticky conflicts; not exposed as API |
| Native renewal / explicit release / separate failure endpoint | NOT APPLICABLE | no such methods; completion centralizes transitions and clears lease |
| Native history | NOT APPLICABLE | reads and rehashes evidence; not a leased write |
| Legacy nonterminal transition | VULNERABLE | postgres-job-repository.ts:333; confirmed post-check expiry write, M5D2-01 |
| Legacy release | VULNERABLE | postgres-job-repository.ts:422; zero-row DELETE ignored then version bumped, M5D2-01 |
| Legacy appendAttempt / recordFailure | SAFE for inspected late-write expiry path | post-write advanceLeaseVersion rejects expired ownership and rolls transaction back; generation/job locks retained |
| Legacy renewal | SAFE in independently tested lock scenario | rejects after expiry; actual API, not native fixture; statement-time semantics still merit hardening consistently |
| Legacy recovery/acquisition | SAFE for ownership serialization inspected | job row lock, version/generation comparisons, expired-lease reclamation; existing integration/restart tests |

SAFE does not imply arbitrary privileged DB writes are safe or authorize production operation. A lease valid at a write can expire during the following read/commit. Native evidence never grants on-chain settlement authority.
