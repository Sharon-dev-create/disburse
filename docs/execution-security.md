# Execution security controls and limits

Checked against the repository implementation on 8 November 2026. This document describes service-side input checks and authorization records. It does not describe a production signer or trustless execution system.

## Control sequence

1. **Input validation:** `networks.ts` accepts only canonical registry IDs: `eip155:1`, `eip155:8453`, `near:mainnet`, and `near:testnet`. The registry's `executionEnabled` is false for every entry; this is format identity support, not route approval. 1Click routes still require exact configured provider asset mappings.
2. **Recipient/refund validation:** EVM addresses require 20-byte hex and nonzero address; lowercase and uppercase are accepted as unchecksummed forms. Mixed-case values must pass EIP-55 using Keccak-256. NEAR IDs follow the 2–64 character named-account grammar or 64-character lowercase implicit account hex. EVM network aliases such as `eth:mainnet` and `base:mainnet` are rejected.
3. **Refund policy approval:** `RefundPolicyRepository` binds campaign, payout, source network/token, validated refund address, version and canonical UTC approval time. SHA-256 fingerprints are recomputed on read. A PostgreSQL insert-only adapter, `pg` pool boundary, and versioned additive migration are implemented; the in-memory repository remains a test double. The migration has not been applied by this implementation session.
4. **Policy evaluation:** `authorizeExecution` compares configured source/destination allowlists, normalized recipient/refund, exact output, quote-required input, payout input and campaign reserved totals using `bigint`.
5. **Execution authorization record:** The record binds the request, signing-policy fingerprint, refund-policy fingerprint, full canonical quote fingerprint (route, amounts, minimum output, fees, metadata and freshness), attempt ID, independent expiry, and a reservation identity including contract/network/campaign/payout, reserved accounting, output, recipient, status and observed block. Creation yields `Created`; explicit approval produces `Approved`.
6. **Integrity verification:** `verifyExecutionAuthorization` recomputes the canonical SHA-256 payload and policy fingerprint before comparing current request, quote and reservation fields. A hash detects accidental or unauthorized mutation only if its value is trusted; it is not a digital signature and anyone able to create records can recompute it.
7. **Replay protection:** `PostgresAuthorizationRepository` consumes with a conditional `UPDATE ... WHERE lifecycle = 'Approved' ... RETURNING`, guarded by PostgreSQL row locking and a unique payout/attempt constraint. Its migration adds constraints and a trigger that rejects invalid lifecycle transitions and payload mutation. Mock/unit tests exercise repository query behavior. Separate real-PostgreSQL integration tests now cover concurrent consumption, duplicate insertion, refund immutability, process restart, and rollback, but have not been run because this execution context cannot access the host database and this work explicitly leaves host DB mutations to the operator.
8. **Cryptographic signing:** **NOT IMPLEMENTED.** `DeterministicMockSigner` produces policy decisions and audit records; it does not sign transactions or provide an unforgeable authorization token. A worker in the same process must not treat SHA-256 as proof that a trusted signer approved a request.
9. **Transaction submission:** **NOT IMPLEMENTED.** No deposit, signing, transfer or settlement request is called.
10. **Destination verification and NEAR settlement:** **NOT IMPLEMENTED.** Provider status is not transfer proof. The Rust Verifier role remains a trusted attestation boundary; `settle_payout` checks exact payout identity/amount but does not inspect an external chain.

## Refund custody choice

Use a payout-specific refund policy approved before quote/deposit preparation. The refund address must be valid for the exact source network and bound to the campaign, payout, source token, version and approval timestamp. Workers pass the approved object; they cannot select another destination. A provider echo must match it exactly.

This is the safest default among payout, campaign, treasury and source-account choices: it makes each recovery destination explicit for the exact authorized obligation. A campaign-level address can create cross-payout coupling; a global treasury concentrates custody; automatically using an original source account assumes the account is known and under controlled ownership. **No refund address is invented here.** 1Click's current terms say eligible refunds may be attempted to the supplied refund destination and may fail, be partial, delayed, fee-bearing or unavailable. A provider's `REFUNDED` status is not independent proof of funds returned.

The contract does not persist a refund policy or a reservation nonce. A PostgreSQL refund-policy adapter and immutable table are implemented behind the service composition boundary, but they are not connected to a live execution pipeline. Before execution, apply the reviewed schema through the controlled migration and either store a policy fingerprint in a reviewed contract extension or ensure an independently controlled policy service signs the binding. No Rust state or ABI was changed.

## Network and recipient registry

The code currently recognizes Ethereum mainnet (`eip155:1`), Base mainnet (`eip155:8453`), NEAR mainnet, and NEAR testnet as address-format identities. These are **not enabled execution routes**. Unknown aliases and chain IDs fail closed. Add an entry only after chain identity, token metadata, RPC verification, and route configuration are reviewed together.

EVM input is normalized to lowercase only after shape, zero-address and mixed-case checksum validation. Lowercase and uppercase are accepted as unchecksummed forms; mixed case requires valid EIP-55. A real checksum is chain-independent, but network identity is separately pinned through EIP-155 registry ID. NEAR account IDs are preserved byte-for-byte because named account IDs are lowercase and case sensitive; uppercase is rejected. Implicit account IDs must be 64 lowercase hex characters.

Limitations: the local Keccak implementation has deterministic known-vector coverage but is not a substitute for an audited crypto library. The dependency catalog contains no ethers/viem/Keccak package. A maintained checksum library should replace it after dependency review is permitted.

## Quote freshness and exact output

