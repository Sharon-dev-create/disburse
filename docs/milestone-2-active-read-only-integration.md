# Milestone 2 — active Testnet read-only integration

Date: 2026-11-15, Africa/Douala.

## A. Verdict

**PASS for the restricted local read-only Testnet demonstration.** Implementation,
backend/frontend checks, dedicated PostgreSQL tests, real Testnet reads and a real
browser walkthrough completed. A production webpack build passes. The default
Turbopack build still fails with the previously observed CSS-worker port-binding
restriction, including outside the sandbox; that limitation is not concealed by
the working webpack build.

No on-chain transaction was signed or submitted. No Rust, chain configuration,
account keys/permissions, token balances or campaign/payout state changed.

Repository started at `7d4efc1829a0c20b30a6290f982727949180f7a5` with seven
untracked recovery/configuration documents and evidence files. During this task
HEAD advanced externally to `e4518a649df4f130b133f40c086986e4c78ba7f4` (the existing
audit/recovery documents were committed). This agent made no commit or push, did
not revert that change, and preserved all prior work.

## B. Implementation summary

| Files | Changes |
| --- | --- |
| `execution-service/src/near/active-testnet.ts` | Fixed Testnet contract/code/owner/token/Operator identities; fail-closed live readiness and contract status |
| `execution-service/src/near/rpc.ts` | Finalized `view_account` code-hash query with existing timeout/error conventions; source-backed owner/count/token views |
| `execution-service/src/host/config.ts` | Strict explicit `DISBURSE_ACTIVE_TESTNET_READ_ONLY=true`; reject wrong network/ID, malformed flag, production targets and non-loopback binding |
| `execution-service/src/host/server.ts` | Restricted migration assertion, repository read-capability projection and safe mode log; no worker/signer composition |
| `execution-service/src/api/http.ts` | Preserve default pause gate; restricted readiness; explicit read-route policy; authenticated `/v1/contract` |
| `execution-service/src/persistence/postgres-pool.ts` | Restricted connections default to read-only; URL cannot override the setting |
| `execution-service/tests/active-testnet.test.ts` | Five focused mode/readiness/API/capability/transport tests |
| `execution-service/tests/integration/postgres-read-only.test.ts` | Real dedicated DB test: multiple connections reject writes even with a conflicting URL option |
| `frontend/src/lib/execution-api.ts`, `execution-api-shared.ts` | Validated public contract status type/client; bounded 30-second status timeout, existing record timeout retained |
| `frontend/src/components/dashboard/LiveContractOverview.tsx` | Shared live identity/pause/count/error display and disabled mutation controls |
| `frontend/src/app/dashboard/page.tsx`, `campaigns/page.tsx`, `payouts/page.tsx` | Replace old hard-coded original/paused/zero assumptions with server-side live reads, Suspense loading, accurate empty/error states and numeric-ID queries |
| `frontend/src/app/dashboard/{campaigns,payouts,recipients}/new/layout.tsx` | Withhold existing illustrative creation forms and show read-only unavailability |
| `frontend/src/components/dashboard/{DashboardHeader,DashboardSidebar}.tsx` | Change the workspace wording to read-only; preserve navigation/design |
| `frontend/tests/live-contract.test.tsx` | Four client/render tests covering real response shape, zero/error states, invalid responses and withheld forms |
| Execution-service README and both `.env.example` files | Mode constraints, route policy, local process overrides, enable/disable instructions and server-only authentication |
| This report, main Milestone 2 report and `docs/evidence/milestone-2/active-read-only-*` | Current readiness and public verification evidence |

No actual `.env` or `.env.local` was overwritten. No dependency, lockfile,
production/Vercel setting, migration or Rust file was edited. Existing
illustrative detail/recipient pages remain explicitly marked as illustrative;
they are not used as the live campaign/payout directory or as settlement evidence.

## C. Security verification

Default absent/false mode still verifies the RPC network and requires
`is_paused=true` before listening. Existing tests for paused rejection/acceptance,
authentication, parsing, persistence scope and signing/authorization policy pass.
A malformed mode flag fails instead of silently weakening startup.

Restricted startup checks actual RPC Testnet identity, exact account, deployed
code hash, owner, typed pause response, accepted USDC and explicit Operator role.
The constants are source-pinned, not environment-provided proofs. Neither an
original-contract fallback nor a Mainnet fallback is implemented. RPC failures,
missing code-hash support and mismatches fail closed. Status reads recheck code,
owner, pause and count; startup network/token/role verification is not repeated
on every render. The mode logs only public identity/capability information.

