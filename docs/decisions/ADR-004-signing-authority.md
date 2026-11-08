# ADR-004: Signing authority separation and authorization lifecycle

Status: Accepted for the provider-neutral foundation; production use blocked.

## Decision

Keep worker, policy evaluation, signer, and verifier as distinct trust roles. The current service only implements policy evaluation and a deterministic mock decision. Authorization records have Created, Approved, Consumed, Expired, and Revoked states and bind a complete policy fingerprint, payout attempt, quote, reservation observation, and TTL.

The mock repository demonstrates single-use atomic consumption only within one JavaScript process. Production requires a durable repository whose lifecycle transition is transactional and whose issuer is authenticated. A SHA-256 integrity hash is not a digital signature and cannot prove who approved the authorization.

## Consequences

- No private key, transaction signing, or submission is present.
- The authorization module is not wired to a live execution pipeline.
- A separate signer must verify an authenticated, narrowly scoped authorization and consume it durably before signing.
- Verifier credentials and destination-chain evidence collection must remain operationally separate from operator and signer authority.
