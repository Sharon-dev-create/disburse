# M5-D independent security review

**PARTIAL — one confirmed MEDIUM implementation finding; no critical/high finding identified in this audit.** Separate adversarial pass by the same assistant, not third-party certification. Implementation and earlier evidence hashes remain unchanged.

## M5D-R01 — Expired lease can complete after waiting for a row lock

`execution-service/src/reconciliation/postgres.ts`, `complete`, evaluates `lease_until > clock_timestamp() AS valid` in the same SELECT that acquires FOR UPDATE. The projected boolean can be evaluated before the row lock is obtained. Waiting for a lock can outlive the lease without invalidating that boolean.

A real PostgreSQL17 reproduction used a500ms lease, held the job row in another transaction, started completion before expiry, and released the row after900ms. Completion was accepted. [Executable scratch reproduction and result](evidence/milestone-5/m5d-independent-review/lease-result.json) are preserved with the test logs; the reproduction script is lease.mjs in the same directory.

Impact: reconciliation audit ownership does not enforce an unexpired lease at the point the row lock is obtained. This does not demonstrate a completed fence takeover, duplicate token transfer or double monetary settlement. The subsystem has no on-chain mutation capability. Severity is MEDIUM for the local evidence subsystem.

Remediation: lock the job first, then evaluate expiry using a fresh database clock after lock acquisition, retaining worker/fence/identity validation. Add a regression reproducing contention across expiry. Review authorization did not include implementation fixes; no fix or source/test change was made.

## Verification and boundaries

Fresh checks:146 Rust tests,134 service tests and27 PostgreSQL integration tests passed, with typecheck, Rust formatting/Clippy and WASM build logs retained. The extra adversarial case reproduces a defect despite those passing suites. Prior implementation hashes matched. Receipt binding, private callback preservation, absent signing/transfer capability and explicit trusted-RPC boundary were inspected. On-chain recovery remains deliberately blocked.

The turn interruption stopped the initial audit environment. The dedicated temporary database was restarted for the reproduction and integration suite. A fresh live-RPC rerun was not completed; earlier sandbox evidence was inspected but is not mislabeled as fresh review execution. No live transaction, deployment, configuration change, implementation fix, commit or push was performed.

A clean review approval is withheld pending separately approved local remediation and re-review. No deployment or full failure-recovery approval is granted.