All HTTP handlers were audited. They are liveness, contract views, or persisted
job/attempt **reads**. There are currently no database-write, blockchain-write,
queue, authorization-creation or administrative HTTP handlers. Restricted mode
nevertheless adds a positive route allowlist so future or unknown operations
cannot accidentally become reachable just because their HTTP verb is GET.
Authenticated disallowed routes/methods return 403 with `read_only_mode`;
unauthenticated protected requests remain 401. Read-route bodies/query strings
remain rejected.

| Available route | Authentication | Classification |
| --- | --- | --- |
| GET `/healthz` | Public | Pure liveness |
| GET `/v1/contract` | Bearer | Contract/network metadata reads |
| GET `/v1/payouts/:id` | Bearer | Contract view |
| GET `/v1/campaigns/:id/accounting` | Bearer | Contract/token views |
| GET `/v1/campaigns/:id/payouts` | Bearer | Contract existence + PostgreSQL SELECTs |
| GET `/v1/campaigns/:id/payouts/:id` | Bearer | Scoped contract view |
| GET `/v1/campaigns/:id/payouts/:id/execution` | Bearer | Persisted job/attempt SELECTs |

The runtime graph from `src/host.ts` through `host/server.ts` contains no signing,
provider execution, discovery ingestion, queue consumer, scheduler, retry worker,
refund processor or settlement composition. HTTP receives only reader and two
repository read methods, not the repository's mutation methods. No transaction
submission method exists in the transport used here. Provider/discovery libraries
elsewhere are not started or granted capabilities by this mode. This does not
claim that arbitrary external scripts with independent credentials are confined.

Restricted startup performs `assertPostgresMigrationsCurrent`, not migration
application. Sessions use `default_transaction_read_only=on`, including when the
connection URL requests off. The real dedicated test verifies reads/checksums and
SQLSTATE 25006 for an UPDATE on each of two connections. Database credentials
still belong to the existing local development/test role; this is application
capability separation plus a DB session safeguard, not a new permanent DB role.

The frontend server retains existing bearer forwarding. The browser never needs
the backend token or calls the backend port directly. A real browser check found
no token in rendered DOM or any of 218 recorded requests; a separate scan found
no token in 40 built client assets. No new NEXT_PUBLIC secret was introduced.

## D. Live Testnet verification

[Finalized chain snapshots](evidence/milestone-2/active-read-only-chain.json),
[final live API responses](evidence/milestone-2/active-read-only-api.json).

| Property | Verified result |
| --- | --- |
| Network / contract | NEAR Testnet / `disburse-test-contract.testnet` |
| Deployed code hash | `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf` |
| Owner | `disburse-topg.testnet` |
| Pause state | false |
| Accepted token | `usdc.tidepool-sandbox.testnet`, USDC, 6 decimals |
| Operator | `disburse-op-b966e36d.testnet`, Operator=true; Administrator/Verifier=false |
| Campaign count | 0, direct view |
| Payout count | 0, source-aware full STATE decoding and complete record inventory |
| Campaign 0 funding/accounting; payout 0 | null / null / null |
| Operator token balance | 100000000 atomic (100 test USDC) |
| Isolated token balance | 0 |
| Both token registrations | Present |

The complete isolated and original application-state snapshots match the final
C1/C2 baseline. Both code hashes, both NEAR amounts and the owner's access-key
nonce also match: no new on-chain signing, configuration, funding or fees occurred.
Snapshot finality is final; blocks span 277760536–277760581 with exact hashes in
the evidence. Account/role/token values above are direct views except the stated
payout counter decoding. The API has no payout-count ABI: it explicitly infers
zero only for the matching reviewed code with zero campaigns, otherwise returns
null. It does not claim a complete payout listing or invent an ABI method.

Live HTTP checks: public health=200; unauthorized contract read=401; authenticated
contract read=200; missing campaign accounting/list and payout=404; campaign POST,
execute POST, retry GET and refund POST=403 `read_only_mode`. There is no fake
campaign accounting response for an absent campaign.

## E. Frontend and browser verification

A real isolated headless Brave/Chromium 157 session was driven through the Chrome
DevTools Protocol, not inferred from curl. Verified homepage/CTA navigation,
`/dashboard`, `/dashboard/campaigns`, `/dashboard/payouts`, campaign/payout creation
routes, unauthorized reads using a deliberately invalid incoming bearer, and
unavailable API rendering using a temporary second frontend. Loading text was
observed on dynamic pages. Actual contract ID, network, active/unpaused state and
zero counts appeared. All five mutation controls were disabled; creation routes
showed unavailable rather than simulated forms. No browser runtime exceptions
were recorded. The screenshot was visually inspected.

