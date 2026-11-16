# M5-C — Migration validation results

Base `fdd8b48acaa1ad60417ad628b08a7783ede9aba6`,2026-11-16.
**PASS for local historical-byte and real-WASM upgrade tests. No live migration.**

## Serialization and storage

No legacy top-level Disburse field, Campaign/Payout field, nested amount/destination,
legacy role/status discriminant or old collection prefix changed. Existing native
V1 configuration/binding/payout/authorization/attempt schemas also keep their exact
Borsh layouts. Previously represented enum states are now exercised, not reordered.
The only new data schema is bounded NativeExecutionOutcome, stored under the new
`native-execution-outcomes-v1` namespace. Twenty known prefixes are tested for
uniqueness and prefix overlap. No top-level migration method, state reset or second
initializer is introduced.

Existing owner-only paused bootstrap still validates stored legacy STATE/hash and
SDK collection handles and rejects repetition, malformed inputs and unauthorized
callers. It creates only configuration; the outcome map is populated lazily by a
new authorized execution. No initialization path clears old sidecars or makes a
consumed attempt executable. Existing evidence/replay/index semantics remain intact.

## Evidence levels

| Level | Actual test | Result / limits |
| --- | --- | --- |
| Authentic historical raw bytes | Existing `m5b-deployed-state.json` loaded/deserialized in SDK mock tests | PASS; authentic Nov15 zero-payout fixture, not current live state or full VM migration |
| Synthetic nonempty Rust state | Existing settlement/failure/resolution/index preservation tests | PASS; mock storage, not a substitute for actual VM execution |
| Authenticated old deployed WASM→C | Real sandbox initialization/population, code upgrade, bootstrap and raw-state/token checks | PASS; actual old code, locally populated representative nonempty data |
| Authenticated M5-B WASM→C | Real sandbox with Approved and consumed orphan native records | PASS; byte preservation, approved execution succeeds, orphan stays frozen |
| Live Testnet migration | Not authorized or performed | No live upgrade/readiness claim |

## Historical deployed-WASM upgrade

The old299058-byte artifact was obtained by a **read-only public view_code** query
and authenticated to code hash
`CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`, SHA256
`a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530`.
The observed public block was277901631. No transaction or keychain was involved.
[Provenance](evidence/milestone-5/m5c-implementation/historical-wasm-provenance.json).

The sandbox deployed this exact old WASM and populated funded/Active campaign,
Operator/Verifier roles, accepted token, nonempty payouts, settlement, failure,
resolution and idempotency/execution/replay indexes through actual old methods.
The legacy settlement evidence is **explicitly synthetic local attestation**, not
an assertion that a real external-chain transfer occurred. The local token ledger
is independent and retained unchanged across code upgrade/bootstrap.

After an explicit local pause, raw storage, owner, roles, records/indexes,
accounting and token balance were snapshotted. Deploying C changed code, not any
old raw key/value. Unauthorized bootstrap failed with no state change; authorized
bootstrap added one configuration key; repeated bootstrap failed. Every old key/
value remained identical; owner/accounting and complete settlement/failure record
views matched; idempotency lookups remained accessible; token custody was equal.
This is real old-WASM→new-WASM testing, not serialization of the same new Rust type.

[Historical runtime upgrade evidence](evidence/milestone-5/m5c-implementation/sandbox/historical-wasm-migration.json).

## Native M5-B→C compatibility

M5-B was rebuilt from authenticated repository revision `fdd8b48`; output matched
the recorded385351-byte SHA256
`ad51f8bc061138013ff33620d33adff8dffacb4eaf1c06b09853c79b92c58e94`.
That WASM created native V1 configuration, roles, recipient approval and two100000
reservations. One attempt was Approved; the other consumed B preflight without a
query, preserving the known old-stage orphan.

After C upgrade, **all prior raw state bytes and token custody matched**. The old
Approved authorization executed normally under C and delivered100000. The orphan
remained PreflightPending/Consumed with no outcome slot and rejected resubmission.
Final campaign accounting was available800000/reserved100000/spent100000; recipient
received100000 and source retained900000. No counter/index/owner/role reset occurred.

[Native-sidecar runtime upgrade evidence](evidence/milestone-5/m5c-implementation/sandbox/b-to-c-wasm-migration.json).
The old orphan is a deliberate fail-closed limitation requiring future M5-D evidence-
based resolution, not permission to silently continue/retry an unknown attempt.
No live M5-B foundation was deployed during these milestones.

## Upgrade during an in-flight transfer

A separately built test artifact renames only the final callback. Local token
transfer committed at block1153, that code upgrade applied1154, and the scheduled
callback failed MethodNotFound at1156. Recipient delivery persisted while C's
TransferPending/reserved lock remained. Restoring the compatible production C
artifact did not reset it; another execution request rejected.

This establishes failure safety for that incompatible callback scenario, not
safety of arbitrary migrations or malicious root code. An arbitrary old deployment
can ignore sidecars and re-enable legacy settlement/release. Never treat code
readability, rollback or old-state restoration as reversal of external transfers.
Freeze new initiation, preserve attempts and evidence, independently resolve receipt
outcomes, then use reviewed compatible forward fixes.

## Remaining deployment gates

These private one-validator tests do not verify a future fresh live snapshot,
production signer/key governance, arbitrary unknown storage prefixes, all future
schema versions, multi-validator forks/load or real Tidepool behavior. M5-E must
review the final candidate and exact live upgrade/bootstrap/maintenance procedure;
fresh code/state/token/key checks and explicit approvals remain mandatory.
Actual historical on-chain nonempty payout data was not fabricated or claimed.
The authentic saved raw fixture remains unmodified. No live Campaign0, contract,
account role, token balance or permissions changed.

## Repository revision note

During this session HEAD advanced externally to `d6f444ae5f6d1843206421f138908db7fca4db30`, capturing in-progress files. No commit/push commands were issued by this session; that commit was preserved. Subsequent report/evidence edits remain local.
