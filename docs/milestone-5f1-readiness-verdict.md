M5-F.1, 2026-11-17. CONTROLLED TESTNET EXECUTION: NOT AUTHORIZED. Proposed transactions require separate approval. No live keys generated, accounts created or transactions submitted.

PARTIAL. CONTROLLED TESTNET EXECUTION: NOT AUTHORIZED.

- Fresh deployed contract/token snapshot incomplete: RPC collection stopped with KeyError; preserve partial raw responses, rerun corrected collector before approval.
- Proposed parent and three subaccounts return UNKNOWN_ACCOUNT at finalized heights 278141486–278141491. No parent custody or child signer exists verified.
- Recipient ownership remains unverified; durable authenticated proof/replay workflow absent.
- Current environment targets disburse-topg.testnet and omits restricted read-only flag; it must not be started for this experiment.
- Candidate hardcodes disburse-test-contract.testnet; new isolated deployment requires separately reviewed identity changes/rebuild. In-place upgrade needs explicit authorization and Campaign 0 preservation evidence.
- Focused tests failed to load pg; full regression suites not repeated. Prior results are historical only.
- Native role holders, owner signing access and emergency key availability not freshly verified.

Monitoring procedure: manually capture pause/campaign/native payout/attempt/outcome views, pre/post token balances, finalized complete receipt/callback graph and timestamped TransferPending age; escalate after60seconds without resolution, no resend. Observe ManualReview and read-only reconciliation evidence, not frontend settlement alone.

Actual .env targets disburse-topg.testnet, development PostgreSQL and missing restricted mode; do not launch host. No execution worker exists; dormant policy does not enforce live limits. No configuration changed.

Focused test attempt failed with missing pg dependency. No new application source; full suite omitted pending environment repair. Prior completed146/186/46/8/20 are historical evidence, not fresh results. Next: repair read-only collector/environment, complete live snapshot, then independent review of exact deployment/namespace and parameter-complete plan.
