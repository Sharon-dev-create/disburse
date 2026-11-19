# M5-F.1C readiness verdict

**PARTIAL — expiry remediation and available regressions pass; fresh receipt validation remains blocked.** Ready for independent review of the code and evidence, with an explicit unresolved validation gate. Not ready for Testnet setup, deployment or live execution.

| Gate | Result | Fresh evidence |
|---|---|---|
| A original defect | PASS | Three expected pre-fix failures; blocked consumer observed through PostgreSQL lock state |
| B post-lock database time | PASS | Materialized lock then single wall-clock sample; conditional atomic UPDATE |
| C new regressions | PASS | 15/15 expiry/lifecycle/concurrency/rollback/boundary tests |
| D PostgreSQL and fencing | PASS | 61/61 full tests, including previous 46; 20/20 targeted subset |
| E account receivers | PASS | Existing plan corrected; method-specific new plan and CLI help retained |
| F service/configuration | PASS | Format/typecheck/lint; 206/206 tests, including 20 startup tests; 45 additional negative probes |
| G Rust/WASM | PASS | Format, Clippy, 146 tests, locked build; candidate hash unchanged |
| H fresh receipt RPC/sandbox | BLOCKED | Binary recovery incomplete: eight RPC tests and twenty receipt groups not freshly run |
| I documentation | PASS | Five reports, structured results, logs, baseline and final hashes |

Starting and final reviewed HEAD: `b610cb44136f71923ef216ff082637c24c4d5389`. Initial 119 application hashes matched the prior independent review. Exactly two existing application files differ (authorization repository and its unit test), one new PostgreSQL integration test was added; the remaining 117 prior application files match. Final hashes are in `evidence/milestone-5/m5f1c/source-identity-final.json`. The source remains uncommitted. Earlier dirty review documentation was preserved.

Candidate SHA-256: `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9` (410611 bytes); NEAR code hash `4mBF2J6mE22XrTrSNo8x7xSLhzUSfNS9HkzHJeaxqwk4`. Rust and migration source hashes are unchanged.

## Security assessment

The demonstrated F1B-M01 race no longer reproduces: a lease-like authorization deadline is checked after the row lock, independently of caller/statement/transaction-start time. Single consumption, revocation, immutable bindings and rollback pass actual PostgreSQL tests. Related approval/revocation timing is also corrected. No known Medium-or-higher defect remains demonstrated within this focused remediation scope, but this is the implementer's assessment, not an independent audit closure.

Previously reviewed job lease/fencing, restart safety and read-only reconciliation tests pass; their implementation is unchanged. Native Approver/Executor separation, private callbacks, TransferPending/ManualReview reservation locks and accounting Rust code are untouched and its 146 tests pass. The missing fresh receipt groups limit assurance of asynchronous behavior in this exact environment. No automatic retry, uncertain-transfer override, reservation release, live signing, workers or mutation routes were enabled.

F1B-L01 documentation is corrected, but actual parent creation method, sponsor/signer/receiver, keys, account ownership proofs and operational identities still require verification. F1B's informational candidate-identity limitation remains: native execution is tied to `disburse-test-contract.testnet`. Candidate and historical deployed code remain distinct. No new Testnet state is claimed from historical RPC evidence.

Recommended next action: independent re-review of the post-lock SQL semantics and fifteen regressions, then restore the pinned binary and run the eight RPC/twenty receipt gates in the documented isolated environment. Preserve PARTIAL until that succeeds. All Testnet setup/deployment/execution requires a separate authorization and fresh preflight. No account, key, contract, role, token, campaign, payout or live database was changed; no Git commit or push was made.
