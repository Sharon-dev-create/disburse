# M5-C independent implementation re-review

**PASS for the local implementation; zero unresolved critical or high-severity implementation findings.**

Reviewed HEAD `d6f444ae5f6d1843206421f138908db7fca4db30` on 2026-11-16. The exact source hashes and matching WASM SHA256 `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9` are pinned in [structured review evidence](evidence/milestone-5/m5c-independent-rereview/results.json). This is a separate adversarial audit pass by the same assistant that implemented C, not a third-party or separately staffed audit. No implementation source changed during this review. Existing working changes were preserved.

## Audit conclusions

Reinspected native authorization, immutable Borsh binding, full current attempt validation, atomic storage/transfer scheduling, private callback wrappers and explicit self-predecessor checks, bounded SDK5.30.1 result APIs, checked fresh campaign accounting, all eight legacy mutation guards and private release helper, bootstrap and old layouts. No externally reachable raw send, retry, release, reset or manual-success override exists. Privileged root code replacement remains outside application-role guarantees.

Fresh fmt, Clippy with warnings denied, 146 Rust tests (0 failed/ignored), and locked WASM build passed. ABI has 52 entries and both callbacks have private modifiers. The final artifact matches the fresh receipt-tested candidate.

A fresh isolated loopback sandbox rerun passed all three phases and 20 scenario groups: success/actual balance movement, missing storage, token rejection/insufficient balance, concurrent duplicate/same-campaign/cross-campaign execution, foreign/stale callback rejection, minimum/insufficient gas and NEAR, scheduling rollback, callback after-write panic/OOG, real pause-before-callback, incompatible in-flight upgrade, delivered nonstandard result, fresh-client restart model, authenticated old deployed-WASM and M5-B sidecar upgrades. Actual receipt/balance/accounting evidence is saved under `m5c-independent-rereview/fresh-sandbox`, leaving earlier implementation/review evidence untouched. No public RPC or transaction was needed for this rerun.

## Remaining findings

- **MEDIUM R-C01:** callback loss and consumed old-B orphan attempts freeze reservations. This is intentional failure safety; M5-D may collect independent evidence but must not infer non-delivery or add unsafe reset/retry.
- **MEDIUM R-C02:** real recipient control, actual Tidepool token semantics/gas/governance and root safeguards are unresolved live gates. Local fixture behavior is not live token certification.
- **LOW R-C03:** no physical disk-failure or distributed-load injection; restart is a fresh-client model, not PostgreSQL/worker restart. Fault artifacts are explicitly separate from production.

These do not demonstrate critical/high implementation defects in the claimed local scope. Failed-receipt event text is not committed-state evidence. A token promise failure does not prove economic non-delivery for arbitrary promise-returning tokens. No automatic retry/release exists.

The prior [BLOCKED review](milestone-5c-independent-security-review.md) remains historical and unchanged; it reviewed absent C at an earlier revision. This re-review satisfies the user's conditional local M5-D gate, with read-only reconciliation unless an independently testable on-chain evidence-authentication boundary is established. It does not approve deployment, live execution or trusted-attestation recovery.
