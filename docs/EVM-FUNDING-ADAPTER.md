# EVM funding adapter v1: local feasibility spike

**Decision: NO-GO for production funding.** The Anvil proof demonstrates an exact ERC-20 transaction policy and independent receipt verification on one local EVM. It is not a production signer boundary and does not establish multi-chain support.

## Scope and funding threat model

This spike authorizes and submits only a direct ERC-20 `transfer(address,uint256)` on an explicitly configured EVM chain. It does not broadcast to a public network. Funding amount comes from the persisted active reservation and must equal the persisted provider quote maximum. The operation journal keeps an uncertain attempt exposed; provider settlement remains authoritative for payout completion.

| Failure | Control/evidence | Residual risk |
|---|---|---|
| Deposit exceeds authorized maximum | Decode final calldata in `PolicyCheckedAnvilSigner` immediately before signing; compare recipient and exact amount to the locked reservation. Reject any extra transaction fields, native value, wrong token, chain, source, nonce, or gas policy. | A signer that does not perform the same independent policy check, or a compromised application that can replace both policy and signer, can bypass it. Production needs isolated signing policy. |
| Duplicate submission | Unique idempotency key and reservation, unique `(chainId,sourceAddress,nonce)`, serialized nonce cursor, persisted signed transaction and hash. Retries only rebroadcast the same encrypted bytes. | Crash between signature creation and persistence needs an idempotent signer or deterministic signing request keyed by operation ID; local Anvil has deterministic keys but this is not an HSM guarantee. |
| Wrong asset/network | Per-chain asset/token allowlist, RPC chain ID and token decimals check, then verify transaction fields and Transfer log against the stored operation. | Token contract can be malicious, proxy-upgraded, fee-on-transfer, rebasing, or non-standard. The spike supports only reviewed standard ERC-20s; arbitrary ERC-20 semantics are not covered. |
| Expired quote | Check quote expiry before authorization and immediately before signing. | Once signed/broadcast, an expiry cannot revoke a transaction already in a mempool. |
| Fee deductions/underfunding | The adapter transfers the exact source token amount; gas is paid separately in native coin with explicit fee caps and balance checks. | Token-specific transfer taxes or destination/provider behavior can still yield less credited amount. Receipt proves emitted event, not provider credit. |
| Broadcast but delayed confirmation | Persist raw signed transaction encrypted before broadcast. No receipt is `UNKNOWN`/`CONFIRMING`; keep reservation. | RPC outages or a stuck nonce can keep exposure unresolved. |
| Provider status disagrees with chain | Chain tx, receipt status, canonical block hash, exact Transfer log, and confirmation depth are independently queried. Provider status does not prove source transfer. | RPC/operator trust and chain finality assumptions remain. Use independent RPCs and chain-specific finality policy in production. |
| Worker restart during unresolved tx | Journal and nonce allocation are durable; restart resumes from ciphertext/hash. Re-broadcast is byte-identical. | Decryption key availability and signer idempotency are operational dependencies. Do not create a replacement nonce while the old outcome is unknown. |
| Reorg after observation | The operation records block identity; a noncanonical or missing transaction is marked `REORGED`/`UNKNOWN`, with a compensating `DEPOSIT_REVERSED` ledger event where a receipt is known to have been observed. | Reorg recovery and downstream reservation restoration require production-grade orchestration and independent RPC evidence; not complete enough for release. |

## 1Click findings and boundary

NEAR Intents 1Click is a quote/deposit protocol, not a source-wallet transaction policy. A `depositAddress` tells a client where to send source assets. `amountIn`/`maxAmountIn` stored by Disburse are authorization data unless the wallet or a chain-side contract constrains the transaction that the source account signs. A provider quote cannot prevent a wallet from signing a larger transfer. Refunds after excess deposit are recovery behavior, not a pre-broadcast maximum.

This spike does not treat a provider-reported quote or status as proof that an oversized source transaction was impossible. The enforcement point here is the independent signer policy immediately before signing the exact raw transaction. If the wallet itself is the signer, it must independently enforce the same allowlist and amount policy. For EOA ERC-20 calls, a transfer is authorized by the signed calldata and token contract; there is no generic ERC-20 allowance limit for a direct `transfer` call.

## Funding-control options

