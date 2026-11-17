# M5-E.1 scoped operational remediation

Implemented locally on revision `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8`, 2026-11-17. This addresses M5E1-01 and M5E1-02 from the preserved [independent review](milestone-5e1-independent-operational-security-review.md). It does not supersede or rewrite that historical review verdict.

## Changes

- `execution-service/src/host/server.ts`: typed RPC startup failures return a fresh error with the original kind/retry classification and a fixed message. Provider text, URLs and nested exception causes are omitted. Untyped RPC failures use a fixed generic message. The existing exact paused-contract diagnostic is retained as a fixed allowlisted message.
- `execution-service/src/near/rpc.ts`: network mismatch diagnostics no longer interpolate provider-controlled chain identity. The transport exposes its validated JSON nesting limit as a readonly value for token inspection.
- `execution-service/src/near/recipient-preflight.ts`: decode token-view bytes as strict UTF-8 and enforce the transport's configured JSON nesting limit before parsing. Injected transports without a limit retain default 64; invalid limits are rejected using existing HTTP limit validation. Depth failures retain resource-limit classification rather than becoming malformed JSON.
- `execution-service/tests/operational-audit-regressions.test.ts`: eleven regression cases exercise typed startup redaction/classification/cause stripping, untyped errors, actual HTTP reflection of a token-bearing URL, API diagnostic redaction, arrays and objects at/beyond configured depth, and valid metadata containing nested values and quoted bracket characters.

Existing API diagnostics already replace RPC exception text with a fixed near_rpc_failure response; the new test verifies that boundary without changing it. Existing authenticated readiness catches dependency exceptions and returns booleans. Structured monitor field filtering remains unchanged. No general-purpose arbitrary error logger or new logging route was introduced.

## Validation and preservation

The first service run exposed an existing assertion requiring the exact paused-contract message. The implementation was corrected to retain that safe fixed diagnostic; no existing test was weakened. The failed run is retained as service-check.log; the completed rerun is service-check-final.log. An initial test-file creation used an incorrect relative working path and created no file; the corrected absolute path was used. An initial sandbox-copy command addressed itself; the final server file was copied from the repository before the TypeScript phase and source/test hashes match. These setup errors are not counted as passing validation.

[Structured results](evidence/milestone-5/m5e1-remediation/results.json) records completed counts, commands, limitations and separate-review outcome. [Integrity evidence](evidence/milestone-5/m5e1-remediation/integrity.json) records all changed file hashes and the identical tested sandbox source snapshot. [Separate reviewer report](milestone-5e1-remediation-review.md) assesses the fixes independently; this is separate-agent review, not third-party certification.

Only three application files and one new regression-test file were changed. Rust contract, migrations, lease repositories/fencing, authorization/refund logic, frontend, live configuration and execution composition remain unchanged. Candidate WASM remains 410611 bytes with SHA-256 `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`. Earlier review evidence is unchanged. No public RPC or transactions, deployment, signer/worker enablement, live database writes, commit or push occurred.

## Remaining boundaries

Recipient ownership, live recipient verification, actual Tidepool transfer compatibility, integrated monitoring and an approved isolated experiment remain separate prerequisites. This patch introduces no execution authority, recovery or settlement path and does not make Testnet execution ready. Any live operation still requires separate explicit approval.
