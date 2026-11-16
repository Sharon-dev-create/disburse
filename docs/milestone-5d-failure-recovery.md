# M5-D — Failure recovery boundary

**Read-only diagnosis implemented. On-chain accounting recovery, retry and release are BLOCKED.**

For standard-token success followed by callback panic/OOG, independent read-only graph inspection identifies successful token delivery with settlement pending. The native payout remains TransferPending/Executing, reserved100000/spent0 in its reference campaign. No transaction is sent. Missing callback event, timeout, absent job, service restart or unsuccessful completion cannot clear the C attempt lock.

Normal callback success is observed as already settled; collection never subtracts reserve/increases spent again. Finalized failed token receipt is recorded as an observed failure, not authority to refund, release or retry. Missing receipt, unsupported token behavior/code, incomplete graph, wrong binding, unavailable archive, inconsistent source response or wrong network yields ManualReview. Later explicit read-only recheck may collect new evidence; contradictory positive evidence produces a persistent conflict lock with append-only decision history.

No on-chain ReconciledSucceeded/ReconciledFailed state or duplicate parallel money ledger was introduced. Existing C state and accounting remain authoritative. The DB can describe a discrepancy; it cannot correct it. An old B preflight orphan with no scheduled transfer graph remains unresolved. Absence of a located graph is not non-delivery proof.

## Separately required authenticated recovery design

Neither Operator, Executor, Approver nor legacy Verifier can use this subsystem to mutate a payout. No privileged `success` flag, caller-supplied receipt JSON or transaction hash becomes a settlement fact. A future contract recovery method needs an independently tested authentication mechanism: either verified finalized receipt proofs rooted in an authenticated chain, or an explicitly trusted independently authorized recovery quorum with bound messages, identity/attempt/evidence domains, expiry, revocation, conflict and replay protections, compromised-key analysis and governance safeguards. No principals/quorum were selected by this implementation.

A future mutation must reload current accounting, enforce the exact original attempt and immutable binding, settle only once, reject conflicts/stale/cross-payout evidence, and race safely with the original callback. It must create no second transfer. Any failure retry/release needs a separate proven-safe design and approval; this milestone implements neither. Root arbitrary upgrades can bypass application protections and remain outside the trust guarantee.

Current safest operation after callback loss: preserve reservation and attempt, retain finalized graph/provenance, investigate with independent sources, and wait for reviewed recovery capability. No wallet advance or onward payment workaround is proposed. A separate independent M5-D security review is required before any deployment decision; this document is not permission to proceed to live recovery.
