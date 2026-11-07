# NEAR testnet deployment readiness

## Current readiness report

**Status: BLOCKED — no deployment or signed transaction was attempted.** The repository has no
configured Disburse account or deployment record. `execution-service/.env.example` is read-only and
contains placeholders. No `near` CLI or local `~/.near-credentials` directory was present during
this audit. No test-token account, funded testnet account, or authorized signer identities were
provided. The strict preflight parser rejects mainnet values and accepts only the official testnet
RPC and FastNear endpoint values; it does not sign, submit, or inspect secrets.

| Readiness item                      | Value/status                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Network                             | NEAR testnet only                                                                                                     |
| RPC                                 | `https://rpc.testnet.near.org`                                                                                        |
| FastNear                            | `https://testnet.neardata.xyz`                                                                                        |
| Deployment account                  | BLOCKED — must be supplied and verified as disposable testnet account                                                 |
| Contract account                    | BLOCKED — must be supplied; no deployed account found                                                                 |
| Initializer signer / expected owner | BLOCKED — initializer predecessor becomes `owner_id`; must match the explicitly approved owner                        |
| Operator                            | BLOCKED — must be a separate account; owner cannot self-grant Operator                                                |
| Verifier                            | BLOCKED — must be identified separately from owner and Operator                                                       |
| NEP-141 token contract and metadata | BLOCKED — no token selected or verified                                                                               |
| Token funder and balance            | BLOCKED — no funded testnet account supplied                                                                          |
| Minimum testnet NEAR                | BLOCKED — depends on approved account, current gas/storage costs, deployment, and possible token storage registration |
| WASM artifact                       | `target/near/disburse_contract.wasm`                                                                                  |
| WASM SHA-256                        | `4d4001c6b26623e6aa1d3326fdf35976d214a38c666a24b4d9d9218323b37bc5`                                                    |
| Source revision used for this build | `c0ec6fea0dac0d4a80b71047515b2de55a49a14d` at build time                                                              |

The build uses the current Rust contract source, which was unchanged from the prior validation.
Because the worktree contains execution-service and documentation changes, record the final source
revision and `git diff` with any later approved build before deploying. Do not treat this artifact
hash as approval to deploy.

## Contract-specific lifecycle findings

- `new()` sets `owner_id = env::predecessor_account_id()`. The account that signs the direct
  initializer call becomes owner. Verify the exact signer and resulting `has_role` views.
- The owner has implicit Administrator authority but not Operator or Verifier. `grant_role` is
  owner-only and prohibits self-grant. `activate_campaign` requires an explicitly assigned Operator.
  Only an explicitly assigned Verifier may make verifier-only calls; this test has no reason to use
  settlement or recovery.
- `ft_on_transfer` accepts campaign funding only while the campaign is **Approved** and returns the
  entire amount as unused in other states. Therefore the safe campaign sequence is:
  **create → approve → fund → activate → create payout**. The requested order “activate then fund”
  conflicts with contract source and would not fund the campaign. No contract change is proposed.
- `create_payout` requires an active campaign, an Operator/Admin caller, matching NEAR input token,
  positive amounts, and available funded balance. It immediately reserves the input amount and emits
  `payout_reserved`; it does not execute a destination-chain transaction.
- The token's NEP-141 metadata and transfer behavior must be queried and checked. Confirm whether the
  token requires registering the Disburse contract's storage balance before `ft_transfer_call`; if
  required, that is an additional signed testnet transaction and its storage deposit must be
  included in the approved budget. Do not guess token identity or decimals.

## Proposed transaction inventory (not submitted)

After accounts, token, and approval are supplied, the minimal plan is expected to include:

1. Deploy the reviewed WASM to the approved contract account.
2. Call `new()` once with the approved initializer signer.
3. Grant Operator to the approved Operator account.
4. Grant Verifier to the approved Verifier account.
5. Add the verified NEP-141 token to the allowlist.
6. Create one campaign with a budget sufficient for the chosen small test amount.
7. Approve the campaign.
8. Fund it with `ft_transfer_call`, using the exact message `{"campaign_id":<campaign_id>}`.
9. Activate the now-funded campaign.
10. Create one payout with a unique idempotency key and a positive, metadata-consistent amount.

Token registration may add one transaction if required by the chosen NEP-141 implementation. Exact
gas deposits and total NEAR required must be measured or estimated for the approved account and
current testnet; this audit cannot safely provide a numeric minimum without those inputs. Use
testnet-only balances with headroom, and ensure no valuable assets are held by the disposable
accounts.

The planned payout must remain `Reserved`. Do not call execution start, mark pending verification,
settle, release, refund, or any external-chain method. Expected accounting after funding and payout
reservation is `reserved + spent <= funded <= budget`, `available = funded - reserved - spent`, and
`spent = 0`.

## Approval gate

Before any deploy, initialization, role assignment, token allowlisting, campaign action, token
transfer, or payout creation, prepare a concrete transaction manifest with account IDs, token
contract, metadata, exact amounts, transaction methods, gas/storage deposits, and expected state
changes. The owner/initializer relationship must be explicit. Obtain explicit approval for that
manifest. Milestone authorization alone is not approval for irreversible testnet state changes.

Use NEAR's local keystore or another reviewed secure signer. Do not put keys, seeds, or credentials
in environment files, source, documentation, shell commands, logs, or commits. The repository has
no signer implementation and the readiness helper never accepts secret values.

## Repeatable setup after approval

1. Copy `.env.testnet.example` to an ignored local environment file and fill only approved public
   account/endpoint/metadata values. Do not add secrets.
2. Run `loadTestnetReadinessConfig()` and reject any validation error. Query RPC `status` and require
   `chain_id = testnet` before any transaction. Verify the FastNear testnet endpoint and contract
   executor account.
3. Verify token `ft_metadata` (`name`, `symbol`, `decimals`, `spec`) and required NEP-141/NEP-145
   behavior using testnet views. Check token and NEAR balances; determine whether Disburse storage
   registration is required.
4. Build and hash the reviewed artifact. Confirm the exact artifact path/hash in the approved
   manifest; deploy and initialize once only after approval.
5. After each approved call, record its transaction hash, finalized block, and read-only contract
   view results. Stop on any mismatch or uncertain transaction outcome; do not blindly resubmit.

No deployment tooling, key-management integration, or transaction submission client is included by
this readiness-only work.
