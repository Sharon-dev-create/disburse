# Milestone 2 — Stage C1 and C2 execution

Date: 2026-11-15, Africa/Douala. Repository: `/home/topg/disburse`.
Revision: `7d4efc1829a0c20b30a6290f982727949180f7a5`.

## A. Verdict

**PASS — C1 and C2 completed and independently verified.** Exactly two approved
configuration transactions were submitted, in order. C1 finalized execution,
receipts, emitted event and fresh state were independently verified before C2
was prepared/signed. No additional transaction was submitted; no retries occurred.
This is a Stage C1/C2 PASS, not a claim that all Milestone 2 integration work is done.

[Public preflight, per-stage manifests, transactions/receipts, events and final snapshots](evidence/milestone-2/stage-c1-c2-executed.json).

## B. Preflight, authorization and transaction evidence

Read the milestone setup report, recovery report and verified transaction evidence,
generated ABI and Rust implementation. Git status was captured and all existing
untracked documents/evidence were preserved. No applicable repository AGENTS.md
was found during the preceding audit; no contract/application source changes were
introduced for these stages.

Source `src/lib.rs:218` and `:898` defines owner-only `add_accepted_token` and
`grant_role`. Both lack `#[payable]`; attach **0 NEAR**, not 1 yoctoNEAR. Owner
must equal the immediate predecessor, `disburse-topg.testnet`. The owner cannot
self-grant or grant Owner. Generated ABI confirms `token_id: AccountId`, and
`account_id: AccountId, role: UserRole`; UserRole JSON enum includes the exact
string **`"Operator"`**. Duplicate insertions are no-ops. Both views were false
in fresh preflight, so neither transaction was redundant.

The reviewed local WASM SHA-256 remains
`a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530`, whose NEAR
code hash matches the isolated deployment. Fresh Testnet reads confirmed the
expected owner, paused=false, empty campaign/payout state, unchanged token code
and six decimals, and wallet balances after the previous recovery. The Operator
and isolated account both retain token registration. No registration call was needed.

NEAR CLI version: **0.31.1**. Existing OS-keychain item metadata maps
`near-testnet-disburse-topg.testnet` to
`disburse-topg.testnet:ed25519:A717NFatHs2CFEKHH7CDNNwZercpfMKnGMNUdtKsgKdC`.
The matching live owner key is FullAccess. Its prior off-chain proof was reviewed;
each actual configuration transaction signature was independently verified with
Ed25519 before submission. No secret was exported/read for display or copied into
scripts, configuration or command arguments. Secure keychain signing was used.

The CLI's `testnet` profile uses `https://archival-rpc.testnet.fastnear.com/`;
its actual status was independently verified as Testnet and matching genesis with
`https://rpc.testnet.fastnear.com`. No Mainnet operation was performed.
Unsigned Borsh transactions were inspected using `near transaction print-transaction
unsigned`; each contained exactly one approved FunctionCall. Signed action/signer/
nonce bytes were checked against the inspected transaction and the signature was
independently validated. The CLI refreshed only the recent block hash, which was
verified on Testnet before submission. Signed transactions were saved under /tmp,
not committed or included as replayable blobs in the documentation.

Each stage used **30 Tgas** prepaid gas, a conservative cap, not an implementation-
measured minimum. Neither method has a fixed required gas value in its ABI. Both
burned far less than the cap. Owner NEAR above its existing storage backing was
ample; no extra NEAR transfer was proposed or performed. Isolated state storage
is backed by its existing NEAR, not an attached call deposit.

| Stage | Signer | Target | Method | Deposit | Prepaid gas | Total gas burnt | Final status |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| C1 | `disburse-topg.testnet` | `disburse-test-contract.testnet` | `add_accepted_token` | 0 | 30 Tgas | 2.192369358145 Tgas | FINAL, SuccessValue |
| C2 | `disburse-topg.testnet` | `disburse-test-contract.testnet` | `grant_role` | 0 | 30 Tgas | 2.212817448535 Tgas | FINAL, SuccessValue |

C1 arguments:

```json
{"token_id":"usdc.tidepool-sandbox.testnet"}
```

