# M5-F.1A contract identity assessment

Rust identity checks remain unchanged. Native CONTRACT is pinned to `disburse-test-contract.testnet`, network `near:testnet`, token `usdc.tidepool-sandbox.testnet`. Owner-only paused initialization also validates expected legacy STATE hash and Borsh/prefix layout; native bindings and callbacks retain existing identity checks.

Fresh RPC verifies the historical deployed code, not the candidate native code. Candidate `target/near/disburse_contract.wasm`: 410611 bytes, SHA-256 `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9`, NEAR hash `4mBF2J6mE22XrTrSNo8x7xSLhzUSfNS9HkzHJeaxqwk4`. Its locked rebuild passed and reproduces the historical candidate hash. This is not deployed.

Smallest current-compatible future strategy remains separately reviewed/approved upgrade of the existing isolated target, with protected Campaign 0 accounting, token custody, roles and legacy keys preserved. A fresh proposed contract account cannot satisfy current identity guards and requires separate identity design/review. No guard was weakened, no arbitrary new identity approved, no migration executed on Testnet.


Scope: local implementation/tests and public read-only RPC only. No deployment, public transaction, key generation, role change, custody change, live worker, production database operation or Git write command was performed. M5-F.1B review has not begun.
