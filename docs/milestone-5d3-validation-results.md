# M5-D.3 validation results

**PASS for local remediation and validation; independent security re-review required.** Baseline: `fe2a015bcd9378432ac9df3fe555acc1ebae6b52`, initially clean. Reviewed/validated 2026-11-17. No live execution or deployment approval is implied.

| Command / check | Actual completed result | Raw evidence under evidence/milestone-5/m5d3 |
|---|---|---|
| cargo fmt --all -- --check | exit 0 | rust-fmt.log; rust-commands.json |
| cargo clippy --locked --all-targets -- -D warnings | exit 0 | clippy.log; rust-commands.json |
| cargo test --locked | 146 passed, 0 failed/ignored; 0 doc-tests | rust-tests.log |
| cargo near build non-reproducible-wasm --locked | exit 0; expected unchanged artifact | wasm-build.log |
| execution-service pnpm check | formatting/typecheck/lint and 134 tests passed; 0 failed/skipped | service-check.log |
| pnpm db:migrate:test | existing migrations applied/checked locally | preflight-migrations.log; sandbox/test-migrations.log |
| pnpm test:postgres | 46 passed, 0 failed/skipped, including 14 new tests | postgres-tests.log; sandbox/postgres-tests.log |
| complete tests/sandbox/run_reconciliation.py | exit 0; all phases completed | sandbox-run.log; sandbox/reproduction-result.json |
| read-only local RPC integration tests | 8 passed, 0 failed/skipped | sandbox/live-read-only-tests.log |
| callback/reconciliation overlap | real synthetic transfer settled once; observer only persisted observations | sandbox/callback-observer-race.json |
| git diff --check | exit 0 | final-integrity.json |

The full wrapper used an isolated copy containing the exact final persistence source and test hashes. It began with empty evidence output folders, so fresh results do not inherit old reports. Raw prior milestone evidence was not overwritten. Existing native regressions and real PostgreSQL worker SIGKILL/restart coverage remained green.

## Receipt groups and migration coverage

The main summary has 10 named payout cases and the fault summary 7. Add the authenticated historical-WASM migration, M5-B-to-current migration and callback/observer overlap to obtain **20 completed receipt groups**. All ran on private nearcore 2.14.0, synthetic chain disburse-m5c-local, loopback endpoints and public deterministic fixture keys. No public-chain transaction occurred.

Coverage includes successful and failed transfers, missing recipient storage, duplicate/concurrent execution, same-campaign accounting, gas/headroom limits, private/stale callbacks, pause after dispatch, scheduling panic, callback panic/OOG, incompatible in-flight callback upgrade, unexpected token return and insufficient custody balance. Unknown/missing RPC receipt evidence yields ManualReview; successful transfer with failed callback is distinguished from failed delivery. The discarded-response/fresh-client case remains a restart model, not a real process restart; the PostgreSQL SIGKILL test is actual process coverage.

Historical bytecode SHA-256 `a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530` and M5-B `ad51f8bc061138013ff33620d33adff8dffacb4eaf1c06b09853c79b92c58e94` were reused from authenticated cached fixtures. Candidate C SHA-256 remains `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9` (410611 bytes), NEAR code hash `4mBF2J6mE22XrTrSNo8x7xSLhzUSfNS9HkzHJeaxqwk4`. The fresh locked build matched that identity. Local migration tests preserve old state/accounting and the consumed B orphan-preflight lock. They do not attest an authentic populated live history snapshot or resolve the orphan.

All Rust source, SQL migrations, native reconciliation source, application configuration and earlier raw evidence remain byte-identical to baseline. No recovery API, signer, execution worker, interactive route or frontend change was added. The only application source change is the legacy repository; its existing integration test file contains the 14 new regressions.

## Development failures retained

The first test invocation used the wrong append path and did not run the new tests; it is not reproduction evidence. The first actual two-test attempt reproduced the transition defect but hit a duplicate fixture key on release; the unique-key repeat independently reproduced both unsafe successes before source changes. New test code initially assumed a broader static return type for claimNext; the fixture was corrected without changing the public interface. Initial restricted service HTTP tests could not bind local sockets; the permitted local rerun passed all 134 tests. The supplemental pristine-baseline row-lock replay initially lacked copied migration files; its corrected repeat failed specifically on unsafe success as expected. Logs are retained; none of these incomplete/setup failures is represented as a successful regression run.

## Remaining gate

Both M5D2-01/02 are locally corrected and regression-tested, pending independent re-review. M5D2-03 streaming-body resource hardening, actual Tidepool token compatibility, controlled live recipient verification, authenticated recovery and deployment/operational approvals remain unresolved outside scope. Interactive mutations and live execution stay disabled. No commits, pushes, live database writes, public transactions or deployments were issued.
