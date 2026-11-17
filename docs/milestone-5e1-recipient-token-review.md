# M5-E.1 recipient and Tidepool review

Reviewed 2026-11-17 at `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8`. Local/read-only audit only. [Structured evidence](evidence/milestone-5/m5e1-independent-review/results.json). Separate adversarial pass by the same assistant, not third-party certification.

## Recipient

**RECIPIENT_OWNERSHIP_NOT_VERIFIED. No live recipient was provided or substituted.** Address syntax, chain identity, account existence, token account/asset/code identity and storage are separate checks. Local technical success is not ownership or execution readiness. Pinned block hash/height consistency is enforced; RPC failures, wrong network, mismatched approved token/recipient, missing storage and inconsistent metadata fail closed in fresh tests.

`ownershipPrerequisite` accepts advisory fields but has no signature verifier, authenticated person/session, durable nonce consumption or positive Verified path. Even an apparently valid unexpired claim yields verified:false. This is a prerequisite outside the declared implementation scope, not a new authentication defect. A future proof must bind intended person, network, current account key, fresh nonce/expiry and purpose, and be invalidated on destination/key changes.

The preflight result is not payout/attempt-bound, has no reusable freshness attestation, and cannot safely be used as execution authorization. Current code has no such consumer and executionReady is always false, so stale/cross-payout results cannot activate current host execution. Before future integration, compare immutable binding, token/code hash, campaign/payout/attempt identity and current storage at dispatch; do not trust a copied technicalReady flag. Native contract separately validates immutable Borsh binding and approved recipient evidence hash.

## Fresh token observations

Endpoint: `https://rpc.testnet.fastnear.com`. Finalized height **278122198**, hash `Bf1xdBxiAh8MqrMTcN9p5bJXAREfogcVnJZnwx65onmm`. Every query pins that block and asserts matching response height/hash. Full raw methods/params/results/timestamps: [read-only evidence](evidence/milestone-5/m5e1-independent-review/tidepool-python-readonly.json).

- Token: `usdc.tidepool-sandbox.testnet` / `nep141:usdc.tidepool-sandbox.testnet`.
- Code hash: `DgV3WsKJsGtCjNWxYzFvi599szo7oojkKXWCoGBBAHwj`.
- Metadata: ft-1.0.0, USDC, six decimals, Tidepool Testnet USDC (no value).
- Storage min/max: `1250000000000000000000` yoctoNEAR = 0.00125 NEAR.
- Contract registration present; USDC balance `1000000` atomic (1 test USDC).
- Operator registration present; USDC balance `99000000` atomic (99 test USDC).
- Deployed isolated contract hash `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf` remains the old deployment, not the native candidate.

Node direct and --use-env-proxy attempts both failed before obtaining status. Python urllib (proxy-aware in this environment) succeeded. Both failures are retained; they are not represented as successful Node transport reads or a proof of an application bug. Production/runtime endpoint connectivity remains an operational verification item.

Metadata/storage compatibility: PASS. Local synthetic token transfer/callback compatibility: PASS for fixture semantics. Actual Tidepool transfer/callback compatibility: **NOT VERIFIED**. Views cannot establish atomicity, transfer return values, gas usage or callback behavior. Rust schedules exact bound ft_transfer with 1 yoctoNEAR, 30 Tgas, 50 Tgas private settlement callback; accepts empty/null success and keeps unexpected results unresolved. Token code was not automatically allowlisted in any verifier policy.

A separately approved isolated smallest-amount experiment should measure real delivery/receipt/callback/balance/accounting compatibility. Successful real transfer is an experiment outcome, not a circular prerequisite to proposing the experiment. See [gates](milestone-5e1-controlled-testnet-gates.md).
