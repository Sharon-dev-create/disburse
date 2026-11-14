# Milestone 1 — Local environment verification

Verification date: 2026-11-14 (Africa/Douala).

## 1. Milestone verdict

**PARTIAL PASS.** PostgreSQL, the existing Testnet contract, the read-only API,
and frontend/API integration were verified. All automated suites pass and the
webpack production build passes. The default Turbopack build fails due to a
worker-port permission error. No browser automation was available.

## 2. Component status

| Component | Status | Evidence |
| --- | --- | --- |
| Git worktree | Preserved | Started clean on `main`, HEAD `b2a46809d9596641f0ebe8bb948fdc52ae51fc12`; no commits or pushes |
| PostgreSQL service | PASS outside sandbox | PostgreSQL 17.10, cluster `17/main` online; `pg_isready` accepts connections |
| Development database | PASS | Authenticated as `disburse_dev` to `disburse_dev` |
| Database migrations | PASS | Repository checksum assertion passes for `0001`–`0003` in development and test |
| NEAR Testnet RPC | PASS with runtime workaround | Repository transport identifies `testnet`; default Node transport was intermittently unavailable |
| Contract read-only queries | PASS | `disburse-topg.testnet`: `is_paused = true`, `get_campaign_count = 0` |
| Execution-service startup | PASS with runtime workaround | Database/migration checks and paused-contract readiness passed; bound port 4000 |
| API authentication | PASS | Missing/invalid bearer: 401; valid bearer: scoped 404 for absent records |
| Frontend startup | PASS, existing server reused | Existing Next.js server on port 3000 reloaded private `.env.local`; duplicate startup exited without replacing it |
| Frontend/API integration | PASS over HTTP | Payout query renders not-found with server token, unauthorized with invalid incoming auth; both HTTP 200 page responses |
| Browser walkthrough | NOT VERIFIED | No browser automation tool available; no clicks, hydration, or visual assertions performed |

Required public tables were present in both databases:
`disburse_schema_migrations`, `execution_authorizations`, `payout_refund_policies`,
`execution_jobs`, `execution_attempts`, and `job_leases`.
No migrations were pending. Existing SQL and migration tooling were inspected;
no migration files or history were changed. The normal host startup ran its
existing migration check, which reported current migrations.

## 3. Tests and checks

| Command or inspection | Result |
| --- | --- |
| `git branch --show-current`, `git rev-parse HEAD`, `git status --short` | PASS; initial worktree clean |
| Repository `rg`, `cat`, `sed`, `ls` inspections | Completed; initial probes for `persistence/config.ts`, `lib/constants.ts`, and `tests/near-rpc.test.ts` found no such files; actual sources inspected instead |
| Version probes | Node 24.22.3; pnpm 12.18.0; Rust/Cargo 1.100.0; PostgreSQL 17.10; cargo-near 0.23.0 |
| `pg_lsclusters`, `pg_isready` inside sandbox | Initially down/no response; sandbox view differed from host |
| `pg_ctlcluster 17 main start` | FAIL; requires cluster owner or root |
| `sudo -n pg_ctlcluster 17 main start` | FAIL; interactive authentication required; no password requested or handled |
| `pg_lsclusters`, `pg_isready` outside sandbox | PASS; existing cluster online, accepting connections |
| Explicit Node read-only DB identity, schema and `assertPostgresMigrationsCurrent` checks | PASS for development and dedicated test database |
| Repository `HttpNearRpcTransport` network and contract reads | Initial unavailable errors; PASS with IPv4-first runtime settings |
| `curl https://rpc.testnet.near.org/status` | PASS; Testnet status |
| Node fetch/DNS diagnostic attempts | DNS resolves IPv4/IPv6; several connection attempts timed out; longer address-family attempt window allowed API startup |
| `cargo fmt --all -- --check` | PASS |
| `cargo test --locked` | PASS; 98 tests, 0 failures; doc tests 0 |
| `cargo near build non-reproducible-wasm --locked` | PASS; local WASM and ABI only, no deployment |
| `pnpm check` in execution service, sandbox | FAIL; API/server test-file failures under sandbox restrictions |
| `pnpm check` in execution service, outside sandbox | PASS; formatting, typecheck, lint, 102 tests |
| `node --env-file=.env --run test:postgres` | FAIL; child test processes did not inherit env-file variables |
| Node loads `.env`, then spawns `pnpm test:postgres` with inherited environment | PASS; 20 tests, dedicated `disburse_test` database/role verified first |
| Frontend `pnpm lint`, `pnpm typecheck`, `pnpm test` | PASS; 2 test files, 12 tests |
| Frontend `pnpm build`, sandbox and outside sandbox | FAIL; Turbopack CSS worker port binding: operation not permitted |
| Frontend `pnpm exec next build` outside sandbox | Same Turbopack failure |
| Frontend `pnpm exec next build --webpack` outside sandbox | PASS; all 26 static pages generated; build exited 0 |
| API startup without runtime workaround | FAIL; sandbox startup failed, host attempts reached DB but failed NEAR status |
| API startup with IPv4-first and 2000 ms family attempt window | PASS; process remains running |
| `pnpm dev` | Duplicate attempt exited because existing same-project dev server already owned port 3000; existing server retained |
| HTTP GET `/healthz` | PASS; 200, `{"status":"ok"}` |
| Missing/invalid API bearer checks | PASS; 401 |
| Valid API campaign accounting/list, payout, scoped payout and execution reads | PASS; typed 404 responses for absent campaign, payout, or job |
| HTTP GET `/`, `/dashboard`, `/dashboard/campaigns`, `/dashboard/recipients`, `/dashboard/payouts` | PASS; 200, no demo token in checked responses |
| HTTP GET `/dashboard/payouts?campaignId=0` with server token / invalid incoming bearer | PASS; not-found / unauthorized rendered correctly; token absent |
| CTA source inspection | PASS; primary CTA points to `/dashboard`; click behavior unverified |
| API/auth, RPC timeout/error and frontend auth/error tests | Included in passing suites; live outage and loading animations not browser-tested |
| Static asset token scan | PASS; token absent from 37 JS/JSON/HTML assets under `.next/static` |
| `git check-ignore frontend/.env.local`, permission check | PASS; ignored, mode 600 |
| Final `git status --short`, `git diff --stat`, `git diff --check` | Reviewed; no whitespace errors |