Hash: [`3oKzDPBvwnfe1qx3BNTzKtFqsCKBrxGUgA3LhhGzqhUc`](https://testnet.nearblocks.io/txns/3oKzDPBvwnfe1qx3BNTzKtFqsCKBrxGUgA3LhhGzqhUc).

C2 arguments:

```json
{"account_id":"disburse-op-b966e36d.testnet","role":"Operator"}
```

Hash: [`DZeuX1AYXYpycWYMxn5MB8oEy4z7rhhg5jeEsa22M57q`](https://testnet.nearblocks.io/txns/DZeuX1AYXYpycWYMxn5MB8oEy4z7rhhg5jeEsa22M57q).

Each signed transaction was submitted once using RPC `send_tx` with
`wait_until=FINAL`. Separate read-only `tx` queries independently confirmed the
signer, receiver, single action, decoded arguments, gas, deposit and successful
final execution. All receipt statuses were successful.

### Receipt outcomes and events

| Stage/outcome | Receipt ID | Executor | Gas burnt | Status |
| --- | --- | --- | ---: | --- |
| C1 transaction | Transaction hash above | Owner signer | 311015890330 | SuccessReceiptId |
| C1 call | `9ZuVnXgyGsYLyawHu5oGoW7JapptJZ84aFcruamn7QX8` | Isolated contract | 1658170905315 | SuccessValue |
| C1 refund | `BfdhsQrgo31bH62yHMu4ZNuHBeTPVFNMBWwrtEUMJBZL` | Owner signer | 223182562500 | SuccessValue |
| C2 transaction | Transaction hash above | Owner signer | 311540411195 | SuccessReceiptId |
| C2 call | `FCw3ie7ZYjdEh4fC9vRddW6SFVbnrAT3jQgaa7zdNXqn` | Isolated contract | 1678094474840 | SuccessValue |
| C2 refund | `2qZwygxmVA9q5pYDP2dxFUXKUDS3TLRbwmPNMz7hwztn` | Owner signer | 223182562500 | SuccessValue |

Gas totals include transaction processing and both receipts. Expected refund
receipts credit the signer without invoking its application methods. They are not
additional configuration calls to the original contract.

C1 event: standard `disburse`, version `1.0.0`, `accepted_token_added`, data:

```json
[{"token_id":"usdc.tidepool-sandbox.testnet","actor_id":"disburse-topg.testnet"}]
```

C2 event: standard `disburse`, version `1.0.0`, `role_granted`, data:

```json
[{"account_id":"disburse-op-b966e36d.testnet","role":"operator","actor_id":"disburse-topg.testnet"}]
```

The event uses lowercase `operator`; the ABI argument uses uppercase `Operator`.
Both were checked against the actual implementation.

## C. Contract configuration and final independent verification

Initial reads span blocks 277758478–277758489. Final reads span blocks
277758947–277758963. All views/state snapshots used finality=final; exact block
hashes are retained in the evidence. Transaction results were independently FINAL.

| Property | Before | After | Evidence type |
| --- | --- | --- | --- |
| Isolated contract | `disburse-test-contract.testnet` | Same | RPC account identity |
| Owner | `disburse-topg.testnet` | Same | Direct get_owner view |
| USDC accepted | false | true | Direct is_accepted_token view |
| Operator role for designated account | false | true | Direct has_role view |
| Administrator / Verifier for Operator account | false / false | false / false | Direct has_role views |
| Paused | false | false | Direct is_paused view |
| Campaign count | 0 | 0 | Direct get_campaign_count view |
| Payout counter | 0 | 0 | Source-aware Borsh STATE decoding |
| Campaign 0 funding / accounting, payout 0 | null / null / null | null / null / null | Direct views |
| Operator wallet USDC | 100000000 atomic | 100000000 atomic | Direct token ft_balance_of |
| Isolated wallet USDC | 0 atomic | 0 atomic | Direct token ft_balance_of |
| Operator token registration | Registered | Registered | Direct storage_balance_of |
| Isolated code hash | `CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf` | Same | RPC view_account |

Full isolated `view_state` had one entry (STATE) before C1, two after C1, three
after C2. STATE itself is byte-identical through both calls: owner, pause and
campaign/payout counters are unchanged. The only additional records are the
reviewed LookupSet insertions for the accepted token and Operator role. Their
semantics are independently established by the direct views and exact code/events.
Given matching code, zero decoded counters, unchanged STATE and the complete
record inventory, no campaign/payout records or funding/reservation/spending
liabilities were introduced. That conclusion uses source-aware state inspection,
not a nonexistent public payout-count view.

No role besides the specified Operator was granted. FullAccess permissions were
not changed. The owner retains its existing implicit Administrator/Owner status;
no new Administrator, Verifier or Owner grant occurred.

## D. Security, integrity and Git changes

The protected original contract's complete application `view_state` values are
byte-identical before and after C1/C2; its code hash and storage usage are
unchanged. Therefore its existing owner, pause, roles, token allowlist, campaigns
and payouts are unchanged. It was the authorized signer, never the configuration
receiver. **Its native NEAR balance decreased by gas fees and its access-key nonce
advanced twice**, as expected for signing; these are not application-state changes.
The isolated code was not redeployed, and its NEAR balance did not move. Isolated
storage usage grew from 299422 to 299513 to 299602 bytes for the two records.
USDC balances were unchanged at each independently verified stage.

No Rust, application code, environment, service runtime, production/Vercel setting,
pause flag or local contract selection changed. No campaign, FT funding transfer,
payout, account creation, key/permission change or storage registration occurred.
There were no preflight discrepancies or uncertain outcomes. Existing false
allowlist/role views required both actions; no idempotent duplicate was submitted.

Added only this focused report and
`docs/evidence/milestone-2/stage-c1-c2-executed.json` during this task. Preserved all
pre-existing untracked recovery/audit documents and evidence. No commit or push.
Temporary transaction tooling/logs stayed under /tmp. `git diff --check` passed.
Verification used actual RPC, exact manifest/signature checks, full state
comparisons and receipt/events; no source changes warranted new unit tests.

## E. Execution-service startup constraint — proposed solution only

`execution-service/src/api/http.ts:89` calls `reader.verifyNetwork()` and
`reader.isPaused()` and throws unless paused=true, **before HTTP listen**.
`src/host/server.ts` routes host startup through this function. Tests
`contract paused state false prevents HTTP listening` and
`contract paused state true permits HTTP listening` establish the intentional
condition. README calls it the paused/read-only requirement for this host milestone.
It is a deliberate safety gate for the current demo host, not a NEAR requirement
for read-only views and not a continuous runtime invariant: `isPaused` is called
only during startup in this server, not per request or on a background loop.
No claim is made that the application must remain paused forever by design.

Current local public configuration still selects `disburse-topg.testnet`,
NEAR_NETWORK=testnet and the official Testnet RPC. Thus the API remains scoped to
the original contract; changing only DISBURSE_CONTRACT_ID to the isolated account
would still fail startup because the isolated contract is unpaused. Direct
read-only RPC/reader access works independently of this gate. The network transport
and API authorization are separate checks and must remain in force.

**Proposed minimal safe resolution for a later approved task:** introduce an
explicit opt-in for active-contract *read-only Testnet demonstration* in host
readiness policy. Keep paused=true as the default; permit the opt-in only for
Testnet and the explicitly approved isolated contract ID, retaining network/code/
owner readiness checks, authenticated read-only routes, loopback binding and no
signer/worker/settlement capability. Add focused tests for default rejection,
opt-in success for the approved Testnet account, rejection on any other account
or network, and unchanged authentication. This is a proposal, not an existing
config option or an implemented bypass. After its separate review/approval,
change only local contract selection and restart/reverify API/frontend reads.

For a chain-only demonstration, an alternative requiring no host-policy code
change is approved CLI campaign calls plus the existing standalone read-only
reader. That would not establish frontend/API integration. Do not present
pause → start → unpause as a durable resolution: a restart while active would
fail again. No pause/unpause or configuration/code edit was performed here.

## F. Milestone readiness and stop

C1/C2 are complete. The isolated chain environment now has matching initialized
code, the correct owner, an accepted verified USDC token, the required explicit
Operator, both token registrations and 100 test USDC in the Operator wallet.
No Verifier is required for campaign funding/activation/reservation demonstration.

What remains before a full Milestone 3 demonstration:

1. Separately approve and resolve the read-only API startup/contract-selection
   path above; configure and verify only local integration. Keep production and
   the original application unchanged. No additional pause transaction is assumed.
2. Complete the final Milestone 2 readiness record with isolated API reads and
   accepted runtime limitations. Until then overall Milestone 2 remains partial
   for service integration, despite C1/C2 PASS.
3. Obtain explicit Milestone 3 approval for exact campaign creation, approval,
   wallet ft_transfer_call funding while Approved, activation and any reservation
   or budget tests. Recheck balances/permissions and record each real transaction.

**STOP. No further on-chain action is authorized by this Stage C1/C2 task.**
