# ADR-003: Exact-output settlement

Status: Accepted; provider compatibility UNKNOWN / NOT ESTABLISHED.

## Context

The Rust contract requires the payout's exact expected output amount for settlement. The 1Click adapter in this repository requests only a dry quote. A dry quote does not reserve liquidity or prove a later fill.

## Decision

Preserve exact-output contract settlement. Require quote output to match the payout output and reject a quote whose minimum output is absent or below the exact amount. Do not lower the contract amount or treat a provider response as proof that the exact amount arrived.

## Compatibility and evidence

The [1Click API schema](https://1click.chaindefuser.com/docs/v0/openapi.yaml) defines an `EXACT_OUTPUT` quote parameter; this alone does not establish a committed fill. The [NEAR Intents terms](https://near.com/terms) describe quotes as non-binding and execution as a subsequent process with slippage. Therefore the present exact-output compatibility verdict is **UNKNOWN / NOT ESTABLISHED**.

Reconsider only after authoritative committed-order semantics, verifiable signature keys and field coverage, a binding output and input cap/expiry, and independent destination-chain evidence demonstrate the promised exact atomic output. No transaction or deposit is performed by this decision.
