# Directly received Tidepool USDC — recovery audit

Date: 2026-11-15 (Africa/Douala). Source revision:
`7d4efc1829a0c20b30a6290f982727949180f7a5`.
Read-only chain/source audit; no signing, transaction submission or contract change.

## Findings

1. **The deployed Disburse contract has no outgoing NEP-141 transfer or rescue
   facility.** Source and generated ABI contain no owner-authorized rescue,
   withdraw, sweep, arbitrary-call or token-refund method. `PromiseOrValue` is
   used to return unused inbound transfer amounts, not to make outgoing calls.
   The payout recovery methods release internal reservations or record evidence;
   they do not transfer NEP-141 balances. See `src/lib.rs:593`, `:676`, `:1270`
   and `:1513`.
2. **The 100 test USDC is excluded from campaign accounting, correctly.** At
   finalized block 277756684, token `ft_balance_of` for
   `disburse-test-contract.testnet` returned `100000000`; metadata has 6 decimals.
   At blocks 277756681–277756682, campaign count=0, accounting for campaign 0=null,
   and full contract state contains only STATE. Source-aware Borsh decoding gives
   campaign and payout counters both zero; there are no campaign/payout entries.
   No campaign has funded, reserved, spent or available amounts attributable to
   this balance. Do not present nonexistent campaign accounting as a populated
   zero-valued response.
3. **A contract upgrade is not necessarily required for recovery.** The isolated
   account has a FullAccess key of its own, verified at block 277756680:
   `ed25519:9hWszNNZawwV2VngQJkKpwCCGTka3LvM1qeN2oZKPWRe`. If its matching secure
   signer is available, it can sign a transaction from
   `disburse-test-contract.testnet` directly to the token contract's `ft_transfer`.
   This bypasses Disburse code; it does not invoke the receiver or modify its
   campaign state. This is an account-key capability, not a contract rescue API.
4. **The verified owner signer is a different authority.** `get_owner` returns
   `disburse-topg.testnet`. Its application-level owner role does not let a token
   transfer debit the isolated account. A direct call signed as the owner debits
   the owner's token balance instead. Access to the isolated account's own key
   has NOT been verified, and there is no legacy key file for it in the inspected
   Testnet credential directory. Its key might exist in the OS keychain or a
   wallet. No key export, key import, message signing or transaction signing was
   attempted in this audit.
5. **Recovery can preserve current campaign accounting, conditionally.** With no
   campaigns/payout liabilities, the verified 100 USDC is unallocated under this
   implementation. A correctly authorized transfer of exactly those units to a
   verified registered wallet would leave campaign accounting unchanged. Recheck
   counters, full state, token balance, destination and signer immediately before
   any approved recovery; today's observation is not approval or an assurance
   about future state. Neither the faucet claim's transaction nor its delivery
   mechanism was independently reconstructed; the direct-credit provenance is
   user-supplied and the resulting live balance/state was independently verified.
6. **Safest recommendation: leave these no-value test tokens untouched and obtain
   separate wallet-held USDC.** This avoids new contract code and spending from
   the contract account while continuing the intended funding demonstration.

[Raw finalized Testnet evidence](evidence/milestone-2/direct-usdc-audit.json).

## Why the balance is unallocated

`create_campaign` starts `funded`, `reserved` and `spent` at zero
(`src/lib.rs:178`). The only production assignment increasing campaign funded is
inside `ft_on_transfer` (`:1513`–`:1556`): it checks the actual predecessor token,
allowlist, pause state, a valid numeric campaign ID, Approved status, matching
token and remaining budget. It does not reconcile the account's external FT
balance. A direct faucet credit or ordinary FT transfer does not trigger this
accounting path. Adding the token to the allowlist later cannot retroactively
attribute the 100 USDC to a campaign.

`get_campaign_payout_accounting` (`:409`) reads stored campaign values;
`available_campaign_funds` (`:1382`) computes funded − reserved − spent with
invariant checks. It never substitutes the aggregate token wallet balance.
Manually calling `ft_on_transfer` as the owner cannot legitimately attribute the
balance: the predecessor would be the owner, not the accepted USDC token.
Do not simulate funding, create a campaign to absorb these tokens, or use a
self-transfer/callback workaround.

