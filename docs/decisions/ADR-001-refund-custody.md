# ADR-001: Payout-bound refund custody

Status: Accepted for service policy; production persistence is blocked.

## Decision

Require an approved refund policy specific to one campaign and payout, bound to source network/token, destination, version and canonical UTC approval timestamp. The 1Click quote adapter receives the approved immutable object and rejects payout/source mismatch or a provider echo that changes the destination. The test repository fingerprints all fields and refuses same-payout replacement.

The recommended eventual default is a payout-specific refund address chosen and approved by the payout authorizer before execution. No address is inferred from a worker or provider.

## Evidence and limits

The [1Click quote schema](https://1click.chaindefuser.com/docs/v0/openapi.yaml) requires `refundTo` and `refundType`. The current [NEAR Intents Terms](https://near.com/terms) say eligible refunds may be attempted, subject to fees, networks and technical/compliance limits; success is not guaranteed.

The contract does not persist a refund-policy fingerprint. The TypeScript in-memory repository is test-only. A durable repository and a reviewed on-chain commitment or authenticated policy-service decision are prerequisites for any deposit flow.
