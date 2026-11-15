# Isolated account signing proof and proposed USDC recovery

Date: 2026-11-15 (Africa/Douala).

**PASS — recovery completed and independently verified.**

Execution evidence and balance reconciliation are recorded at the end of this report.
Earlier signing-proof observations below retain their original block context.

## Signer identity and independent proof

- NEAR CLI: `near-cli-rs 0.31.1`.
- Local public account mappings include `disburse-test-contract.testnet` and
  `disburse-topg.testnet` as distinct accounts. The isolated account has no legacy
  credential file in the inspected `~/.near-credentials/testnet` directory.
- OS Secret Service item attributes identify service
  `near-testnet-disburse-test-contract.testnet`, application `rust-keyring`, and
  username `disburse-test-contract.testnet:ed25519:9hWszNNZawwV2VngQJkKpwCCGTka3LvM1qeN2oZKPWRe`.
  Only mapping attributes were inspected; no secret was retrieved for display,
  export, copying, or use in script arguments. The NEAR CLI used its supported
  secure keychain signing mechanism internally.
- Finalized Testnet access-key query at block **277757165** reports exactly one
  key, `ed25519:9hWszNNZawwV2VngQJkKpwCCGTka3LvM1qeN2oZKPWRe`, permission
  **FullAccess**, nonce `277523822000001`.
- `near message sign-nep413 utf8 ... nonce ... recipient
  disburse-local-isolated-key-audit sign-as disburse-test-contract.testnet
  sign-with-keychain network-config testnet` completed successfully using a
  fresh random 32-byte nonce. Its message explicitly authorizes no transaction,
  transfer, login, contract change or permission change.
- Independently reconstructed the NEP-413 Borsh payload (u32 LE tag 2^31+413,
  length-prefixed message, 32-byte nonce, length-prefixed recipient, absent
  callback URL). Node `crypto.verify` validated the Ed25519 signature over its
  SHA-256 hash. Signature verification=true and on-chain FullAccess key match=true.
- Post-proof finalized key query at block **277757292** has the same key and
  nonce. No transaction was signed/submitted and the proof consumed no nonce.

This proves control of **the isolated account itself**, not merely its
application-level owner. `get_owner` still reports `disburse-topg.testnet`;
that owner identity is not the signer in this proof or the recovery plan.

[Public proof, signature, mapping attributes and finalized RPC evidence](evidence/milestone-2/isolated-signing-access.json).
No off-chain proof has an on-chain transaction hash.

## Rechecked state

RPC `https://rpc.testnet.fastnear.com` reports `chain_id=testnet`.
Finalized reads span blocks 277757164–277757292; exact hashes are in the evidence.

| Check | Result |
| --- | --- |
| Isolated deployed code | `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`, unchanged from audit |
| Isolated NEAR amount | 9.9978065812158306 NEAR; 299422 storage bytes; locked=0 |
| Owner / pause | `disburse-topg.testnet` / false |
| Campaign count | 0 |
| Full contract state | Only STATE; Borsh-decoded campaign and payout counters both 0; no collection entries |
| Payout 0 | null |
| Campaign 0 funding / accounting | null / null |
| Accepted USDC | false |
| Token | `usdc.tidepool-sandbox.testnet`, USDC, 6 decimals, no-value Testnet metadata |
| Isolated token balance | `100000000` atomic = 100 test USDC |
| Operator token balance | `0` atomic |
| Isolated and Operator token storage | Both registered, total=`1250000000000000000000`, available=`0` |

The token balance is unallocated. It is excluded from campaign accounting;
there is no campaign record to which it could be assigned. No new campaign,
funding, reservation or configuration call was performed. The already-registered
Operator does not require a new storage deposit.

## Approved recovery manifest — executed once

One FunctionCall action in one transaction; **no upgrade or Disburse method call**.

| Field | Proposed value |
| --- | --- |
| Network | NEAR Testnet only; verify live chain ID before execution |
| Transaction signer | `disburse-test-contract.testnet` |
| Secure signer | Existing OS keychain, matched public key `ed25519:9hWszNNZawwV2VngQJkKpwCCGTka3LvM1qeN2oZKPWRe` |
| Transaction receiver / target | `usdc.tidepool-sandbox.testnet` |
| Method | `ft_transfer` |
| Token receiver | `disburse-op-b966e36d.testnet` |
| Amount | `"100000000"` atomic units (100 test USDC) |
| Memo | `Disburse isolated Testnet unallocated USDC recovery` |
| Attached deposit | Exactly **1 yoctoNEAR**, paid by isolated account |
| Prepaid gas | **30 Tgas** (30000000000000 gas), proposed conservative limit, not measured burn |
| Nonce / recent block hash | Obtain fresh at approved execution time; do not reuse proof/audit block values |

