# M5-D — Finalized receipt evidence verification

**Trusted read-only RPC verification; not trustless on-chain receipt verification.** No live RPC or signing is needed by the local tests.

## Exact checks

The collector verifies configured chain identity, explicitly requests complete transaction finality, then pins all payout/auth/attempt/outcome/accounting views to one finalized block. RPC transport supports only status, tx_status, block, EXPERIMENTAL_receipt and an allowlist of pinned contract views. It has no send, broadcast, keychain, signer, execution authorization or refund interface. HTTP requests have a10-second bound; response bodies are limited to4MiB after reading and graphs to256 outcomes. These are resource bounds, not a hardened streaming parser or public-facing ingestion service.

Verification recomputes the exact NativeBinding V1 Borsh SHA256 (length-prefixed UTF8, little-endian u64/u128, field order), including campaign/payout/token/recipient/amount/network/domain/reservation actor/time/evidence digest. JSON integer tokens above JS safe range are preserved before parsing; IDs and amounts are validated as bounded unsigned integers. Native approval is Consumed, current attempt matches, original executor/approver separation holds, and all legacy payout fields and outcome identity/memo match. Existing campaign budget/funding/reserved/spent/available invariants are checked.

The original transaction hash/signer/target and single begin_native_preflight action must match the attempt. The root transaction outcome must connect every unique receipt outcome exactly once. Missing children, duplicate parents, disconnected receipt data or unlinked returned promises are rejected. Every action receipt's executor must match its receiver. Every outcome block must be at or below the finalized snapshot height and match the provider's canonical block at that height. This relies on the RPC's chain/finality honesty; ancestry and outcome proofs are not independently verified cryptographically.

The graph must contain exactly one entry, storage lookup, storage callback, ft_transfer and settlement callback at the correct accounts. Parentage, immediate predecessor, original entry/continuation arguments,1-yocto transfer deposit, immutable recipient/amount/memo and storage/transfer data-ID dependencies must match. Reviewed executed-code hashes are read from nearcore receipt metadata for entry, dispatch and token; absent/unsupported metadata is ManualReview. A normal successful callback also requires reviewed callback code. Missing/OOG callback metadata does not erase a successful token receipt.

A successful token result must be the expected unit result (empty or JSON null), with a committed matching NEP-141 event under a reviewed atomic-token code policy. The event alone is insufficient. Successful promise indirection and nonstandard bytes stay unknown. Failed receipt logs are not committed delivery evidence. A failed promise from arbitrary promise-returning token code is not proof of economic non-delivery; classification is restricted to explicitly reviewed atomic token implementations, and never authorizes retry/release.

The semantic evidence digest includes immutable identity, transaction, transfer block/status and the complete normalized receipt/outcome graph. Source timestamps and changing observation heads do not turn the same transfer into another identity. Two sources must agree on both classification and semantic digest. Contradictory valid graphs block decisions. Canonical JSON hashes and SQL immutability preserve collected history, not RPC truth.

## Source trust and local test policy

Distinct source IDs and endpoint URLs are required, but operational independence must be established separately. Local integration deliberately uses127.0.0.1 and localhost aliases of the **same synthetic validator**; it proves both collection branches and persistence, not independent production consensus. Conflicting-source and forged-data cases are explicitly mocked using copies of real captured receipt graphs. No claim is made that a real finalized fork was produced.

Local fixture policy includes exact production C plus separately labeled panic/OOG artifacts, and the local SDK token hash. Fault hashes are test-only. No live Tidepool code hash, signer, recipient or token conformance approval is invented. A future live policy must be independently approved and must not copy fault-artifact allowlists.

## Discovery and archival limits

Discovery is a bounded view scan over explicit IDs; the deployed ABI has no global payout-count/list view. Indexed/submitted IDs must drive ranges, and supplied transaction locators are untrusted hints. No locator or incomplete/garbage-collected history means unknown. No fallback to events, an aggregate balance delta, timeout or PostgreSQL job state asserts transfer failure. The initial non-archival local ledger timed out for older transactions, correctly preventing classification. A fresh synthetic run with extended GC retention supplies retained actual receipts for integration. This is a test retention setting, not a production archival availability guarantee.

Protocol references: [NEAR transaction RPC](https://docs.near.org/api/rpc/transactions) documents FINAL and tx_status; [block/chunk RPC](https://docs.near.org/api/rpc/block-chunk) documents canonical block queries. SDK5.30.1 and nearcore2.14.0 source/runtime remain the installed test versions.
