# M5-C — Callback, accounting and recovery review

**BLOCKED: callbacks and native settlement are absent.**
Revision `f37893e7a318e948e5e31b0634ee968247559c92`, 2026-11-16.
[Overall review](milestone-5c-independent-security-review.md).

## Callback authentication and binding

No native callback is implemented or exported. There is no native `#[private]`,
predecessor=current callback check, promise result count/result inspection,
callback-attempt binding or delivered-marker accounting. The absence is not an
exposed insecure callback; it is missing functionality that cannot pass an
execution audit. B's approval/preflight identity checks do not substitute for
callback authentication. NEAR's private-callback guidance requires an immediate
caller boundary; signer identity or supplied callback arguments are insufficient.
[Official callback security](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks).

| Required adversarial scenario | Current evidence / conclusion |
| --- | --- |
| External account calls native callback | No endpoint; not exercised |
| Operator calls native callback | No endpoint; not exercised |
| Owner calls native callback | No endpoint; not exercised |
| Incorrect payout ID | B preflight rejects mismatches; no callback test |
| Stale attempt ID | B record-corruption/identity checks only; no callback test |
| Duplicate callback | No callback; cannot demonstrate once-only callback accounting |
| Callback after terminal state | Test seeds future states directly; no real terminal callback |
| Different recipient | B parent-record tampering rejects; no callback binding test |
| Different token | Same B limitation |
| Different amount | Same B limitation |
| Unexpected/multiple/missing promise results | No handler or injection tests; unverified |

Future callback must authenticate current contract predecessor, require one expected
promise result, match payout/auth/attempt and durable token/recipient/amount binding,
and apply accounting at most once. After dispatch, pause/expiry/token delisting
must not prevent safe completion. No public administrative success assertion may
replace this. Never trust a callback argument as proof that the token call ran.

## Accounting actually verified

Common reservation helper (`src/lib.rs:1481`) uses checked addition/subtraction,
funded<=budget and reserved+spent<=funded. Derived available is funded-reserved-spent
(`:1302`), preserving available+reserved+spent=funded and spent<=funded.
`validated_native_payout` (`src/native.rs:543`) binds amounts/token to the parent
and requires legacy Reserved with enough aggregate campaign reserve. Approval,
revocation and B preflight mutate sidecars only. Corrupt/cross-campaign amounts and
integer boundaries reject without changing stored bytes.

| Hypothetical 100000 payout | Available | Reserved | Spent | Contract USDC |
| --- | ---: | ---: | ---: | --- |
| After reservation, tested locally | 900000 | 100000 | 0 | No real balance queried/moved |
| B approval/preflight, tested locally | 900000 | 100000 | 0 | No transfer |
| Required future native success, **not implemented/tested** | 900000 | 0 | 100000 | Expected900000 only if isolated initial balance1000000 and no unrelated movements |

The old `settle_payout` accounting code is not evidence of native completion:
it rejects native mode first and trusts legacy Verifier attestation. No current
native method can book spent once or twice. This prevents fake settlement today,
but does not prove correct settlement after actual delivery.

## Transfer/callback outcome cases A–F

NEAR cross-contract calls and callbacks execute independently: failure of a later
callback does not undo an earlier committed token receipt. This is the protocol
basis for keeping an unresolved attempt locked, not an observed C test result.
[Official cross-contract semantics](https://docs.near.org/smart-contracts/anatomy/crosscontract).
All table outcomes below are **requirements for the future approved design**, not
claims that absent C code produced them. Exact token semantics still need review.

| Case | Expected future receipt/state/accounting | Retry eligibility | Required evidence | Current coverage |
| --- | --- | --- | --- | --- |
| A: token success, callback success | Trusted standard token commits delivery; matching private callback applies Succeeded, reserved100000→0 and spent0→100000 once | Never retry | Finalized exact token action/outcome, log where supported, callback and native/accounting records; balances corroborate | No native transfer or callback test |
| B: token definitively fails, callback succeeds | Token failure leaves no committed delivery under reviewed atomic token semantics; mark AttemptFailed, retain reserved100000/spent0 | Only a new independently approved attempt after verified final non-delivery; no B retry API | Final token receipt error or definitive no-dispatch proof, correct attempt and custody reconciliation | Legacy attestation failure tests only; no native failure receipt |
| C: token success, callback panics | Token may remain delivered; callback writes roll back; TransferPending/equivalent lock and reserve remain | No resend | Final token success plus failed callback receipt; independent bookkeeping resolution, not a token resend | Not tested |
| D: token success, callback OOG | Same delivery/ledger divergence; lock and reservation must survive | No resend | Token and callback gas/finality evidence; exactly-once recovery attestation/proof | Not tested or measured |
| E: outcome unknown | Preserve unresolved lock/ManualReview and reserve; no spent assertion | No retry/release on timeout or missing evidence | Canonical finalized receipt graph from independent RPCs, all immutable binding fields | Only directly seeded future-state rejection tests; no RPC uncertainty test |
| F: callback succeeded, service crashed | On-chain terminal attempt/accounting remains authoritative despite missing local acknowledgement | No replay from restarted service | Re-read final attempt/status and receipt graph; reconcile DB only in an authorized future service stage | No native callback/worker restart integration test |

Normal failed standard `ft_transfer` is not an Intents deposit/refund flow. Do not
invent a USDC refund transfer or let failed-callback status stand in for failed-token
status. A successful token promise is meaningful only for a trusted implementation;
unit-return decoding, hash alone, pre-delivery event or balance delta alone does
not establish delivery attributable to this payout. No fresh Tidepool source/code
semantics review or live recipient proof was performed here; both remain gates.

## Duplicate/replay analysis

Current B guards reject repeated/altered approval, stale/duplicate attempts, expiry,
revocation, wrong identity and a second consumed preflight. IDs persist in sidecars;
PostgreSQL locks are not involved. Counter overflow rejects before writes. A role
or pause change does not reset consumed state. Native ManualReview/failure/success
variants seeded in tests cannot acquire new B approvals or restart.

Those are meaningful metadata safeguards. They cannot demonstrate concurrent
transfer scheduling safety because there is no first transfer. Likewise, missing
callback records cannot be tested as completed native attempts. Existing sequential
calls are not concurrent receipt execution, and a backend/RPC restart was not run.
A future attempt may be resubmitted only after authoritative state confirms that
no scheduling receipt committed; timeout alone cannot justify a new identity.

All eight legacy mutation guards are reverified at `src/lib.rs:338,381,416,470,513,
548,598,629`, plus private release at1193. `assert_legacy_payout` (`src/native.rs:459`)
checks marker OR record, rejecting incomplete sidecars. Campaign cancellation
(`src/lib.rs:938`) retains reserve. No new C administrative override/reassignment
exists. Native binding has no public recipient/amount edit path. Legacy paths still
pass their documented regression tests. Root code replacement remains outside
these application guards; older-WASM rollback can reintroduce bypasses.

## Required remediation

Implement the missing graph/callbacks in a separate local stage, retain all B
mode/identity guards, then add real receipts for every case above. Normal private
callback outcome handling belongs in C; exceptional evidence-based recovery is
M5-D and cannot be a premature owner/Verifier success/reset method. If outcomes
cannot be established, keep reservations locked. Nothing was fixed in this review.
