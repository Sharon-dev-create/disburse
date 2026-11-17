M5-F.1, 2026-11-17. CONTROLLED TESTNET EXECUTION: NOT AUTHORIZED. Proposed transactions require separate approval. No live keys generated, accounts created or transactions submitted.

Verdict PARTIAL. Revision f5102090a500cfe5c2993187cd704e56b4062d13. Candidate hash 37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9.

- Fresh deployed contract/token snapshot incomplete: RPC collection stopped with KeyError; preserve partial raw responses, rerun corrected collector before approval.
- Proposed parent and three subaccounts return UNKNOWN_ACCOUNT at finalized heights 278141486–278141491. No parent custody or child signer exists verified.
- Recipient ownership remains unverified; durable authenticated proof/replay workflow absent.
- Current environment targets disburse-topg.testnet and omits restricted read-only flag; it must not be started for this experiment.
- Candidate hardcodes disburse-test-contract.testnet; new isolated deployment requires separately reviewed identity changes/rebuild. In-place upgrade needs explicit authorization and Campaign 0 preservation evidence.
- Focused tests failed to load pg; full regression suites not repeated. Prior results are historical only.
- Native role holders, owner signing access and emergency key availability not freshly verified.
