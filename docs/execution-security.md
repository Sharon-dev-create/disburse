# Execution security architecture

This document summarizes the security controls added at the provider-adapter boundary for the Disburse execution service.

## Refund custody

Disburse binds refund destination data to the payout and stores it as an immutable policy object. The policy is validated before execution and cannot be silently replaced by provider response data. Refunds remain a policy-level requirement, not a signed transaction claim. The execution worker never invents or rewrites refund addresses.

## Recipient validation

Destination recipients are validated by destination network identity. NEAR recipients are checked for a non-empty bounded account identifier; EVM recipient validation requires a 0x-prefixed 40-byte address and rejects zero-address and malformed values. The current adapter layer is intentionally limited to supported networks and fails closed.

## Exact-output settlement

The execution service retains the exact-output rule that the contract enforces: a quote must match the payout's expected output atomically, and a future execution request must not widen the authorized input budget. Provider quotes are evidence of route feasibility only and are never treated as settlement.

## Provider signature trust

The current NEAR Intents 1Click adapter retains a provider signature value in metadata, but it does not verify a cryptographic signature chain. The adapter treats the provider response as API data, not an independently authenticated commitment. Real settlement still requires destination-chain verification.

## Signing authority separation

The execution worker can validate and request a quote, but it cannot authorize spending. Policy evaluation and signing authorization are separated from the runtime worker so that a worker cannot self-authorize funds or replace an approved payout recipient or refund policy.

## Remaining risks

- No live signing implementation
- No production signer integration
- No destination-chain transaction verification
- No provider-funded refund execution
- No contract or ABI changes in this milestone
