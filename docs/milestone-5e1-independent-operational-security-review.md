# M5-E.1 independent operational security review

**Verdict: PARTIAL. Controlled Testnet: NOT READY. Production: NOT READY.**

Reviewed 2026-11-17 at `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8`. Local/read-only audit only. [Structured evidence](evidence/milestone-5/m5e1-independent-review/results.json). Separate adversarial pass by the same assistant, not third-party certification.

Core RPC streaming, lease fencing and payment invariants passed fresh local verification. Two low-severity gaps prevent unqualified acceptance of the claimed end-to-end hardening coverage. No CRITICAL, HIGH or MEDIUM implementation finding was confirmed. Neither gap authorizes a transfer, settlement or recovery. Remaining recipient/custody/monitoring requirements are separately classified prerequisites, not fabricated code defects.

## Source identity

Initial `main...origin/main` was clean; staged and unstaged diffs empty. `020cb7f79b5f86889f764f5dec2c8291e99094a3` → `840c87f6d4a605b9dd70169133ee859e03af99fb` adds only D.4 documents/evidence. `840c87f` → current commits exactly the M5-E source/tests/docs/evidence. All prior M5-E inventory hashes match. No unrelated Rust, lease repository, authorization, schema, frontend or network configuration changes found. Original M5-E report calls 840c87f its baseline while narrative cites initial 020cb7f; these have identical application source, so this documentary difference does not invalidate source identity. D.4 still applies to unchanged safety-critical code; changed transports/verifier/worker were reviewed anew.

[Baseline commands and file hashes](evidence/milestone-5/m5e1-independent-review/baseline.json), [comparison](evidence/milestone-5/m5e1-independent-review/source-comparison.json). Current candidate remains 410611 bytes, SHA-256 `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`, code hash `4mBF2J6mE22XrTrSNo8x7xSLhzUSfNS9HkzHJeaxqwk4`.

## Findings

### M5E1-01 — LOW: Startup error sanitization echoes untrusted RPC text and reflected URL credentials

- Location: `execution-service/src/host/server.ts:233`.
- Expected: Startup diagnostics exclude endpoint secrets and arbitrary provider text.
- Observed: A real local status endpoint reflects a synthetic URL-path token as chain_id. NearContractReader includes it in its network-mismatch message; sanitizeHostStartupError preserves that entire message. The normal CLI prints the returned message.
- Reproduction: adversarial.mjs: startup exception redaction adversarial reproduction; adversarial-results.json contains the synthetic canary only, no real secret.
- Impact: Potential credential disclosure/log injection into startup log readers. The provider already sees its URL token; no private key or unrelated database secret was recovered. Startup still fails closed. Existing sanitizer behavior predates M5-E.
- Recommendation: Use a fixed allowlist of safe startup error codes/messages; never copy provider-controlled chain_id or raw error messages into logs. Add adversarial exception/URL-reflection regression coverage.
- Local safety acceptance blocked: no. Controlled operational experiment/production gate: resolve before integration. Resolve before credential-bearing operational startup; this gate does not assert a token-transfer or authorization bypass.

### M5E1-02 — LOW: Recipient token inspector omits decoded JSON depth guard

- Location: `execution-service/src/near/recipient-preflight.ts:117`.
- Expected: Decoded token-view JSON receives the same nesting cap before parsing as other NEAR view clients.
- Observed: A real HTTP query response with shallow outer JSON and byte-encoded 100-level nested JSON is accepted by TestnetInspector.view despite the shared default JSON depth of 64. The other generic and reconciliation view clients check decoded depth.
- Reproduction: adversarial.mjs: actual bounded transport still accepts deeply nested encoded token JSON; adversarial-results.json records depth 100.
- Impact: Declared JSON-nesting protection is incomplete on this inspection path. The 4 MiB outer streaming byte limit and request deadlines still apply; no unbounded response allocation, stack crash, false technical readiness or payment authorization was demonstrated. nativeRecipientPreflight metadata shape validation rejects this array.
- Recommendation: Apply decoded UTF-8/depth validation consistently before exactJson in TestnetInspector.view, with actual-transport encoded-payload tests.
- Local safety acceptance blocked: no. Controlled operational experiment/production gate: resolve before integration. Close the claimed resource-hardening coverage gap before integrating this preflight into an approved experiment.


## Results and boundaries

Fresh validation: 146 Rust, 175 service, 46 PostgreSQL, eight local RPC tests and 20 sandbox groups, zero failures/skips. Eighteen focused operational cases succeeded, including successful reproduction of both defects; six preserved D.4 adversarial lease cases freshly rerun also pass. This is not a production load, external-provider independence or actual Tidepool transfer certification.

Read the [RPC review](milestone-5e1-rpc-resource-safety-review.md), [recipient/token review](milestone-5e1-recipient-token-review.md), [safeguards](milestone-5e1-execution-safeguards-review.md), [monitoring](milestone-5e1-monitoring-readiness-review.md), [regressions](milestone-5e1-regression-results.md), and [controlled-experiment gates](milestone-5e1-controlled-testnet-gates.md).

No source remediation was implemented. No deployment, public transaction, live worker, configuration change or Git mutation occurred. Stop after review; next milestone should be small local remediation and focused re-review before preparing a separate experiment approval.
