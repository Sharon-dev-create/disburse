# ADR-005: Independent destination verification

Status: Accepted

## Context

Provider success claims are not reliable evidence of real asset delivery. A payout should not be considered settled because a provider reported success.

## Decision

The execution service keeps provider status and destination-chain verification separate. Provider-reported completion is treated as untrusted until independently verified on-chain or via authoritative transaction evidence.

## Consequences

- Verification remains a separate service boundary.
- Settlement decisions depend on independent evidence.
- Provider data is useful for routing and operator diagnostics, not proof of settlement.
