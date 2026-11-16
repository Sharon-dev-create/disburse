# M5-C — Asynchronous test results

**PASS: all10 requested scenario classes plus additional failure/migration coverage.**
Base `fdd8b48acaa1ad60417ad628b08a7783ede9aba6`,2026-11-16.
Framework: nearcore2.14.0/protocol88, private one-validator synthetic chain,
actual compiled WASM, signed local transactions, action/data receipts and finalized
RPC outcomes. No public-network transaction or live token was used.

## Exact counts and classification

- 146 Rust tests passed,0 failed,0 ignored,0 filtered;0 doc tests.
- 20 new C unit tests supplement the prior126 (two B test names/zero-receipt
 expectations adapted to actual scheduling). The original98 legacy/type tests remain.
- 20 documented real-receipt **scenario groups**, each can contain several signed
 transactions/assertions. These are not20 new Rust test functions.
- All three runtime suite phases passed: normal/migration, fault injection, B→C.
- Sandbox port/listening required approved execution outside filesystem sandbox;
 nodes bound only loopback, used no boot peers and were stopped in finally.

SDK mock/promise-result unit tests are useful for identity/count/decoding,
authority, corruption, expiry, integer boundaries and private-method logic. They
are **not** counted as real receipt tests. Actual wrapper privacy, VM rollback,
committed token effects, OOG and code-upgrade behavior are established by the
runtime scenarios below. No physical disk failure or actual execution-service/
PostgreSQL restart is claimed.

## Scenario evidence matrix

| ID / scenario | Result / real receipts | Evidence and limitations |
| --- | --- | --- |
| S01 — Successful exact native transfer | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/successful-transfer.json). Production candidate, standard SDK token; actual balances, exact receipt args/deposit and settled ledger. |
| S02 — Missing recipient registration | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/missing-recipient-storage.json). Actual storage query returns None; no outgoing ft_transfer, reserve retained. |
| S03 — Concurrent duplicate requests | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/concurrent-duplicate-execution.json). Two async requests, one transfer, one rejected request; no duplicate payment. |
| S04 — Callback panic after settlement writes | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/panic-callback.json). Separate panic artifact; actual successful token receipt, failed callback rollback; no resend, including after production restoration. |
| S05 — Callback gas exhaustion | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/oog-callback.json). Separate1-gas callback artifact; real OOG error, delivered tokens, TransferPending reserve intact; no resend. |
| S06 — Definitive token rejection | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/definitive-token-failure.json). Normal token mode owner-controlled rejection; failed token receipt, no delivery/spent, reserve retained. |
| S07 — Stale/duplicate callback self-calls | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/stale-duplicate-self-callbacks.json). Synthetic contract FullAccess self-calls pass private predecessor boundary then reject stale identity/terminal state; not a live key. |
| S08 — Concurrent payouts sharing a campaign | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/same-campaign-concurrent-payouts.json). Two real overlapping graphs; reserved0/spent200000/available800000 after both succeed. |
| S09 — Concurrent payouts across campaigns | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/concurrent-payout-one.json). Paired with concurrent-payout-two; pooled token, separate campaign accounting and recipients. |
| S10 — Pause between transfer and callback | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/pause-after-dispatch.json). Test-token owner-proxy hook; actual owner pause receipt879 precedes settlement880. Hook-only promise indirection is not production token semantics. |
| S11 — Uncertain response / restart model | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/restart-uncertain-response-model.json). Discarded response and fresh RPC client; resubmission rejected. No actual execution-service/DB restart or network timeout injection. |
| S12 — Atomic scheduling rollback | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/schedule-panic.json). Separate artifact panics after TransferPending writes/events before promise; real rollback leaves PreflightPending and no token movement. |
| S13 — Foreign callback wrapper rejection | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/external-callbacks-rejected.json). Owner/Operator/Executor/other account calls both callbacks; runtime private checks reject. |
| S14 — Minimum / insufficient entry gas | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/minimum-gas-and-low-gas-rejection.json). 100 Tgas rejected before consent consumption;220 Tgas completes successfully. |
| S15 — Insufficient contract NEAR headroom | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/native-near-headroom.json). Synthetic local native-NEAR drain/restore only; low balance rejects before consuming approval, execution succeeds after restore. |
| S16 — Incompatible code upgrade during execution | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/upgrade-between-transfer-and-callback.json). Separate renamed-callback artifact; transfer block1153, upgrade1154, missing callback1156; delivery persists, lock preserved through compatible restoration. |
| S17 — Delivered funds with unexpected result | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/delivered-but-unexpected-result.json). Test-token bad-return hook; delivery occurs but nonstandard bytes yield ManualReview/reserved, no resend. |
| S18 — Insufficient actual token balance | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/insufficient-token-balance.json). Fixture burn models out-of-band custody loss; actual FT failure, no false spent/retry. |
| S19 — Authenticated old deployed WASM upgrade | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/historical-wasm-migration.json). Authentic code with locally populated nonempty legacy settlement/failure/resolution/index data; full raw-state and custody preservation. |
| S20 — M5-B native sidecar WASM upgrade | PASS / yes | [Outcome, balances and state](evidence/milestone-5/m5c-implementation/sandbox/b-to-c-wasm-migration.json). Authenticated M5-B bytecode; approved payout executes under C; old consumed orphan remains frozen with all prior bytes preserved. |

