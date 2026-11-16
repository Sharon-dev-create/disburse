# Milestone 5-A — Implementation and verification plan

Design only; 2026-11-15; revision `913ae89e627c287af176aa9b0e6f9e4091d68ab7`.
[Architecture](milestone-5-native-payout-architecture.md),
[migration requirements](milestone-5-migration-safety.md),
[prioritized threats](milestone-5-security-threat-model.md).
No implementation/deployment/execution is approved by this plan.

## Existing tests actually run in M5-A

- `cargo test --locked --offline`: **98 passed**, 0 failed; [log](evidence/milestone-5/rust-tests.log).
- From execution-service, `node --experimental-strip-types --test --test-isolation=none --test-reporter=spec tests/near-intents.test.ts tests/security.test.ts tests/discovery.test.ts tests/state-machine.test.ts tests/postgres-security-repositories.test.ts`: **51 passed**, 0 failed; [log](evidence/milestone-5/service-tests.log).

These are current reservation/lifecycle/evidence and selected service regressions.
PostgreSQL security repository tests in that command use test adapters; they do
**not** establish real PostgreSQL crash/concurrency safety. No actual DB integration,
worker, schema migration, live token test or new dependency was started. Rust unit
promise mocks do not exercise receipt atomicity or real gas. Existing tests do not
prove a native feature that has not been implemented. No frontend changes require
a build here. Future sandbox tooling/dependencies require separate approval if absent.

## Required additional matrix

| ID | Layer | Cases | Acceptance |
| --- | --- | --- | --- |
| R01 | Rust unit | Role matrix, no-role, self-approval, altered binding, expired/revoked approval | All unauthorized calls reject without state/promise changes. |
| R02 | Rust unit | Invalid state, mode mismatch, legacy settlement/failure/release/confirmation bypass | Every legacy mutation rejects native mode; no reserved/spent delta. |
| R03 | Rust unit + property | Budget exhaustion, u128 boundaries, many payouts and campaigns sharing token | All four campaign invariants always hold; no cross-campaign accounting. |
| R04 | Rust unit | Identical/conflicting idempotency; legacy/native key collision | Same native ID no new reserve/event/promise; any mode/detail conflict rejects. |
| R05 | Rust unit | Success/failed, duplicate/stale/wrong-auth/wrong-count callbacks | Exactly one settlement; failures preserve reserve; stale/spoofed results cannot mutate another attempt. |
| R06 | Rust unit + sandbox | Retry after finalized failure, retry blocked after success/unknown, release guard | Only fresh independent authorization/new attempt with unchanged binding; no overlapping dispatch. |
| R07 | Sandbox real promises | Successful standard ft_transfer and storage preflight | Correct predecessor, string amount, 1yocto, one token movement, callback reserved→spent. |
| R08 | Sandbox real promises | Missing recipient storage, insufficient balance, malformed storage response, token reject | No invented refund; failed token receipt leaves tokens; locked reservation until reviewed action. |
| R09 | Sandbox real promises | Callback panic, gas exhaustion, decoding failure after token success | Delivery persists but no second transfer; pending/ManualReview remains reserved; recovery settles only once. |
| R10 | Sandbox real promises | Pause/expiry/revocation/delist and concurrent callback interleavings | No new transfer after pause/expiry; dispatched completion safe; reload current campaign accounting. |
| R11 | Sandbox real promises | Token success/no-op or upgraded/nonstandard mock, storage unregister race | Expose token trust assumption; drift/uncertain evidence freezes; no claim ABI alone proves semantics. |
| R12 | Migration fixture + sandbox | Exact current old snapshot plus synthetic nonempty legacy evidence/indexes | Byte-preserve legacy entries, semantic equality, token custody unchanged; no reinit/prefix collision. |
| R13 | Migration negative | Changed top-level/Payout layout, old WASM, corrupt snapshot, wrong bootstrap caller/version | Reject incompatible strategy and unsafe rollback; native paths disabled until reviewed sentinel. |
| S01 | Real PostgreSQL integration, future isolated test DB | Concurrent claims, lease expiry/fencing, single-use authorization consumption | One authoritative DB claim; stale worker cannot commit; on-chain duplicate still rejected. |
| S02 | Real PostgreSQL + sandbox integration | Crash before send, after send before DB commit, after callback before evidence persistence | Restart monitors same attempt; never sends token twice; cursor/job commit atomic. |
| S03 | Service unit + integration | RPC timeout, stale/conflicting endpoints, missing receipt, forged log/hash, settlement evidence integrity | Unknown→ManualReview; exact finalized action graph required, balances corroborative only. |
| S04 | Service/API/frontend | Native mode routing, native no-refund policy, direct detail and persisted-list lag | No 1Click quote/deposit; truthful status and scope; no arbitrary signer capability. |
| S05 | Host security regression | Restricted read-only startup and denied mutation/worker/signer composition | Current environment stays read-only, no schema migration/DB writes/live signer. |
| S06 | Recipient proof verification | NEP413 nonce/domain/expiry/account/key-membership and registration/balance fixture | Reject replay/wrong account; no invented recipient or implicit allowlist grant. |
| L01 | Separately approved Testnet demonstration | Deployment, identity/state verification, recipient, reserve, approve, execute, receipts, accounting/dashboard | Every state-changing step has separate exact approval; one 100000-atomic payment only. |

