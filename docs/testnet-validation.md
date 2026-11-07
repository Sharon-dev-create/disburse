# Milestone 11 testnet validation record

## Result

**Milestone status: BLOCKED / PARTIALLY VALIDATED.** Automated contract build and deterministic
test validation passed. No live Disburse deployment or event was claimed. The deployment account,
contract account, initializer/owner, Operator, Verifier, approved NEP-141 token, token funder, and
signer are not configured or supplied. The required explicit approval for signed transactions has
not been given. No testnet transaction was submitted.

## Automated validation

| Check                                             | Result | Evidence                                                                                                     |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `cargo fmt --all -- --check`                      | PASS   | Completed with the Milestone 11 preflight audit                                                              |
| `cargo test --locked`                             | PASS   | 98 passed; 0 failed; 0 doc tests                                                                             |
| `cargo near build non-reproducible-wasm --locked` | PASS   | `target/near/disburse_contract.wasm`, 298,523 bytes                                                          |
| WASM SHA-256                                      | PASS   | `4d4001c6b26623e6aa1d3326fdf35976d214a38c666a24b4d9d9218323b37bc5`                                           |
| `cargo near abi`                                  | PASS   | Generated `target/near/disburse_contract_abi.json`                                                           |
| `pnpm check`                                      | PASS   | Prettier, strict TypeScript typecheck, ESLint, and 42 tests passed, including testnet environment validation |
| `git diff --check`                                | PASS   | Verified after the final documentation and test edits                                                        |

The WASM build contains no Milestone 11 contract changes. The requested artifact is local build
output and is not deployed.

## Live evidence

| Evidence                          | Required result                                                | Status                                                                                 |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Contract deployment               | Testnet transaction and finalized block                        | BLOCKED — no account, signer, or approval                                              |
| Initialization                    | Owner view matches approved initializer                        | BLOCKED — no deployed contract                                                         |
| Token verification/allowlist      | Verified testnet NEP-141 metadata and accepted contract        | BLOCKED — token not selected                                                           |
| Campaign lifecycle                | Draft → Approved; funded while Approved; then Active           | NOT TESTED — no live contract                                                          |
| Campaign funding                  | `ft_transfer_call` accepted with campaign message              | BLOCKED — token/account not supplied                                                   |
| Payout reservation                | Payout remains Reserved with exact input amount                | BLOCKED — no funded campaign                                                           |
| Real `payout_reserved` discovery  | FastNear block/transaction/receipt/event identity              | BLOCKED — no deployed contract/event                                                   |
| Event decoding and reconciliation | Event fields equal current contract payout/accounting views    | BLOCKED — no live event or contract view                                               |
| Operational job                   | Exactly one job after live validated discovery                 | NOT TESTED against testnet                                                             |
| Restart and duplicate replay      | Durable cursor resumes; replay does not duplicate job          | Automated fixtures only; live testnet NOT TESTED                                       |
| Historical recovery               | Bounded replay reconciles views and changes no financial state | Automated fixtures only; live testnet NOT TESTED                                       |
| Integrity incidents               | Conflicts stop cursor and preserve evidence                    | Deterministic fixtures validated by Milestone 10.1 package tests; no live manipulation |

There are no deployment transaction hashes, block heights, campaign IDs, payout IDs, funding
transactions, or live Disburse event identities to report. Prior FastNear live reads documented in
[`near-event-provider-integration.md`](near-event-provider-integration.md) were unrelated testnet
activity and are not evidence for this table.

## Source audit notes

- No root `README.md` exists; the execution-service README and the required settlement, discovery,
  indexing, and discovery-integrity documents were inspected.
- `new()` sets owner from the initializer predecessor. Owner is implicitly Administrator but cannot
  self-grant roles. Operator and Verifier need separate explicitly assigned accounts.
- `ft_on_transfer` only accepts funding while campaign status is Approved. Funding must happen
  before activation; the sequence in the supplied milestone brief would otherwise return unused
  tokens. This was documented and does not require contract modification.
- Contract views, not the event or local index, remain authoritative. No execution, settlement,
  release, refund, or external-chain calls are required or permitted for this validation.
- The file repository is single-writer. No production database, migration, signer, or worker loop is
  introduced.

## Next gated step

Supply and verify disposable testnet identities for deployment account, contract account,
initializer/expected owner, Operator, Verifier, test-token contract, and token funder; select the
exact small atomic funding/payout amounts after checking token metadata; and ensure the accounts have
testnet NEAR for deployment, gas, and any NEP-145 storage registration. Then prepare the complete
transaction manifest and request explicit approval. Do not submit any of those transactions before
that approval.
