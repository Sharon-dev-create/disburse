# M5-E.1 fresh regression results

Reviewed 2026-11-17 at `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8`. Local/read-only audit only. [Structured evidence](evidence/milestone-5/m5e1-independent-review/results.json). Separate adversarial pass by the same assistant, not third-party certification.

| Check | Actual result |
|---|---|
| cargo fmt --all -- --check | exit 0 |
| cargo clippy --locked --all-targets -- -D warnings | exit 0 |
| cargo test --locked | 146 pass, 0 fail/ignored; 0 doctests |
| cargo near build non-reproducible-wasm --locked | exit 0, 410611 bytes; reviewed SHA/code hash match |
| execution-service pnpm check | format/typecheck/lint exit 0; 175 pass, 0 fail/skip/cancel |
| Fresh isolated suite service rerun | 175 pass, 0 fail/skip/cancel; same tests, not 175 additional distinct tests |
| pnpm db:migrate:test / pnpm test:postgres | dedicated local DB only; 46 pass, 0 fail/skip/cancel |
| node --experimental-strip-types --test tests/integration/native-live.test.ts | local sandbox RPC; 8 pass, 0 fail/skip/cancel |
| python3 tests/sandbox/run_reconciliation.py | exit 0, fresh PASS marker; 20 groups |
| Independent focused operational cases | 18 successful checks/reproductions; 0 harness failures |
| Fresh D.4 adversarial lease recheck | 6 pass |

Twenty groups = ten main receipt groups + seven fault groups + two historical migrations + one callback/observer overlap. Extra stale/duplicate assertions are not additional groups. Two RPC aliases reach the same synthetic validator and do not prove independent-provider consensus. Historical receipt fixtures support some unit tests; fresh capture/full receipt suite also ran.

The sandbox suite ran from `/tmp/m5e1-sandbox`, an isolated copy of current tests/service source with target/dependencies linked; evidence copied into this review directory. Original earlier evidence was not overwritten. Final source-hash comparison verifies the isolated/current source and tests match. Only loopback synthetic fixture keys and local test USDC were used.

PostgreSQL port 19549, database/role disburse_test, owned temporary cluster. Six additional adversarial checks rerun the preserved D.4 fixture against current source: actual blocking barriers, 500 ms lease held ~900 ms, valid short contention, final conditional-update rollback and unchanged legacy release/version. See [lease raw evidence](evidence/milestone-5/m5e1-independent-review/lease-recheck.json). The acquisition case models delayed return after successful INSERT, not a physical acquisition lock race.

## Focused operational cases

PASS in this table means the specified assertion/reproduction succeeded; cases 15–17 reproduce defects and are not proof that those controls passed.

| # | Independent case | Harness result |
|---|---|---|
| 1 | real contract and evidence transports reject decompressed/chunked oversized responses | PASS |
| 2 | real slow stream deadline aborts connection and releases permit | PASS |
| 3 | queue cancellation saturation and reuse with real HTTP | PASS |
| 4 | real 429 retry budget and unread error body cancellation | PASS |
| 5 | state changing RPC cannot enter either retry transport | PASS |
| 6 | receipt node depth duplicate missing references and incomplete evidence fail closed | PASS |
| 7 | graph call byte duration limits and observer cancellation | PASS |
| 8 | wrong recipient network fails before readiness | PASS |
| 9 | token identity and approved recipient mismatch fail closed | PASS |
| 10 | missing storage and RPC outage fail closed | PASS |
| 11 | positive technical results and stale advisory ownership cannot authorize cross payout execution | PASS |
| 12 | missing and malformed startup configuration fails closed | PASS |
| 13 | authenticated readiness degrades dependencies and mutation routes reject | PASS |
| 14 | monitor structured schema discards bearer key database and exception canaries | PASS |
| 15 | startup exception redaction adversarial reproduction | PASS |
| 16 | JSON nesting bypass in inspector inner token payload reproduction | PASS |
| 17 | actual bounded transport still accepts deeply nested encoded token JSON | PASS |
| 18 | forged execution authorization cannot produce positive reconciliation evidence | PASS |

Fresh discovery checkpoint/page/deadline cases are included in the 175-test run; lease/reconciliation compatibility is in 46 PG + 8 RPC + 6 adversarial + overlap. Missing/expired/revoked/duplicate native authorization is additionally covered by unchanged Rust and real sandbox tests. No source was patched to force test success.

Node public RPC probes (direct and environment-proxy) failed cleanly with unavailable before status. Python proxy-aware read-only RPC succeeded. These are retained failed probes, not skipped or passed tests. No required fresh regression run was interrupted. An actual database-server restart and real Tidepool transfer were not performed. Review final integrity/cleanup evidence records source preservation and stopped local fixtures.

Raw artifacts: [Rust](evidence/milestone-5/m5e1-independent-review/rust.log), [service check](evidence/milestone-5/m5e1-independent-review/service-check.log), [sandbox completion](evidence/milestone-5/m5e1-independent-review/sandbox/reproduction-result.json), [focused results](evidence/milestone-5/m5e1-independent-review/adversarial-results.json). Exact reproduction commands are in those logs/scripts and structured results.
