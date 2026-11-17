M5-F.1, 2026-11-17. CONTROLLED TESTNET EXECUTION: NOT AUTHORIZED. Proposed transactions require separate approval. No live keys generated, accounts created or transactions submitted.

Project owner is designated human operator by this attachment. Candidate source pause()/unpause() require predecessor equal application owner disburse-topg.testnet; live owner/code and signer custody still need fresh verification.

Documentation-only pause command: `near contract call-function as-transaction disburse-test-contract.testnet pause json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as disburse-topg.testnet network-config testnet sign-with-keychain send`. Do not run. Command gas is a proposed cap; no signing performed.

Triggers: code/recipient/role mismatch, unexpected balances/accounting, duplicate attempt, RPC disagreement or unresolved outcome. Stop new initiation immediately; separately approved pause, then finalized is_paused query. Pause does not cancel dispatched transfer; private callback may truthfully settle while paused. Preserve receipt graphs, pre/post balances and attempt locks. Reconciliation reads cannot settle. If pause fails, stop all local initiation, escalate signer/RPC investigation; no retries of transfer, forced release or rollback. Resume only after explained accounting, resolved outcomes and separate unpause approval.
