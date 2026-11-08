# ADR-004: Signing authority separation

Status: Accepted

## Context

The execution worker should never be responsible for signing or spending authority. Operational code and signing policy must be separated.

## Decision

The worker can request and validate a quote, but policy evaluation and signing authorization are represented as separate interfaces. A worker cannot self-authorize a payout or substitute its own refund policy.

## Consequences

- The signer receives only policy-approved requests.
- Spending limits and route policies are enforced before any signing workflow is created.
- No live signing or private key access is introduced in this milestone.