[Browser results](evidence/milestone-2/active-read-only-browser.json),
[dashboard screenshot](evidence/milestone-2/active-read-only-dashboard.png),
[client asset scan](evidence/milestone-2/active-read-only-secret-scan.json).

The first live browser attempt correctly exposed an 8-second frontend status
request timeout as an unavailable state. This was fixed by reducing repeated
post-startup RPC work and giving status reads a bounded 30-second timeout. The
final production build and browser walkthrough passed after that fix. Existing
record queries retain their original timeout. No retries or failure-to-zero
fallback was introduced.

Local demo runtime, using explicit process-only overrides documented in the README:

- API: `http://127.0.0.1:4100`, restricted mode.
- Frontend: `http://127.0.0.1:3100`, production webpack build, server-side API base
  override to port 4100.
- Existing frontend on port 3000 was not replaced; its homepage still returned 200.
- Temporary failure frontend on port 3101 and isolated browser were stopped.
- No production service, environment file or persistent host installation changed.

Processes were verified during the task; their continued lifetime after the
session is not guaranteed. These are local demo services, not a production rollout.

## F. Tests and validation commands

| Command / validation | Final result |
| --- | --- |
| Execution service `pnpm check` outside sandbox | PASS: Prettier, typecheck, ESLint; **107 tests** |
| Node loads existing `.env`, then spawns `pnpm test:postgres` with inherited environment | PASS: **21 tests**, dedicated local `disburse_test` verified |
| Frontend `pnpm typecheck` | PASS |
| Frontend `pnpm lint` | PASS |
| Frontend `pnpm test` | PASS: **16 tests**, 3 files |
| Frontend `pnpm build`, sandbox and outside sandbox | FAIL: Turbopack CSS worker cannot bind a port, OS error 1 |
| Frontend `pnpm exec next build --webpack` outside sandbox | PASS, final production build, 26 static pages generated |
| Restricted API startup with explicit process-only overrides | PASS, migration checks and live readiness verified |
| Final authenticated live API checks | PASS, 10 request cases |
| Real browser walkthrough | PASS, 10 page/state observations; zero runtime exceptions |
| Token leak checks | PASS: DOM, browser requests and 40 client assets |
| Original/isolated complete state and balance comparison | PASS |
| `git diff --check` | PASS |

Exact PostgreSQL command from `execution-service/`:

```sh
node --env-file=.env --input-type=module -e 'import {spawn} from "node:child_process"; const p=spawn("pnpm",["test:postgres"],{stdio:"inherit",env:process.env}); p.on("exit",code=>process.exitCode=code??1);'
```

Backend tests initially hit sandbox socket restrictions; the successful suite
ran outside the sandbox. The PostgreSQL suite used its usual isolated test
fixtures/migrations only; it did not reset/truncate/migrate production. Restricted
live startup did not apply development migrations. Browser tooling and diagnostics
lived under /tmp; no browser/test dependencies were added to the repository.

## G. Remaining limitations and security tradeoffs

- Default Turbopack production build remains blocked in this environment; the
  documented webpack build is the verified production artifact. Next also warns
  about multiple lockfiles/workspace-root inference; no lockfiles were removed.
- Demo bearer forwarding supplies read access through the local frontend. This
  remains local/demo authentication, not production user identity or TLS policy.
- RPC is an external availability dependency. Bounded errors are shown as errors;
  snapshots are multiple finalized reads, not a single atomic multi-view snapshot.
- Network/token/Operator readiness is checked at startup, not continuously. The
  status route rereads code/owner/pause/count. Restart after deliberate config
  changes to re-run all startup checks. No watcher or write-capable worker added.
- No complete on-chain campaign/payout pagination exists in this API. Numeric-ID
  accounting/detail and persisted-job reads remain available; nonzero payout totals
  are unknown rather than fabricated.
- Legacy illustrative detail/recipient routes remain labeled examples and do not
  establish live records or settlement. Creation forms are withheld by route layouts.

## H. Milestone 2 readiness and stop

**Ready for the isolated read-only Testnet demonstration.** Code, owner,
initialization, token, permissions, storage, wallet funding, API reads and frontend
integration have now been verified, with actual setup/recovery transaction evidence
preserved in the preceding reports. Default paused behavior remains tested.
No campaign has been created/funded and no payout reserved during this task.

Milestone 3 still requires separate explicit authorization for exact campaign
creation/approval, wallet `ft_transfer_call` funding while Approved, activation and
any reservation/budget tests. The read-only HTTP host does not gain those mutation
capabilities; later chain actions must use a separately approved signing workflow.
No settlement or external-chain execution capability is claimed. **STOP.**
