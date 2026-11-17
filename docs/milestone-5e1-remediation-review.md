# M5-E.1 remediation — separate reviewer verification

**PASS for the two scoped fixes. Controlled Testnet remains NOT READY.**

Reviewed 2026-11-17 at `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8` plus the identified local patch. This is a separate-agent review after implementation, not third-party certification. [Structured results and exact file hashes](evidence/milestone-5/m5e1-remediation-review/results.json).

## Verification

- **M5E1-01 CLOSED for reviewed paths.** Startup reconstructs a classified RPC error from fixed text, omits provider-controlled message/cause, and preserves kind/retryability. Network mismatch no longer interpolates the provider's chain ID. The exact safe paused-contract diagnostic remains intact. API RPC failures retain the generic near_rpc_failure/502/503 classification; readiness emits dependency booleans rather than raw exceptions. Structured monitoring discards arbitrary URLs/errors. Independent probes covered all ten RPC kinds, five generic startup exception labels, direct hostile chain ID, readiness dependency failure and structured monitor redaction. No synthetic token remained in inspected diagnostics.
- **M5E1-02 CLOSED.** Inspector obtains the transport's validated depth setting, strictly decodes UTF-8, then checks decoded JSON depth before exactJson. resource-limit is not rewritten to malformed. Actual HTTP probes independently tested array, object and mixed nesting at default depth 64/65: 64 accepted, 65 rejected without recording evidence. Independently rerun new tests covered configured limit 4 at 4/5. Valid metadata, quoted brackets, escaped quotes and exact large integers continue to parse. Invalid UTF-8 and malformed JSON reject safely.

## Tests and scope preservation

Reviewer independently reran **11 new regression tests: 11 passed, 0 failed/skipped/cancelled**, and **seven additional probe groups: seven passed**. [Test log](evidence/milestone-5/m5e1-remediation-review/focused-tests.log), [independent probes](evidence/milestone-5/m5e1-remediation-review/independent-probes.json), [probe source](evidence/milestone-5/m5e1-remediation-review/independent-probes.mjs).

Final raw regression evidence independently inspected: **146 Rust, 186 service (175 baseline + 11 new), 46 PostgreSQL, eight local RPC tests and 20 sandbox groups**, all pass with zero failures/skips. Full wrapper has a fresh PASS marker; candidate WASM SHA remains `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`. This reviewer inspected completion/count logs, receipt summaries and cleanup rather than rerunning the full wrapper. Owned DB19550 is stopped and sandbox cleanup is recorded. Independent baseline comparison finds only the three intended tracked source changes; new tests are local. No Rust contract, migration, lease, authorization or live execution composition changed. Reviewer issued no public RPC, database mutation, worker activation or transaction.

## Remaining impact

No new confirmed finding in the scoped patch. These fixes close the two low-severity implementation findings for the reviewed boundaries; they do not resolve recipient ownership, unverified actual Tidepool behavior, dormant live safeguards, incomplete production telemetry, custody or explicit experiment approvals. Arbitrary future raw NearRpcError logging is not automatically safe: the class intentionally carries messages, while reviewed diagnostic boundaries sanitize them. Startup intentionally drops raw HTTP status/cause to prevent secret propagation while retaining RPC kind and retryability. No change to transfer/settlement authority is introduced.

Do not revise historical M5-E.1 results in place. A broader updated gate can reference this review and final regression evidence while retaining the original PARTIAL audit as historical evidence. Stop before any live action.

## Final source identity confirmation

HEAD advanced externally to `542cc71044531fce2aa940b2c21f64f663ef7e53`, committing the reviewed patch and evidence. No reviewer Git mutation occurred. All four inspected source/test hashes are identical to the independent probe snapshot. The original baseline-to-final-HEAD source diff is exactly the three scoped source files plus the new regression file; an empty final tracked worktree diff does not mean the patch disappeared. Final verdict remains **PASS for both fixes**, with no new finding; broader controlled Testnet prerequisites remain unresolved.
