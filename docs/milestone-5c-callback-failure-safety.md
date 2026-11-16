# M5-C — Callback and failure safety

Base `fdd8b48acaa1ad60417ad628b08a7783ede9aba6`, local validation2026-11-16.
**PASS for tested local failure-safety properties; no live execution approval.**
[Implementation](milestone-5c-native-transfer-implementation.md).

## Durable lock and exactly-once accounting

`begin_native_preflight` consumes one independently approved authorization and
preallocates one outcome slot before scheduling storage verification. The private
storage callback validates current payout/auth/attempt/binding plus one result,
rechecks dispatch policy, then writes TransferPending and schedules exactly one
bound ft_transfer+callback in the same receipt. There is no public raw transfer,
retry/reset/release or administrative success method.

The final callback authenticates both the SDK private wrapper and immediate self-
predecessor; validates current TransferPending, Consumed authorization, attempt,
parent token/recipient/amount/campaign and memo/evidence identity; requires one
runtime result. Success is accepted only as a bounded expected unit response from
the reviewed token call. It reloads current campaign accounting and uses checked
reserved subtraction/spent addition, updating statuses/evidence/events atomically.
A second callback sees terminal state and rejects. A same-campaign unit test also
repeats a settled callback while another payout remains reserved, ensuring that
it cannot consume the other payout's allocation.

After dispatch, pause, approval expiry, role changes or token delisting cannot
prevent safe completion of the already scheduled call. These policies are checked
before dispatch, not used as a reason to forget delivered funds. Campaign
cancellation changes lifecycle only; it cannot release a native reservation.

## Tested failure outcomes

| Situation | Actual local result | Accounting / resend |
| --- | --- | --- |
| Missing registration | Query returnsNone; AttemptFailed/RecipientUnregistered; no ft_transfer | Reserve retained, spent0; no retry/release |
| Token rejects or lacks balance | Token receipt fails; callback records TransferReceiptFailed | No spent; reserve retained; no retry/release |
| Storage result invalid/count unexpected | ManualReview, no dispatch | Reserve retained; no retry/release |
| Token delivered but result nonstandard | Actual token balance changes; final callback ManualReview/UnexpectedTransferResult | Reserve retained, spent0; no resend |
| Scheduling callback panics after pending writes, before promise | Actual VM rolls back storage callback; PreflightPending/AwaitingStorage survives; no token movement | Reserve retained; no second preflight |
| Token succeeds, callback panics **after settlement writes/events** | Actual callback receipt fails and rolls back; token delivery remains; TransferPending/TransferScheduled survives | Reserve100000/spent0; rejected resend, including after compatible code restoration |
| Token succeeds, callback has1 gas | Actual `Exceeded the prepaid gas.` receipt; delivery remains; TransferPending survives | Same durable lock and no resend |
| Local incompatible upgrade during execution | Token block1153, code upgrade1154, missing callback1156; delivery remains | TransferPending retained through production restoration; no resend |
| Owner pauses before callback | Actual owner pause block879 precedes callback880; successful settlement despite pause | Reserved→spent once; no fresh initiation while paused |
| Response discarded / new client | Fresh client re-reads durable state; repeated execution rejects | No new transfer; modeled restart, not a DB/worker restart test |

The panic/OOG/scheduling/renamed-callback variants are built from **source copies in
/tmp**, with manifest hashes and explicit patches. Production has no fault switch,
manual outcome override or configurable callback gas. These are real receipt
execution tests of injected failures, not assertions that ordinary production50-
Tgas callbacks fail. Standard successful cases use the exact final production WASM.

## What a failed callback can and cannot record

A contract cannot reliably report its own panic/OOG/absent-method failure. No C
code pretends to do so. A failed receipt rolls back its writes; the earlier
TransferPending lock remains. Native pending is therefore an unresolved business
state even when the actual receipt graph has finished with a callback error.
It must not become executable again on timeout, missing event, absent DB job or
worker restart.

The outcome sidecar records only available runtime metadata: identities, binding,
phase/error classification, result count, bounded captured data hash/length and
observed block/time. It does not claim transaction/receipt hashes or independent
finalized delivery proof. TransferScheduled clears the prior storage-result hash;
zero hash denotes no captured bytes, whereas successful empty bytes have the
actual SHA256 of empty data. Native evidence remains separately accessible from
legacy trusted-Verifier settlement records.

Failed-receipt logs may contain events emitted before a later panic. The after-
settlement panic test exercises this. **Ignore settlement logs from failed
receipts**; verify canonical finalized outcomes and stored state. An outer success
also does not prove delivery: a handler can successfully record a failed token
receipt and return normally with AttemptFailed.

## Trusted token boundary

A failed promise identifies a failed promise, not cryptographic proof that an
arbitrary token never changed balances. Standard atomic ft_transfer is the required
trusted behavior. Returning nested promises, malicious upgrades, fees or no-op
success can invalidate simplistic economic assumptions. C never auto-retries or
releases even AttemptFailed, so future M5-D must independently inspect canonical
evidence before any recovery.

The test token's controlled **pause hook** deliberately returns an owner-proxy
promise after debiting tokens, solely to force pause/upgrade ordering. Its success
is checked; it is not used as proof of failed-token atomicity. Normal rejection and
insufficient-balance tests use standard mode. A separate bad-return hook proves
that delivery with unrecognized data stays locked. Actual Tidepool implementation,
code governance and live recipient proof remain deployment gates.

## External reconciliation requirements, not implemented recovery

An external verifier should find the original finalized transaction, traverse
storage/transfer/callback receipts, confirm actual token executor/predecessor,
method,1-yocto deposit, fixed recipient/amount/memo, then link native payout,
authorization and attempt. Compare independent RPC observations, committed token
logs, source/recipient balances with unrelated movements accounted for, outcome
sidecar and campaign accounting. Hash alone, event alone, provider response or a
balance increase alone cannot attribute delivery.

Delivered-but-unbooked funds require bookkeeping reconciliation, never another
transfer. Definitive non-delivery must be proven before separately approved retry
or release. Root code replacement can bypass application protections, so arbitrary
older-WASM rollback or state restoration is not a safe recovery plan. Old consumed
M5-B orphan preflight remains frozen; C does not silently reinterpret it as unsent.
M5-D must be separately designed, reviewed and authorized.

A distinct rent/disk failure was not injected. Callback writes are preallocated
and bounded; generic VM rollback is demonstrated after writes and under OOG.
Resource exhaustion or incompatible root upgrades can still stop liveness. The
safety response is persistent reservation/attempt locks, not promised self-repair.

## Repository revision note

During this session HEAD advanced externally to `d6f444ae5f6d1843206421f138908db7fca4db30`, capturing in-progress files. No commit/push commands were issued by this session; that commit was preserved. Subsequent report/evidence edits remain local.
