# M5-C — Promise chain and gas audit

**BLOCKED: no native execution promise graph exists.**
Reviewed revision `f37893e7a318e948e5e31b0634ee968247559c92`, 2026-11-16.
[Overall review](milestone-5c-independent-security-review.md).

## Actual transition trace

| Operation | Caller and previous state | Durable changes | Promise, deposit, gas, target, args, result |
| --- | --- | --- | --- |
| `create_native_payout` (`src/native.rs:150`) | Operator/Admin, unpaused; new request requires Active campaign and available funding | Existing reservation/index/counter plus immutable V1 mode/binding | None; nonpayable local state method; returns payout ID |
| `approve_native_execution` (`:237`) | Explicit independent Approver; native Reserved; matching next attempt, unique ID and bounded expiry | Approved authorization/attempt, next ID increment, native Approved; exact repeat no-op | None; no attached token-transfer deposit or callback |
| `revoke_native_authorization` (`:339`) | Approver or owner; unused matching Approved record | Auth Revoked; native Reserved; preserve reserved funds and old ID history | None; not a refund or token recovery |
| `begin_native_preflight` (`:371`) | Explicit Executor, different from approver; current Approved; Active/unpaused, binding, role and expiry valid | Auth Consumed; attempt/payout PreflightPending, executor/time/block persisted | **None**. Does not query token storage, schedule transfer or return Promise; emits lock event only |
| PreflightPending→TransferPending | No implemented entry/callback | No implemented mutation | No storage-result callback or token promise |
| TransferPending→Succeeded/AttemptFailed | No implemented callback | No native reserved→spent or failed outcome write | No private callback/result count/result inspection |
| Unknown→ManualReview/retry/release | No native recovery method | No implemented recovery | No recovery promise or receipt verifier |

Configured domain/token are `near:testnet` and
`usdc.tidepool-sandbox.testnet` (`src/state/native.rs:10–12`). Reservation source
and expected output are the same token/amount with decimals6. No promise ever uses
that binding as a target. No Operator custody intermediate exists because no token
movement exists. Do not report this as a correctly executed native custody flow.

`ft_on_transfer` (`src/lib.rs:1433`) is an **incoming funding receiver**, returning
`PromiseOrValue::Value`; it is not an outbound payout adapter or callback. Legacy
settlement changes ledger entries on Verifier attestation and rejects native mode.
There is no hidden send path in either method.

## Required ABI versus observed ABI

Expected future token action: target the bound Tidepool account, method
`ft_transfer`, arguments `receiver_id` equal to immutable recipient, decimal-string
`amount` equal to reserved input, bounded optional memo, exactly1 yoctoNEAR deposit
from Disburse. NEP-141 specifies that argument format and deposit; neither is
implemented as an outgoing action here. [NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md).

Fresh ABI has 49 functions (35 legacy,14 native); actual WASM export inspection
agrees. Native functions are approval/configuration/reservation/view/preflight-lock
methods only. No `execute_native_payout`, `on_native_storage_checked`,
`on_native_transfer_result`, native success or transfer submission is exported.
ABI alone cannot prove internal safety, so source and test effects were checked too.
[Static/ABI/WASM evidence](evidence/milestone-5/m5c-review/static-audit.json).

## Atomicity assessment

The current method writes its lock and returns without scheduling. A committed
B call therefore locks indefinitely; there is no TransferPending window to assess.
No promise-without-lock or duplicate-send vulnerability is demonstrated because
there is no outgoing promise. Absence of transfers is not evidence that a future
promise implementation will preserve at-most-once dispatch.

For a real C implementation, approval consumption/attempt lock and storage query
must be committed in one receipt; the verified storage callback must persist
TransferPending and schedule exactly one bound transfer plus final callback in
one receipt. A panic in that scheduling receipt must not commit only half the
operation. Tests using caught Rust panics cannot prove receipt rollback. Do not
add a separate publicly callable raw-send method after the B preflight lock.

## Gas allocation table

“N/A” means implementation absent, **not zero configured gas**.

| Component | Configured gas | Evidence | Risk |
| --- | --- | --- | --- |
| Execution entry point | N/A; only B metadata lock | `src/native.rs:371–416`; no minimum prepaid/remaining-gas guard | No execution gas budget or margin can be certified |
| Recipient storage call and callback | N/A | No promise construction or result callback | Missing registration checks; no nested gas feasibility |
| NEP-141 transfer | N/A | No outgoing `ft_transfer`, static gas or deposit allocation | Token receipt behavior/limits untested |
| Settlement callback | N/A | No callback or result inspection | Storage/event gas and OOG recovery unmeasured |
| Recovery logic | N/A | No native recovery method | No gas/authority/evidence behavior to audit |

M5-A's 150/10/100/30/30 Tgas calibration example is design-only and is **not** a
configured C budget. Do not add it as a simple sum: child budgets are included in
parent callback allocations. No actual C graph exists from which to calculate
required total gas, per-receipt burn or fit against current protocol limits.
The 126 unit tests have mock gas contexts, not measured native transfer receipts.
No insufficient-gas transfer/callback scenario was run; there is nothing to send.

Required future evidence: minimum initiating prepaid gas and remaining-gas checks;
exact storage-call, intermediate callback (including descendant budget), token
transfer and final callback budgets; measured worst-case host/storage/event burn;
near-boundary failure behavior; available contract NEAR after storage backing and
outgoing1-yocto deposit; fresh applicable network limit. Do not certify gas based
on cached activation gas, a unit pass, or the unrelated local WASM build.

## Review conclusion

M5C-01/02/03 block completion. Implement C separately, measure the real promise
graph and re-review. No transaction command, executable manifest or gas cap for
live use is proposed by this audit.