| Approach | Enforceability | Chain/token reach | Signing authority | Complexity / recovery | Security assumptions |
|---|---|---|---|---|---|
| App-side transaction builder only | Low; buggy caller can change fields after construction | Broad in theory | App or connected wallet | Low; ordinary tx-hash recovery | Builder and signer path are trusted together |
| Isolated signer policy (selected for EVM v1) | Strong against compromised callers if signer independently reads persisted authorization and refuses other calls | EVM chains, but only configured chain/token semantics | Dedicated HSM/KMS/MPC signer | Medium/high; nonce journal, durable request IDs, encrypted raw-tx journal, chain reconciliation | Policy service, DB identity, signer isolation and chain RPC remain trusted |
| ERC-20 allowance cap | Only constrains `transferFrom` under allowance; does not cap owner `transfer` | ERC-20 contracts on EVM | Token owner approves spender; spender has transfer authority | Allowance lifecycle/revoke and nonce recovery; adds approvals | Token obeys standard allowance semantics; spender is safe |
| Smart-contract escrow/vault | Strong within its contract rules | Only deployed chains and compatible assets | User funds/calls vault; contract controls onward transfer | High; deploy, audit, upgrade/recovery design | Contract code/admin/key and token behavior are safe |
| Wallet-level policy | Potentially strong when the wallet enforces decoded chain/token/recipient/amount rules | Wallet-specific | User or institutional wallet | Vendor-specific; wallet recovery mechanisms | Wallet policy cannot be bypassed by alternate signer/API |
| Chain-specific transaction constraints | Varies; some chains encode transfer limits or account permissions | Chain/token-specific | Depends on chain | Requires separate adapter and finality/reorg model | Chain implementation and RPC evidence are trustworthy |

There is no universal multi-chain mechanism with identical guarantees. Production needs an adapter capability contract such as `exactTransferLimit`, `independentSignerPolicy`, `allowanceBoundedTransfer`, `contractEscrow`, `transactionEvidence`, and `finalityPolicy`. Unsupported or ambiguous capabilities must fail closed. A capability is declared per chain, token class, and signer mode, not globally.

## Local proof and enforcement answers

1. **What prevents oversize broadcast?** The policy-checked signer rejects any transaction whose decoded ERC-20 recipient or amount differs from persisted operation data. This is a local application boundary, not a cryptographic chain guarantee.
2. **When is the max enforced?** After the funding journal/reservation are reloaded from PostgreSQL, immediately before the signer produces signed bytes. The service re-parses/recover-verifies the returned signed transaction before persisting it or broadcasting.
3. **Can a compromised component bypass it?** Yes, in this spike. The policy wrapper and signer share a process and can be replaced together. Production must isolate the signer and make authorization data read-only to it, with policy independently enforced inside the signing boundary.
4. **How is actual transfer verified?** Query transaction and receipt, verify chain/from/token/nonce/data/value, successful receipt, exactly one matching ERC-20 `Transfer` event, canonical block hash, and configured confirmation depth. This verifies on-chain event evidence, not provider credit or token economic behavior.
5. **Uncertain transaction outcome?** Keep the operation and reservation unresolved. Retry only the persisted encrypted signed bytes and same hash; do not create a replacement transfer/nonce until resolved.
6. **Safe chains/assets?** This proof only supports the local Anvil chain and its standard test token. Production support is NO-GO until each EVM network has isolated signer enforcement, reviewed token allowlisting, independent RPC/reorg/finality policy, and tested recovery. It makes no claim for non-EVM chains.

## Local setup and test

The test uses only the disposable accounts and chain state created by local Anvil. Never point `ANVIL_RPC_URL` at a public network. It needs the project's test PostgreSQL database and applies the additive `20261106120000_evm_funding_operations` migration.

```sh
anvil --silent --port 18545
pnpm exec prisma migrate deploy
pnpm exec prisma generate
forge build
pnpm run test:evm
```

The Anvil signer uses the node's unlocked disposable key; no private key is stored by this proof. Signed bytes in the journal are AES-256-GCM encrypted using an injected in-memory test key. Production must inject a managed key and never expose ciphertext/plaintext in API responses or logs.

## Limitations and assumptions

- Local signer is not an HSM/MPC boundary; same-process code compromise can bypass it.
- One standard, non-fee-on-transfer test ERC-20 and one local EVM are exercised.
- The provider deposit address is treated as the intended destination; confirmation does not prove the provider credited a quote.
- Fee policy covers EIP-1559 native gas only. L2 data fees, blob fees, account abstraction, smart accounts, multisig flows, legacy networks, and chain-specific fee models need separate capabilities.
- ERC-20 event evidence can be misleading for malicious/non-standard tokens. Token review and independent state/balance checks are required before production.
- External RPC consistency, deep reorgs, signer key rotation, nonce replacement/cancellation and operational incident handling need additional design and tests.
- Never infer payout success from source deposit confirmation. Existing settlement reconciliation remains responsible for provider settlement and reservation release.

## References

- [viem `sendTransaction` documentation](https://viem.sh/docs/actions/wallet/sendTransaction) describes wallet-mediated transaction creation/signing/submission; Disburse still must enforce its own transaction policy at the signing boundary.
- [Foundry Anvil documentation](https://www.getfoundry.sh/anvil/index.html) describes a local development node with disposable accounts and controllable mining; it is the only chain used by the integration proof.
- NEAR Intents 1Click funding semantics are documented in the official API reference: https://docs.near-intents.org/near-intents/1click-api (quote, deposit address, exact-input/output and excess-deposit/refund behavior). Provider refunds are post-deposit recovery, not a wallet broadcast limit.
