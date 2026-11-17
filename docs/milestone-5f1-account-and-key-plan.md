M5-F.1, 2026-11-17. CONTROLLED TESTNET EXECUTION: NOT AUTHORIZED. Proposed transactions require separate approval. No live keys generated, accounts created or transactions submitted.

Parent and proposed recipient/approver/executor are absent at observed finalized blocks; see proposed-accounts.json. Absence is not ownership or permission to create. First obtain separately approved namespace creation and custody, then parent signer can create direct children. If unavailable, choose a fresh suffix under a verified controlled parent; never reuse unrelated accounts.

Use three distinct keypairs in OS secure keychain; do not generate here. Record public keys, prove finalized FullAccess membership and off-chain signing, encrypt offline backups, prohibit frontend/environment/Git secret storage. Same owner operating three keys satisfies account separation only, not independent human review. Proposed funding cap 0.1 NEAR per child (0.3 total), parent cap 0.5 NEAR; exact protocol storage/fees must fit before approval.

Unsigned command grammar inspected with near-cli-rs0.31.1: `near account create-account fund-myself ACCOUNT INITIAL_BALANCE use-manually-provided-public-key PUBLIC_KEY ...`. Complete signing suffix remains unresolved; no executable placeholder command is supplied.
