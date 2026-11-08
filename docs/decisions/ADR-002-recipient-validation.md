# ADR-002: Canonical networks and chain-aware recipients

Status: Accepted for validation; EVM checksum dependency review remains open.

## Decision

Use only `eip155:1`, `eip155:8453`, `near:mainnet`, and `near:testnet` as canonical registry IDs. The registry maps EVM IDs to chain IDs 1 and 8453 and distinguishes NEAR mainnet from testnet. All entries have execution disabled until route and RPC configuration is separately approved. Legacy aliases and unknown IDs fail closed.

EVM addresses must be prefixed 20-byte hex and nonzero. Lowercase/all-uppercase input is accepted as unchecksummed and normalized to lowercase. Mixed case must match EIP-55 computed with Ethereum Keccak-256. NEAR named IDs follow lowercase 2–64 character syntax with no repeated/edge separators; implicit IDs are 64 lowercase hex characters and are preserved.

## Consequences and limitations

EIP-55 is actual checksum verification, with known checksummed and invalid mixed-case vectors. The implementation is local Keccak code because the package has no ethers/viem dependency; replacing it with an audited maintained library is preferred, but adding a package was blocked by the session approval-review usage limit. No network is considered executable merely because its address format is recognized.

See [NEAR account ID validation](https://docs.rs/near-account-id/latest/near_account_id/) and [EIP-55](https://eips.ethereum.org/EIPS/eip-55).
