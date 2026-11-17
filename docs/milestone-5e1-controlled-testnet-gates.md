# M5-E.1 controlled Testnet experiment gates

**NOT READY.** Reviewed 2026-11-17 at `b7e466df0c5a18bf15b38b0fa79ff3dc317958f8`. Local/read-only audit only. [Structured evidence](evidence/milestone-5/m5e1-independent-review/results.json). Separate adversarial pass by the same assistant, not third-party certification.

This decision concerns readiness to propose a first isolated compatibility experiment. Actual Tidepool transfer compatibility remains unknown and is the experiment's objective; prior proof of a successful transfer is not a prerequisite for approving the experiment.

## Required before separate approval

1. Close M5E1-01 startup redaction and M5E1-02 decoded inspection depth gap in a separately authorized local patch, then independently rerun focused tests and relevant regressions. Preserve reviewed source/artifact identity.
2. Pin a reviewed candidate WASM/revision, deployed target and current code; obtain separate upgrade/deployment authorization and migration/in-flight callback review. Current live deployment is the old hash; no upgrade is implicitly authorized.
3. Specify an isolated campaign and separate accounts. Do not reuse or mutate protected Campaign 0 without separate approval. Record balances, budgets/reserve/spent, token allowlist, pause state and native limits at fresh finalized state.
4. Confirm a controlled recipient, authenticated ownership evidence, exact immutable recipient/token/amount and recipient registration. No owner/Operator/contract substitution. Resolve payout/attempt/freshness binding before treating preflight evidence as an operational prerequisite.
5. Pin fresh Tidepool code/metadata/storage and usable RPC endpoints. Live candidate runtime Node connectivity remains unverified here because Node public probes failed; use an explicitly reviewed working runtime transport/environment. Do not silently switch networks or enable workers to test connectivity.
6. Approve smallest practical amount (proposal may start at one atomic unit), total exposure/gas/storage spending cap, one-attempt/no-resend policy and transaction manifest. No amount is approved by this report.
7. Verify authorized owner/Operator/Approver/Executor signers and separation without exporting keys. Approvals bind exact target/attempt and expiry. This review did not unlock or verify custody.
8. Define exact supervised transaction or worker configuration. Existing host is read-only; dormant policy is not a dispatch control. Any worker/signer enablement requires separately reviewed enforcement and approval. A supervised explicit transaction experiment need not add a production scheduler.
9. Have authenticated evidence access, named monitor and emergency-stop authority, pre/post balances/accounting, canonical receipts/private-callback capture, timeout/unknown escalation and approved emergency action. Minimal manual supervision can satisfy an isolated experiment if explicit; production telemetry rollout is a separate gate.
10. Unknown or delivered-with-missing-callback outcome stops dispatch, preserves TransferPending/ManualReview and reserve, captures both delivery and callback evidence and prohibits resend, ledger edits, forced release or fabricated settlement. Authenticated recovery remains unresolved. Accept the bounded possibility of permanently locked test funds before approval.
11. Obtain explicit transaction-by-transaction approval for deployment, configuration, registration, campaign/native reservation/authorization and actual transfer dispatch. This report approves none of them.

## Experiment success evidence

Measure exact ft_transfer action (token, receiver, U128 amount, memo, one yoctoNEAR, gas), token receipt/code identity, delivered recipient balance, contract custody delta, current native attempt and private callback outcome; successful accounting reserved−amount/spent+amount exactly once. Capture complete finalized receipt graphs and independent trusted provider corroboration where available. A failure receipt must be distinguished from an unknown transfer result or callback failure after successful delivery. Do not use local sandbox semantics to predeclare Tidepool behavior.

## Next milestone

Small local-only operational audit remediation and focused independent recheck, followed by a concrete isolated compatibility experiment proposal with unresolved fields filled by verified evidence. Stop here; no implementation, deployment or blockchain mutation is authorized by this review.
