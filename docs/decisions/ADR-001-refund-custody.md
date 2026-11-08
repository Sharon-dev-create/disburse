# ADR-001: Refund custody model

Status: Accepted

## Context

Disburse must keep refund destinations bound to an authorized payout before any provider interaction. Without a payout-bound policy, a provider or worker could redirect refunds to an unintended address.

## Decision

A refund policy is stored as a payout-specific object containing campaign, payout, source-network, source-token, and refund-address details. The policy is required to match the approved payout before an execution attempt can proceed.

## Consequences

- Provider responses cannot override the approved refund destination.
- A wrong payout cannot reuse another payout's refund policy.
- Refund handling remains a policy concern and does not imply real funds movement.