Exact method arguments:

```json
{"receiver_id":"disburse-op-b966e36d.testnet","amount":"100000000","memo":"Disburse isolated Testnet unallocated USDC recovery"}
```

At observed gas price `100000000` yoctoNEAR/gas, 30 Tgas corresponds to 0.003
NEAR of prepaid execution gas, plus protocol action/receipt costs and the
1-yocto deposit. This is not a guaranteed total fee; recheck gas price and account
spendable balance. Existing account balance has about 7.00358658 NEAR above
previously verified storage backing. No extra NEAR funding is proposed.

Standard `ft_transfer` parameters and deposit semantics were reviewed in the
[NEAR FT documentation](https://docs.near.org/primitives/ft/standard). CLI argument
syntax was checked with `--help` only; no recovery transaction was constructed,
signed, saved or submitted. The 30 Tgas limit remains a proposed execution cap.

## Preconditions and exact success checks

Immediately before approved execution, verify the network, expected public key
and FullAccess permission, source/target/destination identities, sufficient NEAR,
USDC metadata and both registrations. Take new source/destination FT balances,
Disburse full state, code hash and campaign/payout views. Require the source
balance still exactly `100000000`, destination still `0`, zero campaign/payout
counters, no campaign liabilities, and unchanged state/code from this evidence.
Stop for review if any condition differs; do not adapt the amount or destination
silently. No operation may target `disburse-topg.testnet`.

After the single approved transfer:

1. Record its actual hash and signer. Query Testnet `tx` with final execution
   evidence; require successful transaction and all execution receipts.
2. Query token balances at finalized blocks after the transaction: source must
   be `0`, Operator must be `100000000`; exact deltas −100000000 / +100000000.
3. Confirm both token registrations remain, and the isolated contract's full
   state values and code hash are unchanged. Campaign count and payout counter
   remain zero; payout 0, funding 0 and accounting 0 remain null. No allowlist,
   role, owner or pause change is authorized. Account NEAR/nonce changes for the
   approved transfer are expected and are distinct from application state.
4. Add only the real verified transaction/explorer evidence to the report.
   Stop on failed or ambiguous verification and investigate the recorded hash;
   never blindly retry a possibly successful transfer.

The direct account-key action bypasses Disburse role/pause checks. Its safety here
rests on the verified empty campaign state and unallocated balance; it is not a
safe generic sweep of campaign custody. No rescue code or permissions change is
needed. Recovered wallet-held USDC could later fund campaigns through a separately
approved `ft_transfer_call`; that is outside this recovery approval.

**Approved recovery transactions: one. Signed recovery transactions: one.
Submitted recovery transactions: one. Finalized successful recovery transactions: one.
No further recovery submission or configuration action is authorized.**

## Final reverification and execution — 2026-11-15

**Verdict: PASS — recovery completed and independently verified.** The latest
attached instruction explicitly approved one transaction subject to fresh checks;
its exact memo superseded the earlier proposed wording.

### Preflight

Fresh finalized reads (initial blocks 277757634–277757640, plus the immediately
pre-submission snapshots in the evidence) verified Testnet, matching token code
identity/6 decimals, source balance 100000000, Operator balance 0, existing
Operator registration total 1250000000000000000000, unchanged isolated code and
owner, and full state identical to the reviewed empty baseline. Source-aware
Borsh decoding plus full key inventory established zero campaigns, zero payouts
and no campaign, payout, reservation or funding liabilities. Explicit funding,
accounting and payout views were null.

The live FullAccess key matched the existing OS-keychain service/account mapping
and independently verified off-chain proof. The actual transaction signature was
also verified independently against that key before broadcast. Signer was the
isolated account, never its application owner. No private key was read, copied,
exported, imported or included in output.

CLI 0.31.1 syntax was checked with --help. Its configured `testnet` endpoint
`https://archival-rpc.testnet.fastnear.com/` was independently checked for
chain_id=testnet and matching genesis with the public verification RPC.
Spendable source NEAR above storage backing was 7.0035865812158306 NEAR; adequate
for the 30-Tgas cap and one-yocto deposit. No top-up or storage transaction occurred.

### Signing and single submission

A Borsh unsigned transaction was constructed and inspected using
`near transaction print-transaction unsigned` before signing. It contained one
FunctionCall and only the approved fields below. The CLI offline signing attempt
stopped with an input-not-TTY error before producing a signed file; nothing was
submitted. Normal online keychain mode then signed and saved this one transaction.
The CLI refreshed its recent block hash; byte comparison confirmed that every
other transaction field, including all action bytes and nonce, was unchanged.
The fresh block hash was verified on Testnet and the Ed25519 transaction signature
was independently validated before submission. No extra action was added.

The single signed transaction was submitted once through RPC `send_tx` with
wait_until=FINAL; a local exclusive submission marker prevented a second attempt.
A separate read-only `tx` query independently returned FINAL and SuccessValue.
There was no submission failure, uncertainty or retry.

| Field | Actual value |
| --- | --- |
| Hash | `J9LqwvJZg5HwmfPMsXHMQNPo7sq2nvBG5hHZPosnkFWD` |
| Signer | `disburse-test-contract.testnet` |
| Public key | `ed25519:9hWszNNZawwV2VngQJkKpwCCGTka3LvM1qeN2oZKPWRe` |
| Nonce | 277523822000002 |
| Recent block hash | `FV2PjnEoyUmmAwdnzAYPRoam4m9dGXXiMApMRYn6mGMv` |
| Target | `usdc.tidepool-sandbox.testnet` |
| Method / action count | `ft_transfer` / 1 |
| Recipient | `disburse-op-b966e36d.testnet` |
| Amount | `100000000` atomic / 100 test USDC |
| Memo | `Disburse isolated Testnet unallocated USDC recovery` |
| Attached deposit | 1 yoctoNEAR |
| Prepaid gas | 30000000000000 gas / 30 Tgas |

[Verified transaction on Testnet Nearblocks](https://testnet.nearblocks.io/txns/J9LqwvJZg5HwmfPMsXHMQNPo7sq2nvBG5hHZPosnkFWD).

### Receipt outcomes and gas

| Outcome | Executor | Status | Gas burnt |
| --- | --- | --- | ---: |
| Transaction | Isolated account | SuccessReceiptId | 314687536385 |
| `CZ2ZtckFsZvvvNE2eT2WiaWx6f4V9u2GKFAEv8QEc1qf` | USDC token contract | SuccessValue | 1858617121894 |
| `H9qNiEBAatyKqzhzNwmiuF33h4duqYkMKn3LqFZjwCoh` | Isolated account, refund receipt | SuccessValue | 223182562500 |

Total gas burnt across transaction and receipts: **2396487220779 gas
(2.396487220779 Tgas)**. Total tokens_burnt across outcomes:
217330465827900000000 yoctoNEAR (0.0002173304658279 NEAR); the refund receipt
has tokens_burnt=0. Source NEAR decrease is exactly that sum plus the 1-yocto
deposit: 217330465827900000001 yoctoNEAR. All receipts succeeded. The token
receipt emitted the matching NEP-141 ft_transfer event, including the approved
source, destination, amount and memo.

### Independent balance reconciliation and integrity

Amounts below are atomic USDC units from finalized before/after view calls.

| Account | Before | After | Change |
| --- | ---: | ---: | ---: |
| Isolated contract | 100000000 | 0 | -100000000 |
| Operator wallet | 0 | 100000000 | +100000000 |

Post-transfer balances were read at blocks 277757982 and 277757983. Both storage
registrations remain. Post-transfer state at block 277757980 is byte-identical
to the full pre-transfer application state snapshot: same owner, pause=false,
zero campaign/payout counters, and no collection records. The code hash remains
`CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf`. Post-transfer campaign count is
0; accounting 0, funding 0 and payout 0 are null. Expected NEAR balance and nonce
changes are transaction effects, not application accounting changes.

No original-contract call, role assignment, token allowlisting, upgrade, campaign
creation, campaign funding or reservation occurred. No token rescue function was
introduced. Tests consisted of actual unsigned/signed transaction inspection,
independent signature verification, finalized RPC/receipt checks, exact balance
deltas, full state comparison, and `git diff --check`; no application code changed.

[Durable public preflight, transaction, receipts, postflight and reconciliation evidence](evidence/milestone-2/usdc-recovery-executed.json).
No private material or replayable signed transaction file was added to the repo.

### Git changes and next steps

This task updated this report and added
`docs/evidence/milestone-2/usdc-recovery-executed.json`. Pre-existing untracked
`docs/direct-usdc-recovery-audit.md`, `docs/evidence/milestone-2/direct-usdc-audit.json`,
`docs/evidence/milestone-2/isolated-signing-access.json` and this report were
preserved. Temporary scripts/signing artifacts stayed under /tmp. No commit or
push was performed.

The Operator wallet now holds the 100 test USDC needed for later funding.
Milestone 2 still requires separately approved token allowlisting, explicit
Operator role assignment, and the local API contract-selection/pause-startup
configuration decision. Campaign creation, ft_transfer_call funding, activation
and payout reservations remain unauthorized. **Stop: no further transaction.**
