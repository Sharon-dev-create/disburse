# ADR-002: Chain-aware recipient validation

Status: Accepted

## Context

A generic non-empty string is insufficient for cross-chain payouts. Recipient validation must understand the destination network and reject malformed addresses.

## Decision

The execution service validates recipients using a per-network rule set. NEAR addresses are checked for a bounded non-empty account identifier. EVM addresses are checked using the 0x-prefixed 40-byte convention and zero-address rejection.

## Consequences

- Unsupported networks fail closed.
- No destination network silently accepts a recipient that does not match its format.
- The recipient attached to a quote remains compared against the payout's recipient.