## Callback-failure methodology

Normal flows run the exact final production WASM. Panic,1-gas callback, scheduling-
panic and missing-callback artifacts are isolated source copies in /tmp, never
production feature flags. The panic executes after settlement writes/events,
showing runtime rollback of those writes while the earlier token debit remains.
The scheduling panic executes after TransferPending writes but before promise,
showing rollback to PreflightPending with no token movement. Actual stale and
duplicate self-callback calls use only the synthetic contract key; foreign callers
are rejected by the real private wrapper. These tests do not grant any public key.

The token wraps installed near-contract-standards5.30.1. Rejection/burn/nonstandard
return modes are labeled fixture controls. The owner-proxy pause hook deliberately
returns a promise after debit to enforce receipt order; it is not a claim that a
production token returns such a promise or preserves atomic failure across it.
Only standard mode supports the normal failed-token atomicity assertions. Full
receipt graphs, outcomes and balances identify which mode/artifact was used.

## Reproduction and limits

[Sandbox harness instructions](../tests/sandbox/README.md) describe pinned tools,
locked builds, synthetic keys, isolated fault sources and sequential execution.
See also the paths recorded in [implementation results](evidence/milestone-5/m5c-implementation-results.json).
Command: `python3 tests/sandbox/run_suite.py --sandbox-bin /tmp/disburse-m5c-tools/Linux-x86_64/near-sandbox`.
[Suite phase summary](evidence/milestone-5/m5c-implementation/all-sandbox-suites.json),
[fault artifact manifest](evidence/milestone-5/m5c-implementation/fault-artifact-manifest.json),
[gas/storage/receipt data](evidence/milestone-5/m5c-implementation/gas-and-storage-measurements.json).

The fresh-client test discards acknowledgement and demonstrates durable-chain
replay protection; it does not restart the restricted live service or simulate a
provider network outage. Concurrency cases submit before awaiting completion;
shared-campaign callbacks must both preserve current aggregate accounting.
Raw balance deltas in concurrent cases may cover both payouts; individual token
actions/memos and final per-campaign records establish attribution.

These are local receipt and migration results, not an independent security audit,
production Tidepool conformance/gas proof, real recipient verification or live
migration/deployment approval. M5-D reconciliation, M5-E operational upgrade
validation and M5-F service integration remain separate. All existing review
findings/evidence are preserved as historical artifacts.

## Repository revision note

During this session HEAD advanced externally to `d6f444ae5f6d1843206421f138908db7fca4db30`, capturing in-progress files. No commit/push commands were issued by this session; that commit was preserved. Subsequent report/evidence edits remain local.
