# M5-D — Native payout reconciliation architecture

For current implementation findings and readiness, see the [latest security review](milestone-5d2-independent-security-review.md). Historical milestone statements below describe their original scope and do not authorize execution.

Local implementation, 2026-11-16. **Read-only reconciliation only; authenticated on-chain recovery is BLOCKED.** The authorized M5-C implementation re-review (historical report in Git history) passed with zero unresolved critical/high implementation findings for the pinned C source/WASM. Earlier historical review evidence is unchanged.

## Capability and state boundaries

`execution-service/src/reconciliation/` is an additive subsystem, not a replacement for the existing discovery, execution job, signing, refund or settlement architecture. Nothing imports it into the running host, API, coordinator, worker scheduler or frontend. No application environment or restricted read-only mode changes. One-shot functions must be invoked explicitly; no polling timer/background worker is activated.

A bounded finalized scan reads native sidecars over an explicit ID range and returns unresolved attempts plus a cursor and snapshot block. The actual ABI has no global payout-count/list view; indexed/submitted IDs must drive scan ranges. Null rows do not imply end of history. It does not infer transaction hashes from memos. A transaction locator must be supplied from submission records or indexing, then independently validated against the full graph. Existing event discovery handles legacy events; automatic native locator ingestion/API/dashboard wiring remains future integration, not silently claimed here.

For a known locator, the collector requests `tx_status` with `wait_until: FINAL`, then pins all six native/legacy/accounting views to a finalized block obtained after completion. It retrieves actual action receipts and canonical outcome blocks. A pure verifier validates identity, graph, policy and state. Two distinct configured RPC sources must agree. Network requests finish before the short fenced PostgreSQL completion transaction begins.

| Off-chain result | Meaning | On-chain effect |
| --- | --- | --- |
| ObservedSucceededSettled | Expected standard-token receipt succeeded and private callback/state show settled | None; callback already performed accounting |
| ObservedSucceededSettlementPending | Expected standard-token receipt succeeded; callback failed; durable TransferPending remains | None; reserve remains locked |
| ObservedTransferFailed | Finalized expected receipt failed under reviewed atomic-token policy | None; no retry/release or non-delivery authorization |
| ManualReview | Missing/invalid/conflicting/unsupported evidence or state discrepancy | None; existing reservation/attempt unchanged |

PostgreSQL job `Done` means collection/classification finished, not new settlement. `ManualReview` here is an off-chain incident, not a contract mutation. There is exactly one monetary completion path: the existing C callback. Reconciliation cannot race it into a second settlement because it has no mutation port.

## Evidence-authentication gate

RPC responses are trusted off-chain observations. Distinct endpoints do not prove independent operators or create an on-chain fact. Content hashes protect audit integrity, not receipt authenticity. No light-client/Merkle proof verifier, authenticated recovery quorum, independently approved attestor principals, key rotation, revocation, expiry or anti-equivocation protocol exists in the contract. Inventing a role or accepting `success: true` would bypass the required security gate.

Therefore no Rust mutation, attestation authorization, retry, reservation release, recovery settlement, legacy Verifier shortcut or manual-success method was added. On-chain recovery stays BLOCKED. A future proposal must justify and independently test a light-client/proof boundary or an explicitly trusted, independently authorized recovery quorum before any state-changing implementation. Root upgrade authority and token governance remain trust assumptions.

## Files and preservation

New modules: `evidence.ts` (exact integers/canonical hashing/Borsh identity), `rpc.ts` (read-method allowlist), `verifier.ts` (collection/graph validation), `discovery.ts` (bounded finalized scan), `postgres.ts` (evidence jobs/history/fences), `worker.ts` (explicit one-shot read pass). Additive SQL migration0004 is registered in the existing checksum migration runner. The existing migration integration assertions advance from0003 to0004. No dependency version or package script changed.

Rust/WASM and legacy/native serialized layouts are unchanged from reviewed C. Production DBs have not been migrated. This package's migration registry now knows0004; any future deployment/restart using migration-current checks must separately approve/apply that schema change. The current running mode was not touched.

See [receipt boundary](native-receipt-evidence-verification.md), [persistence](native-reconciliation-postgres.md), test results (historical report in Git history) and [structured evidence](evidence/milestone-5/m5d-implementation-results.json).

## Revision observation

Review began at `d6f444ae5f6d1843206421f138908db7fca4db30`. HEAD advanced externally to `0006f76160a3e23e9870e4349636c7814bb9a7b3`, capturing earlier C reports. No commit/push commands were issued by this session. The reviewed C source/WASM hashes still match exactly. M5-D source/evidence remains local working-tree work.
