# M5-F.1A completion regression results

Fresh completion evidence is under `docs/evidence/milestone-5/m5f1a/completion/`. Historical logs remain unchanged outside this new directory.

| Suite | Historical | Fresh |
|---|---:|---|
| Rust | 146 | 146 passed; fmt, Clippy with warnings denied and locked WASM build passed |
| Service | 186 | 206 passed; format, typecheck and lint passed |
| PostgreSQL | 46 | 46 passed on verified fresh dedicated loopback test database |
| Local RPC | 8 | 8 passed against newly captured finalized synthetic receipts |
| Sandbox groups | 20 | 20 passed: 10 main, 7 fault, 2 migrations, 1 callback/observer overlap |

Service count increased by 20 actual startup-boundary tests. No previous tests were removed. The tests inject the host initializer at the real entrypoint, prove rejection before initialization, and exercise restart validation. Generic-mode compatibility is covered by the retained host tests.

Rust 1.100.0; cargo-near 0.23.0. Commands: `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked`, `cargo near build non-reproducible-wasm --locked`. Candidate 410611 bytes, SHA-256 `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`.

Service commands: `pnpm check`, `pnpm db:migrate:test` (twice, second applied none), `pnpm test:postgres`. Initial local-listener failures under filesystem/network sandbox were resolved by the authorized elevated local-test rerun. No test assertion was weakened.

The eight receipt-backed RPC tests cover finalized receipt observation/discovery, unavailable receipt containment, database observations and real receipt graph classifications on one synthetic validator. They are not eight independent public-RPC provider tests. Additional passing service tests in `rpc-resources.test.ts` cover bounded retries/deadlines, response limits, cancellation, malformed JSON, decompressed streams, queue saturation and receipt graph limits; operational-audit regression tests cover credential redaction and nested token JSON limits. Coverage should not be inferred beyond the named assertions.

The sandbox uses hash-pinned nearcore 2.14.0, public synthetic fixture keys, loopback RPC and no public peer or transaction submission. It runs in `/tmp/m5f1acompletion-sandbox` to retain earlier milestone evidence. Historical artifact fetching is read-only and hash-authenticated; fixture builds use temporary Rust source copies. The full harness exited zero and wrote a fresh PASS reproduction-result.json; its final reruns passed 206 service, 46 PostgreSQL and 8 local RPC tests. Callback/observer overlap proved a single callback settlement with observer-only evidence persistence. Synthetic token receipt behavior does not establish actual Tidepool Testnet transfer compatibility or independent-provider trust.

No production Rust, lease, migration, authorization, reconciliation architecture or frontend source was changed. Source provenance records the temporary workspace production/test comparison and original environment hashes. No live worker or public blockchain transaction was run.

Final evidence: `completion/sandbox/reproduction-result.json`, `completion/sandbox/live-read-only-tests.log`, `completion/sandbox/callback-observer-race.log`, and receipt summaries under `completion/sandbox/fresh-receipt-suite/sandbox/`. Both migrations executed real synthetic upgrades; this does not authorize any public upgrade. The synthetic node terminated in the harness finally block. The owned test database was stopped after tests; see database-cleanup.log.
