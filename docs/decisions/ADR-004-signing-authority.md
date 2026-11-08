# ADR-004: Signing authority separation and authorization lifecycle

Status: Accepted for the provider-neutral foundation; production use blocked.

## Decision

Keep worker, policy evaluation, signer, and verifier as distinct trust roles. The current service only implements policy evaluation and a deterministic mock decision. Authorization records have Created, Approved, Consumed, Expired, and Revoked states and bind a complete policy fingerprint, payout attempt, quote, reservation observation, and TTL.

The in-memory repository is a test double. A PostgreSQL adapter now uses conditional state updates, unique attempt identity, and an immutable authorization payload guard in the reference schema. Its tests use a deterministic SQL mock; there is no configured database, applied migration, or real PostgreSQL concurrency test. A SHA-256 integrity hash is not a digital signature and cannot prove who approved the authorization.

## Consequences

- No private key, transaction signing, or submission is present.
- The authorization module is not wired to a live execution pipeline.
- The PostgreSQL adapter must be connected through a reviewed migration and configured pool before it provides operational durability.
- A separate signer must verify an authenticated, narrowly scoped authorization and consume it durably before signing.
- Verifier credentials and destination-chain evidence collection must remain operationally separate from operator and signer authority.