The absent campaign correctly produces 404 rather than a fabricated successful
accounting response or payout list. There is no existing campaign on which to
verify a populated accounting response. Existing demo routes remain demo routes;
no mock records were introduced. Tests exercised failure and empty-list handling.
The PostgreSQL tests wrote their normal isolated fixtures to the test database;
no development records were added, and no databases were recreated or reset.

## 4. Changes made

- `frontend/.env.local`: newly created, ignored, private local configuration;
  points to the existing API at loopback port 4000 and uses the existing service
  demo token server-side. Its contents are intentionally omitted.
- `execution-service/README.md`: documents explicit environment loading and the
  verified Node network settings needed for local startup.
- `docs/milestone-1-environment-verification.md`: this verification record.

No pre-existing tracked or untracked changes were present at the initial audit.
Rust, application code, dependencies, migrations, contract selection, and existing
service environment files were not changed. No commit, push, production setting
change, wallet use, signing, deployment, or on-chain mutation occurred.

## 5. Remaining blockers

- Default Turbopack production build cannot bind its CSS worker port in this
  execution environment, including escalated attempts. The supported webpack
  build succeeds; the package build script was preserved.
- Browser navigation, hydration, visual loading behavior, and client-side network
  inspection remain unverified. HTTP checks do not establish those properties.
- Default Node Testnet connections were intermittent. The verified runtime
  workaround is documented; an unqualified `pnpm start` is not proven reliable.
- PostgreSQL is version 17.10 rather than the documentation's version 18.
  Both database checksum checks and all 20 integration tests pass on the installed
  version; no database upgrade was attempted.

## 6. Running services

Final host checks found:

| Service | URL / selection | Final state |
| --- | --- | --- |
| PostgreSQL | Loopback port 5432, cluster 17/main | Online; accepts connections |
| Execution API | http://127.0.0.1:4000 | Running; health 200 |
| Frontend | http://localhost:3000 | Existing server running; payouts route 200 |
| NEAR | `testnet`, `https://rpc.testnet.near.org`, `disburse-topg.testnet` | Read-only queries verified; remains paused |

Verified API startup from `execution-service/`:

```sh
node --dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=2000 --env-file=.env --experimental-strip-types src/host.ts
```

Processes were alive at the final check; continued survival after this session
is not guaranteed. No system service installation was performed.

## 7. Milestone 2 readiness

**Conditionally ready for planning; Milestone 1 remains PARTIAL PASS.** Resolve or
accept the default-build restriction and complete a browser walkthrough before
calling the environment fully verified. Retain the documented API runtime settings
and explicit environment loading. Any isolated Testnet setup requires the user's
Milestone 2 approval. No Milestone 2 actions were taken.
