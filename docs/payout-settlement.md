# Verified payout settlement

## Lifecycle and authority

Successful settlement supports one transition: `PendingVerification → Succeeded`. Only an
account explicitly assigned `UserRole::Verifier` may call `settle_payout`. Operator,
Administrator, and owner privileges do not imply verifier authority. The owner can assign the
Verifier role through the existing role-management methods, and a verifier cannot grant that
role to itself.

This is a trusted-verifier attestation model. The contract checks that the verifier's normalized
claims match the payout's authorized destination, output token, and expected atomic output
amount. It does not independently inspect an external chain, verify a transaction receipt, or
prove the content hash. Verifiers and the owner who assigns them are therefore part of the
security trust boundary.

## Evidence and replay protection

`SettlementEvidence` records the payout and verifier IDs, provider, destination chain, external
execution identifier, optional transaction/log/event identifier, output token and amount,
recipient, verification method and time, bounded evidence reference, and SHA-256 content hash.
Raw receipts and proof payloads are not stored. The event-facing provider, chain, execution,
event, recipient, token, and reference strings are length-limited by settlement validation; the
content hash is exactly 64 lowercase hexadecimal characters.

Execution uniqueness is global and keyed by provider, destination chain, execution identifier,
and optional event identifier. This lets separate events in one transaction be distinguished
while preventing the same execution event from settling another payout. Evidence references are
also globally unique. Failed validations write neither index. Accepted evidence and its indexes
are persisted alongside the payout and are available through both `get_payout` and
`get_campaign_payout`.

The verifier-provided chain, recipient, token, and output amount are compared with the payout's
original authorization. Token identity and atomic amount determine output equality. `TokenAmount`
also carries decimals, but those are caller-supplied and there is no trusted token metadata source
in this contract, so decimals are not used as authoritative financial metadata.

## Accounting, events, and pause behavior

Settlement checks the campaign accounting invariant `reserved + spent <= funded <= budget` and
uses checked arithmetic before writing state. It subtracts the payout's input amount from
`reserved`, adds that same input amount to `spent`, leaves `funded` and `budget` unchanged, marks
the payout `Succeeded`, persists the accepted evidence and uniqueness indexes, and emits a
NEP-297 `payout_settled` event. The expected output amount is not charged to campaign input-token
accounting.

Settlement is allowed while the global pause is active. Pausing blocks new operations, while
allowing a verifier to reconcile an external execution that is already pending verification.

## Failure recovery and reservation release

Only an explicitly assigned Verifier may recover a `Failed` or `ManualReview` payout. Failed
payout release requires its persisted typed failure evidence. ManualReview can be resolved as
confirmed execution, which returns it to `PendingVerification` while preserving the original
execution reference and reservation; the existing `settle_payout` remains the only path to
`Succeeded`. Alternatively, a verifier can attest definite non-settlement and release the
reservation, moving the payout to terminal `ReservationReleased`.

Resolution attestations include the payout and verifier IDs, outcome, method, timestamp, unique
evidence reference, SHA-256 content hash, bounded reason, and optional provider-scoped external
execution identity. They are stored as an append-only per-payout history under
`payout-resolution-records-v1` and returned by both payout views. The existing global settlement
reference and execution indexes are shared with recovery, preventing cross-path replay. A
confirmed execution claims its identity for that payout, allowing that same payout to settle
against the identity but preventing any other payout from using it. A non-settlement identity is
permanently unavailable to settlement. When supplied, an external identity's chain must match
the payout's authorized destination.

Reservation release validates the campaign token and accounting invariant, subtracts only from
`reserved` using checked arithmetic, and leaves `spent`, `funded`, and `budget` unchanged. It
does not transfer or refund tokens. Recovery remains available during global pause to reconcile
existing payouts. Failed and uncertain payouts remain reserved until a verifier makes a
structured, final non-settlement attestation; timeouts and missing provider responses alone are
not sufficient. This remains a trusted-verifier model: the contract records and checks the
attestation but cannot independently prove the external execution outcome.

A payout with any prior `ExecutionConfirmed` resolution cannot later be released as
non-settled, even if it is subsequently moved back into review or marked Failed. This prevents a
later resolution from contradicting an already-recorded execution confirmation.

This milestone adds no withdrawals, automatic retries, external transaction submission, or
trustless cross-chain proof verification.