Use exact numeric assertions on campaign0: current A1000000/R0/S0; reserve100000→
A900000/R100000/S0; pending/failure/unknown unchanged; success→A900000/R0/S100000.
Check token custody separately and account for successful debits pending callback.
Verify no promise was scheduled on rejected authorization or idempotency replay.
Use randomized transition sequences to assert invariants, monotonic attempts,
single-use approvals and terminal states. Unit assertions alone cannot demonstrate
callback panic/OOG after a committed token transfer: R07–R11 need real receipts.

## Reviewable implementation stages

| Stage | Objective / anticipated files or components | Required tests and acceptance | Risks / dependencies | Approval gate |
| --- | --- | --- | --- | --- |
| M5-B | Local immutable native mode, strict reservation wrapper, independent roles/approval, sidecar states/views; `src/lib.rs`, future `src/state/native_*`, `src/types/native_*`, local tests. Preserve old field layouts. | R01–R06, R12 schema fixtures, R13 negatives; legacy guard coverage, invariants and native-mode idempotency. No enabled transfer scheduler. Freeze canonical schemas. | T01–T04/T07–T12; requires explicit design approval; sidecar strategy checked before any struct change. | Approve local B implementation only; review diff/test evidence before C. |
| M5-C | Local token interface, storage view, promise scheduling, private callbacks and gas guards in contract modules. | R05–R11, full old Rust suite; real sandbox receipt graph, 1yocto ABI, measured gas margins and callback-loss no-resend. | Token semantics/gas not proven; depends B and approved sandbox tooling. | Separate local C approval; no live calls or deployment. |
| M5-D | Dual recovery attestation, immutable evidence, finalization/retry/release rules; contract native resolution and service verification models. | R06/R09 and S03; conflicting attestations fail closed; no retry/release from unknown; successful delivery bookkeeping only. | Trusted recovery collusion, incomplete history; depends B/C. | Review exact authority/evidence rules and failure tests before migration validation. |
| M5-E | Old snapshot fixtures and upgrade/bootstrap validation; future tests/fixtures, local migration harness, artifact manifests. | R12/R13 plus complete real promise suite on migrated state; byte equality and token preservation, nonempty legacy cases, rollback rejection. | Prefix/Borsh/old-WASM bypass; requires reviewed B–D candidate. | Accept preserved-state report and reproducible artifact before any deployment proposal. |
| M5-F | Future native provider/mode, discovery/view reader, durable attempts/authorization mirror, native no-refund policy, chain receipt verifier, API/dashboard projection; execution-service modules and frontend adapters. | S01–S06 in isolated test DB and sandbox; crash/fence/auth races; current readonly host unchanged. | DB/chain nonatomicity; no live signer currently exists. Depends B–E ABI freeze. | Separate local integration approval and security review; current running mode stays restricted. |
| M5-G | Propose isolated A upgrade only if E passes, else separately funded B deployment. Artifact/ABI/target/maintenance/bootstrap manifests and public evidence. | Fresh finalized state, signer availability, key/token governance, code/source provenance, custody/prefix checks, no pending attempts, read-only smoke tests. | Root key and token trust, irreversible external state; depends all critical/high controls and independent review. | Exact deployment approval; separate bootstrap/role/pause/unpause approvals. Stop after post-deploy verification. |
| M5-H | One controlled native payout demonstration, public receipt evidence and honest dashboard. | L01 and accounting assertions; one exact100000-atomic transfer, no other movement, independent two-RPC proof. | Recipient currently unverified; roles/TTL/gas/recovery policy unresolved. Depends G and all recipient gates. | Separate approvals for recipient storage/allowlist/roles if needed, reservation, authorization, initiation and any recovery. No blanket execution approval. |

