# M5-D.1 security revalidation

The confirmed lease race is addressed at both post-lock validation and final SQL write predicates. Fresh owner/fence/state/expiry predicates and affected-row checks protect the full evidence/decision/completion transaction. No partial evidence is retained after rejected completion. Persistent conflict locks and immutable identity/locator checks remain in place.

The five new PostgreSQL tests and existing32-test suite verify rejection of stale workers, valid-owner acceptance, generation protection, concurrent completion, rollback and real process restart. A later claim-lock wait is explicitly tested so a single early expiry check cannot pass this regression suite.

No Rust or payment behavior changed. There is no on-chain recovery, token scheduling, reservation release, signing, automatic retry or settlement mutation in this subsystem. RPC trust, root/token governance, missing production locator integration and lack of authenticated on-chain recovery remain unchanged limitations. Physical distributed consensus faults are not claimed. Local fixture token behavior does not certify live Tidepool behavior.

This is remediation validation by the implementing assistant, not independent security approval. A separate M5-D security re-review must assess the final source and test evidence before advancing. No deployment or live execution is authorized.

Completed isolated sandbox rerun:20 real receipt scenario groups, both historical/B migration paths,8 live read-only reconciliation tests and callback/observer overlap all passed. The isolated repository implementation hash equals the final working-tree implementation. Its PostgreSQL snapshot ran30 tests (first3 new cases); the final working-tree suite ran32 tests including all5 new cases. Existing implementation/review evidence was not overwritten.
