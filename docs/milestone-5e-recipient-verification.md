# M5-E recipient verification

Pinned read-only preflight checks network, account syntax/existence, exact token asset/account/code identity, metadata, storage bounds/registration and consistency with the approved recipient/token. A successful technical preflight never enables execution or claims ownership.

No controlled recipient was supplied. Live recipient ownership and technical readiness remain NOT VERIFIED. Operator and contract storage queries are operational custody evidence, not substitute recipient evidence.

Advisory ownership claims can be Unverified, VerificationPending, VerificationFailed or VerificationExpired. No positive Verified path or signature verifier was implemented. Expired, replay-flagged or changed claims fail closed; this is not a durable replay-protection implementation.

A future authenticated workflow should use [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md): wallet message signing with domain separation, fresh 32-byte nonce, recipient/network binding and short expiry. Verify the signature against a current FullAccess key on the claimed account at finalized state, bind to the authenticated intended person/session, consume the nonce atomically once and invalidate evidence when destination/key/network changes. [Wallet Selector documents signMessage](https://github.com/near/wallet-selector/blob/main/packages/core/docs/api/wallet.md), including redirect wallets, but that repository is archived and no particular wallet capability was tested here. Wallet integration, authentication and durable nonce storage need separate design/review; no unsupported signature scheme or incomplete login flow was added.