Current selected state: owner=original account, paused=false, USDC accepted=false,
0 campaigns, 0 payouts. Live code hash
`CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf` matches the local WASM's base58
SHA-256; local hex SHA-256 remains
`a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530`.

## Recovery alternatives and security implications

**Existing account-key recovery, if requested later:** first verify control of the
isolated FullAccess key using an explicitly authorized off-chain proof and match
it to the on-chain key. Then prepare a separately approved transaction manifest:
signer=isolated account, target=`usdc.tidepool-sandbox.testnet`, method=`ft_transfer`,
receiver=approved registered wallet, amount=`"100000000"`, memo=explicit recovery
record, attached deposit=1 yoctoNEAR, with reviewed gas. No actual transaction is
prepared or signed now. Confirm final successful transaction and receipts, wallet
balance delta, isolated FT balance delta and byte-identical Disburse state.

A direct account-key transfer would not obey Disburse's pause or role checks.
FullAccess control can spend campaign-backed tokens as well; the chain will not
protect campaign solvency based on application accounting. This is acceptable
only with explicit recovery approval and proof the amount is surplus. Do not
share, export or add FullAccess keys to simplify the demonstration.

**Contract-based recovery if that key is unavailable:** existing owner methods
cannot perform it. Adding such an owner-authorized method would require a
reviewed upgrade, and upgrade authority must itself be established; owner status
alone is not deployment authority. No upgrade is recommended for these test
assets. A generic owner sweep could drain campaign custody without reducing
recorded liabilities, leaving valid-looking but insolvent accounting. A safe
future design would need a precise per-token liability model (including spent
amounts and any pending obligations), surplus bounds, asynchronous FT-balance
checks and transfer callbacks, concurrency protection against new deposits or
reservations during recovery, strict authorization, deposit/gas limits,
authenticated destination, storage registration, audit events and failure-safe
behavior. Never assume `balance − reserved` is recoverable. Avoid trusting a
caller-supplied balance or altering funded totals to make a sweep appear safe.
Current campaigns use LookupMap without a global liability total, so computing
and maintaining provable surplus would itself require careful design/migration.
No rescue function or Rust change is proposed or introduced.

## Recommended alternative funding plan — proposed only

1. Keep the isolated account's 100 USDC as a documented unallocated balance;
   exclude it from campaign funding and future balance-delta checks.
2. Obtain separate wallet-mode test USDC for the existing
   `disburse-op-b966e36d.testnet`, subject to faucet eligibility and explicit
   approval. Current wallet balance=0 at block 277756686. Its USDC storage is
   already registered (total `1250000000000000000000`, available 0 at block
   277756687), so **do not repeat the previously proposed registration**.
3. Verify the actual faucet transaction/receipts, wallet recipient and positive
   token balance before claiming wallet funding is ready. Do not infer claim
   eligibility or use a faucet allocation held inside an intents verifier.
4. Retain separate approval for token allowlisting, Operator assignment and the
   API pause/startup decision from Milestone 2. Under separately approved
   Milestone 3 actions, fund an Approved campaign using wallet `ft_transfer_call`
   with the correct campaign message, then verify stored campaign funding and
   transfer receipts. Evaluate token balance changes relative to the 100-USDC
   baseline; never equate total token holdings to campaign-funded balance.

Reference behavior: [NEAR FT standard](https://docs.near.org/primitives/ft/standard)
defines caller-based transfers and a 1-yoctoNEAR deposit. The
[NEAR access-key documentation](https://docs.near.org/protocol/accounts-contracts/access-keys)
explains FullAccess authority to call other contracts. These explain the
account-key alternative; it has not been executed or tested as a transfer here.

No new tests/build were needed: source/ABI inspection, existing funding/recovery
tests and read-only live evidence establish these findings. No source, deployed
code, campaign state or local service configuration changed. Only this audit
record and public evidence were written. Stop for approval before wallet token
acquisition, off-chain proof for the isolated key, recovery or configuration.

## Follow-up — isolated signing access resolved

The later [isolated signing proof and exact recovery plan](isolated-signing-recovery-plan.md)
verifies that the isolated FullAccess key is available through the OS keychain.
Its independent NEP-413 signature verification passed; a direct 100-USDC recovery
is now concretely planned without an upgrade. Recovery remains unapproved and
unexecuted. The earlier signing-availability uncertainty above is historical.
