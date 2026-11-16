# Milestone 4-A — verified campaign activation

**PASS.** One explicitly approved activation transaction was signed and submitted.
Repository HEAD at execution: `913ae89e627c287af176aa9b0e6f9e4091d68ab7`, clean main
tracking origin/main. Date: 2026-11-15. No payout transaction was authorized or made.
The user's new Milestone 4 instructions superseded the historical proposal's
NOT_APPROVED marker for this exact activation only.

[Finalized transaction EZhByibUowLhnZ8bFFCmDBjMJQ25eovV5Rjx8AvcB8Yu](https://testnet.nearblocks.io/txns/EZhByibUowLhnZ8bFFCmDBjMJQ25eovV5Rjx8AvcB8Yu)

| Field | Executed value |
| --- | --- |
| Network | NEAR Testnet |
| Signer | disburse-op-b966e36d.testnet |
| Receiver | disburse-test-contract.testnet |
| Actions | Exactly one FunctionCall |
| Method | activate_campaign |
| Arguments (exact JSON) | `{"campaign_id":0}` |
| Attached deposit | 0 yoctoNEAR |
| Prepaid gas | 30000000000000 (30 Tgas) |
| Nonce | 277417983000004 |
| Gas burnt, all outcomes | 2357700367580 (2.35770036758 Tgas) |
| Tokens burnt | 213451780508000000000 yoctoNEAR (0.000213451780508 NEAR) |

Fresh finalized preflight confirmed Approved (not already Active), owner, unpause,
explicit Operator, accepted token, count1/payout0, exact funded accounting, balances,
fee sufficiency and matching FullAccess key. No prior activation submission marker
or execution record was found. Fresh live WASM equals the reviewed local artifact;
its live ABI body equals the local generated ABI. Reviewed source is unchanged.

The unsigned one-action transaction was printed and inspected before CLI signing
through the verified Operator legacy keychain. An independent Ed25519 check then
verified the signed transaction hash and all approved fields. The CLI refreshed
only the recent block hash, which was checked on Testnet. No private key was
exported. An exclusive submission marker allowed one send_tx request and prevents
accidental reruns; no automatic retry occurred.

A separate tx RPC query confirmed final_execution_status FINAL. Transaction and
both receipt outcomes succeeded:

| Outcome | Executor | Result | Gas burnt |
| --- | --- | --- | ---: |
| EZhByibUowLhnZ8bFFCmDBjMJQ25eovV5Rjx8AvcB8Yu | Operator | SuccessReceiptId | 309680746310 |
| 9b4cwc2y5cwywCcfpcSRXgWcg38kjM1Q2NcUou6YFTgg | Isolated contract | SuccessValue empty | 1824837058770 |
| BG6M9EL4V8Cut3z6fsb77ibUukUnkaKEV7QCw9ZeAvAJ | Operator gas refund | SuccessValue empty | 223182562500 |

Exactly one event was emitted:

```json
{"standard":"disburse","version":"1.0.0","event":"campaign_activated","data":[{"campaign_id":0,"actor_id":"disburse-op-b966e36d.testnet"}]}
```

## Independent postflight

| Property | Verified after |
| --- | --- |
| Campaign 0 | Active |
| Budget / funded / available | 1000000 each |
| Reserved / spent | 0 each |
| Campaign count / decoded payout count | 1 / 0 |
| Operator token balance | 99000000 (99 test USDC) |
| Contract token balance | 1000000 (1 test USDC) |

No token transfer or payout event occurred. Full storage comparison found exactly
one changed campaign field: Approved Borsh status5 → Active status1. The global
STATE record and every other key/value remain identical. Funding/accounting views,
owner, pause, roles, token allowlist/metadata/registrations and code hashes match
preflight. Code hash remains
`CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`.
The original protected account's full application storage, code, NEAR balance and
key list/nonces remain unchanged. Operator NEAR decrease exactly reconciles to
burnt fees; no other fund movement occurred.

[Public execution evidence](evidence/milestone-4/gate-a-executed.json) retains
finalized heights, hashes, outcomes and comparison inputs. Duplicate WASM/ABI byte
arrays and transaction signatures are omitted; signed blobs remain outside the
repository. Historical proposal/preflight evidence is preserved. Reads span
finalized blocks, not one atomic cross-contract snapshot. Source provenance is the
recorded host build plus exact live-artifact match, not a new hermetic rebuild.

Only activation changed chain state. No Rust/TypeScript/frontend/environment,
PostgreSQL records, roles/configuration, signing workers or settlement changed.
M4-B begins only after this independently verified PASS and remains read-only.
