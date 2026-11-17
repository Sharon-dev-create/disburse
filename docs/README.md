# Disburse documentation

## Current security review

The latest M5-D.2 review reports **FAIL**: the native reconciliation lease fix passed, but two legacy lease-write defects remain. Interactive mutations and controlled Testnet execution remain blocked.

- [Security review and open findings](milestone-5d2-independent-security-review.md)
- [Lease-fencing verification](milestone-5d2-lease-fencing-verification.md)
- [Regression results](milestone-5d2-regression-results.md)
- [Readiness matrix](milestone-5d2-testnet-readiness.md)
- [Structured review evidence](evidence/milestone-5/m5d2-independent-review.json)

## Setup and service architecture

- [Execution service setup](../execution-service/README.md)
- [Frontend setup](../frontend/README.md)
- [Sandbox test setup](../tests/sandbox/README.md)
- [Service architecture](execution-service-architecture.md)
- [Read-only API](execution-service-api.md)
- [PostgreSQL configuration and migrations](postgres-execution-service.md)

## Native payouts and reconciliation

These guides retain their original design and implementation context. The latest review above determines current findings and readiness.

- [Native payout architecture](native-payout-architecture.md)
- [Native payout threat model](native-payout-threat-model.md)
- [Native migration safety](native-payout-migration-safety.md)
- [Read-only reconciliation architecture](native-reconciliation-architecture.md)
- [Receipt evidence verification](native-receipt-evidence-verification.md)
- [Failure recovery boundary](native-failure-recovery.md)
- [Reconciliation persistence](native-reconciliation-postgres.md)

## Execution boundaries and discovery

- [Execution security](execution-security.md)
- [Execution service threat model](execution-service-threat-model.md)
- [Payout settlement](payout-settlement.md)
- [NEAR Intents integration](near-intents-integration.md)
- [Payout discovery](near-payout-discovery.md)
- [Event indexing](near-event-indexing.md)
- [Discovery integrity](near-discovery-integrity.md)
- [Event provider integration](near-event-provider-integration.md)
- [Architecture decisions](decisions/ADR-001-refund-custody.md)

## Historical evidence

Raw transaction, test and audit evidence remains unchanged under [evidence](evidence/). Historical narrative reports and superseded proposals were removed during documentation cleanup; their original versions remain in Git history. Evidence manifests describe their original snapshots and may reference those historical report paths. They are not current working-tree inventories.