The 1Click adapter always requests `dry: true`. The response's local freshness time is not a provider expiry. The authorization policy requires provider-issued issue and expiry timestamps when `requireFreshQuote` is true, so the current dry quote (which has no provider expiry) cannot pass signer authorization. Setting freshness off is explicit (`requireFreshQuote: false`, `maxQuoteAgeMs: null`) and weakens protection against stale pricing; it is a policy test mode and must not be used for real execution.

The request's expected output must equal the contract payout output exactly. The quote's required `amountIn` must fit both the explicit maximum and on-chain observed payout input. A quote is rejected if its minimum output is missing or lower than the payout output. No minimum-output substitution occurs.

**Exact-output compatibility: UNKNOWN / NOT ESTABLISHED.** The official 1Click API documents an `EXACT_OUTPUT` parameter and exact nominal output in quote data, but the current Terms of Service say indicative quotes are non-binding, not reserved, and a later execution process may fill differently within slippage tolerance. Execution may fail and refunds are not guaranteed. A request parameter is not a binding commitment. To reconsider compatibility, require written/official committed-order semantics, signed field coverage and verifiable key rotation, a committed-order API response including cap/expiry/recipient/output, and independent successful destination-chain evidence demonstrating the exact atomic amount. Until then preserve exact contract settlement and do not submit a transaction.

## Quote signatures and provider trust

1Click's OpenAPI contains a quote `signature` described as provider confirmation for a quote/deposit address and says to retain it for disputes. The schema does not identify a canonical verification key, signature algorithm/encoding, complete signed-field set, key distribution/rotation rules, or a binding fill obligation. Dispute evidence is not proof of execution. The adapter retains the string as untrusted provider metadata; it does not verify it.

## Reservation and authorization binding

The contract is authoritative: payout status `Reserved`, campaign/payout IDs, input token/amount, expected output, recipient and campaign accounting are exposed by views. Authorization consumes a `PayoutReservationSnapshot` with these values and a caller-supplied block observation. The existing `NearContractReader` reads payout and campaign accounting separately at latest state and has no block-pinned read bundle. The contract has no reservation ID/nonce. Consequently the current offline authorization function tests these values but cannot prove that its supplied snapshot is authentic or coherent. This is **BLOCKED for production use** until a block-pinned reader bundle (or a contract view returning the complete payout plus accounting at one state root) feeds the authorization service. Do not use a database row as authoritative reservation evidence.

The current coordinator does not call the new authorization module as part of an execution pipeline; no live execution pipeline exists. Unit-test success must not be presented as connected production enforcement.

## Signing and verifier separation

- **Worker:** discovery, route request and validation only; no keys.
- **Policy service:** reads authoritative reserved payout and approved refund policy; emits a narrow, attempt-specific policy decision.
- **Signer:** separate service/process, accepts only authenticated policy decisions, enforces network, token, recipient, refund and exact input/output constraints, and durably consumes an authorization before signing.
- **Verifier:** distinct key/service and independent destination-chain RPC observations; it creates evidence only after finality and exact recipient/token/amount validation.
- **Contract:** only the assigned Verifier can settle; it still trusts that verifier's attestation.

Use separate Operator, policy-service and Verifier signing authority. For higher assurance, use multisig or threshold approval for verifier/treasury authority, independent RPC providers with conflict escalation, and manual review when evidence disagrees. Off-chain verification is not trustless. No verifier attestation is submitted here.

## Persistence, idempotency and risks

Authorization IDs are deterministic from campaign, payout and attempt; each new attempt needs another ID. Hashes bind protected fields and are canonicalized by field name so database row mapping preserves the digest. PostgreSQL adapters are exposed by explicit production, development and test composition factories; each requires its selected database URL and refuses startup unless the local migration history is current. The service remains a library, so there is no worker/server composition to wire. The versioned migration and real integration tests are implemented, but application of migrations and execution of real PostgreSQL tests remain pending host-side verification. Issuer authenticity still requires a signer-controlled MAC/signature or authenticated service boundary, not this hash.

Remaining blockers: apply the versioned migration separately to development and test databases, then run and review the real PostgreSQL suite; wire the repository composition into a future worker/application when one exists; replace custom EIP-55 code with an audited package; configure and attest actual route support; coherent block-pinned reservation reads; real provider commitment semantics; verified quote signature procedure; secure signer; independent destination-chain verifier and finality policy; contract refund policy commitment or equivalent authenticated binding. No contract behavior, ABI, accounting, or lifecycle state changed in this milestone. See [PostgreSQL execution-service setup](postgres-execution-service.md) for explicit host-side commands and actual verification boundaries.

## Official references (checked 8 November 2026)

- [1Click published OpenAPI](https://1click.chaindefuser.com/docs/v0/openapi.yaml): quote fields, `EXACT_OUTPUT`, signature field, token catalog and status API.
- [NEAR Intents integration guide](https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api): integration lifecycle and quote API.
- [NEAR-maintained quote guide](https://github.com/near/agent-skills/blob/main/skills/near-intents/rules/api-quote.md): `refundTo`, quote types, output/fee fields. Supplementary; it conflicts with OpenAPI on some auth details.
- [NEAR Intents concepts guide](https://github.com/near/agent-skills/blob/main/skills/near-intents/references/concepts.md): quote → deposit → submit → status lifecycle.
- [NEAR Intents Terms of Service](https://near.com/terms): quote non-binding language, separate execution process, solver/provider dependencies, and non-guaranteed refunds (updated 7 October 2026).
- [NEAR account ID validation crate](https://docs.rs/near-account-id/latest/near_account_id/): authoritative account identifier syntax reference.
