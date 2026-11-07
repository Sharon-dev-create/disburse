# Execution service threat model

## Trust boundaries and assets

The NEAR contract is the financial authority. It owns payout status and campaign reserved/spent
accounting. The execution service, PostgreSQL, event indexer, provider, and worker fleet are
operational components. The high-value assets are user funds controlled by external providers,
the ability to submit Operator/Admin calls, the ability to submit Verifier settlement/recovery
calls, and the integrity of payout-to-execution evidence mapping.

The current contract uses a **trusted-Verifier attestation model**, not trustless cross-chain
verification. A Verifier can authorize settlement or reservation release. The contract compares
the supplied normalized evidence to the payout but does not query external chains or prove a
receipt/content hash. A compromised Verifier can therefore make a harmful attestation even if the
service is correct.

## Threats and mitigations

| Threat | Impact | Foundation mitigation / required control |
|---|---|---|
| Malicious or compromised provider | False success, wrong recipient/token/amount, fabricated refs, replayed response | Provider responses are untrusted claims. Independent verifier checks chain, recipient, token identity, atomic output, success/finality, event identity and reference. Persist raw references and bounded hashes, not provider status as proof. Insufficient evidence goes ManualReview. |
| Compromised execution worker | Duplicate submission, altered destination, invalid contract calls | Contract reread and contract-side authorization remain authoritative; immutable job identity, request hashes, leases/fencing, allowlisted provider/destination policy, and independent verification. Separate signer capabilities and minimal worker access. |
| Compromised Verifier account | False settlement or unsafe reservation release | This is a contract-level trust assumption; service cannot cryptographically repair it. Use a separately controlled signer, strong custody/policy controls, narrow exposure, monitoring, and governance review. A future multisig/quorum would require a separate contract milestone. |
| Database modification | Fake job state, altered references or audit history | Never use DB as financial truth. Re-read payout and accounting from chain before/after writes. Use DB roles, backups, append-only attempt/reconciliation records, hashes, access audit, constraints, and anomaly reconciliation. A malicious DB can still cause denial of service or miscoordination. |
| Duplicate provider responses or event delivery | Duplicate job/attempt or incorrect transition | Unique source event and `(network, contract, payout)` constraints; compare-and-swap versioning; duplicate messages are idempotent reads. Conflicting duplicate payloads are quarantined. |
| Replay attack | One external execution or evidence settles multiple payouts | Stable provider-scoped execution identity, contract global replay indexes, unique DB constraints, and contract rereads. Never alter provider, chain, transaction, event, or evidence reference to bypass a collision. |
| Forged transaction reference | False match to a real execution or malicious provider lookup | References are correlation IDs until independently checked against destination-chain data. Use canonical chain/transaction/event values from verifier sources; do not trust a worker-supplied string alone. |
| Incorrect destination/token metadata | Funds sent to wrong address/token or false verification | Bind request to payout's immutable on-chain destination and expected output; provider quote cannot replace authorization. Maintain reviewed chain/token metadata out of band, version it, and fail closed on unknown/ambiguous metadata. Token decimals are not authoritative; compare identity and atomic units. |
| RPC/indexer inconsistency or reorg | Missed/duplicated events, stale payout state, false finality | The discovery foundation validates network/contract identity, persists block/tx/receipt/event identity, atomically commits each local cursor with the event, and rereads current contract views. A live source must supply finalized replay and document reorg policy. No production indexer is connected, so event completeness is not established. Contract views do not enumerate payouts. |
| Stale job lease | Old worker writes after another worker takes over | Lease expiry plus monotonic fencing token and state version in every persistence write. A stale worker may still have an in-flight provider call; it must not submit again and the new worker must reconcile the stable reference. |
| Concurrent execution attempts | Two workers pay the same payout | Atomic DB claim and unique current lease, stable provider key only when provider guarantee is verified, stable contract execution reference, and contract status gate. Database leases cannot retract a provider call already in flight. |
| Private-key compromise | Unauthorized Operator or Verifier calls and potentially irreversible execution | No private keys in plaintext, source, database, or logs. No key-management implementation is included. Future signer service must separate Operator/Admin and Verifier policies, enforce method allowlists, rate/amount limits, audit signatures, rotate/revoke access, and protect infrastructure. |
| Incorrect token-decimal assumptions | Wrong output comparison or economic amount | Use token identity plus atomic integer amount. Decimals are display metadata only unless a trusted metadata source is later designed and reviewed. |
| Settlement transaction response lost | Duplicate or mistaken local completion | Persist submission attempt before signing; query transaction and payout state; only mark Completed after chain reports `Succeeded`; keep unknown state in reconciliation/ManualReview. |

## Submission safety and exactly-once limits

A worker can crash after a provider accepts a request but before the response or provider
reference is written to PostgreSQL. On restart, local state alone cannot determine whether the
external payment happened. Exactly-once execution is not a property the coordinator can assume.
At-least-once processing is useful for discovery and database tasks, but resubmitting an external
payment at least once is unsafe unless the provider documents and enforces an idempotency key or
the service can conclusively reconcile the original request.

For every adapter, document whether submission idempotency, lookup by stable reference, finality,
and cancellation exist. If a submission outcome is unknown, query the original reference when
supported; otherwise stop and use ManualReview. A timeout, missing response, worker crash, or
provider outage is never evidence of non-settlement.

## Signer separation

The contract already distinguishes Operator/Admin actions from explicitly assigned Verifier
actions. Future deployment should use separate signer identities and capability-scoped clients:

- Operator/Admin identity: start execution and record operational lifecycle facts.
- Verifier identity: submit settlement and structured recovery attestations after independent
  evidence review.

The service must not silently reuse an Operator credential as a Verifier. Owner/admin status
does not grant implicit Verifier authority. This repository includes interfaces only, not signer
custody or signing code.

## Known limitations

- The contract trusts assigned Verifiers and does not independently verify external execution.
- The current contract has no paginated payout listing or payout count; discovery requires a
  separate replayable indexer/event source. Milestone 9 only supplies the provider interface and
  deterministic mock, not historical provider integration.
- The local discovery file repository is single-writer and not a multi-process database. A
  transactional database adapter and operational backup/restore procedure are required before
  running multiple indexers or execution workers.
- Provider idempotency and lookup semantics are unknown until a provider-specific review is done.
- No independent chain verifier, RPC integration, durable PostgreSQL repository, key management,
  or end-to-end testnet system is implemented.
- The in-memory repository is deterministic test support only; it is not crash-durable.
- A malicious provider, compromised worker, or compromised database can cause denial of service
  and operational confusion even though the contract remains the accounting authority.