The work order is B→C→D→E→F→G→H. Migration layout feasibility is an early B
constraint; E proves the finished candidate, not permission to postpone layout
review until then. F can begin read-only schema planning after ABI freeze but must
not be used to bypass E. No unsafe branch is deployed merely to unblock the demo.

## Live demonstration gates, all future

1. Review candidate source/build/ABI and snapshot. Approve exact isolated deploy or upgrade.
2. Read-only verify candidate code and all preserved state/custody. Stop on any delta.
3. Approve separately each needed bootstrap, explicit role grant and maintenance pause/unpause.
4. Verify controlled recipient NEP413/account/token/storage/initial balance. Approve any registration or allowlist mutation separately; do not select a recipient automatically.
5. Fresh finalized campaign/token/role/gas preflight; approve exact 100000-atomic native reservation. Verify ID, event, fixed destination and A900000/R100000/S0.
6. Independent approver reviews exact immutable attempt/expiry; separately approve that on-chain authorization.
7. Fresh state/approval/storage/token-code checks; separately approve exact initiate transaction. Do not alter an approved manifest to fix a mismatch.
8. Read-only verify all finalized token and callback receipts using independent RPCs, source/recipient movements and on-chain terminal record. Callback settlement is part of the explicitly reviewed initiation graph, not an extra backend attestation.
9. Verify A900000/R0/S100000 and no duplicate transfer; persist/display evidence only within separately authorized future service integration. Show receipt, delivery and settlement distinctions.
10. Any failure/unknown→stop. New state-changing recovery, retry approval or release needs its own exact approval and definitive evidence; no automatic retry.

## Unresolved policy and implementation gates

- RECIPIENT_UNVERIFIED; no account, control proof, storage or initial balance selected.
- Explicit independent approver/executor/recovery principals and governance; no roles granted.
- Concrete TTL, gas allocations/minimums, bounded storage costs and native demo cap configuration.
- Review token implementation/governance and transfer restrictions, not just ABI; code drift policy.
- Secure deploy signer access not verified; no private keys inspected.
- Reproducible candidate build, old-state fixture proof and full legacy mode-guard audit.
- Dual-attestation recovery accepted as trusted; no RPC-to-on-chain receipt proof verifier exists.
- Real PostgreSQL crash tests and real promise/sandbox tests not run in this design milestone.
- Current read-only API listing remains job-backed; native list/attempt evidence integration is future work.

No state-changing CLI command or transaction manifest is provided. No source files,
DB records, roles, environment, account permissions or blockchain state were changed.
The next approval is M5-B **local implementation only**.
