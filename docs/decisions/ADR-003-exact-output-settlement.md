# ADR-003: Exact-output compatibility

Status: Accepted

## Context

Disburse has an exact-output settlement requirement, and a dry quote is not a legally authoritative settlement or completion event.

## Decision

The execution service requires exact output matching and budget checks before quote acceptance. Provider quote data is used only as route feasibility evidence. It does not modify payout accounting or authorize settlement.

## Consequences

- Exact output mismatch is rejected.
- Provider claims are not treated as destination-chain verification.
- Actual settlement remains a separate, contract-authoritative flow.
