# ADR-005: Independent destination verification

Status: Accepted; implementation blocked pending a verifier integration.

## Decision

Keep provider status separate from proof of delivery. A payout may be settled only after an independently authorized Verifier supplies the contract's required evidence. Provider-reported success is an observation for reconciliation, not destination-chain proof.

Disburse does not currently implement destination-chain transaction verification, a finality policy, or a trustless cross-chain proof. The Rust contract continues to trust its authorized Verifier role. This milestone does not change the contract or submit attestations.

## Evidence required before settlement integration

- Independently query the destination chain and establish transaction inclusion/finality.
- Match the transaction to the exact destination token, recipient, and atomic output amount.
- Define chain reorganization and conflicting-RPC handling.
- Keep verifier signing authority separate from the operator and execution worker.
