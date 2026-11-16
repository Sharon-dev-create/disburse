# M5-C local receipt and migration suite

These tests execute real NEAR WASM/action/data receipts on a private nearcore
2.14.0 sandbox. They do not use Testnet funds, existing user keys, NEAR CLI
keychains, PostgreSQL, Intents or the execution service. Every signing operation
checks the loopback endpoint and synthetic chain ID `disburse-m5c-local`.
Account names matching the configured `.testnet` domain are **synthetic genesis
accounts**, not evidence of control of public accounts. Fixture keys are publicly
reproducible test secrets; never fund them on a public network.

Requirements already used: Rust/cargo-near and locked SDK5.30.1, Python3.13 with
existing cryptography43.0.0, Linux x86_64, and the pinned sandbox executable.
No existing Cargo/NPM dependency versions were changed. The separate token package
reuses exactly the root dependency graph with only its package name changed.
Build-target overrides are per subprocess; no application environment config changes.

## Setup

The sandbox download URL follows the official
[near-sandbox runner](https://github.com/near/near-sandbox-rs/blob/main/src/runner/mod.rs).
Version2.14.0 matches the installed SDK's supported protocol capabilities. The
observed download is hash-pinned; a release signature was not independently verified.

```bash
mkdir -p /tmp/disburse-m5c-tools
curl --fail --location https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz --output /tmp/disburse-m5c-tools/near-sandbox-2.14.0.tar.gz
python3 -c "import hashlib,pathlib; assert hashlib.sha256(pathlib.Path('/tmp/disburse-m5c-tools/near-sandbox-2.14.0.tar.gz').read_bytes()).hexdigest() == 'a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691'"
tar -xzf /tmp/disburse-m5c-tools/near-sandbox-2.14.0.tar.gz -C /tmp/disburse-m5c-tools
python3 tests/sandbox/fetch_historical_wasm.py
python3 tests/sandbox/build_artifacts.py
python3 tests/sandbox/run_suite.py --sandbox-bin /tmp/disburse-m5c-tools/Linux-x86_64/near-sandbox
```

The historical fetch is a public **view_code** query only. It accepts only the
known299058-byte old artifact with SHA256
`a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530`.
If the public deployment changes, supply an independently authenticated old artifact;
do not silently use different bytecode. The M5-B fixture is rebuilt from repository
revision `fdd8b48`, and its known385351-byte hash must match
`ad51f8bc061138013ff33620d33adff8dffacb4eaf1c06b09853c79b92c58e94`.

Each run creates fresh genesis/storage under `/tmp`, binds only127.0.0.1:18545/18546,
uses no boot peers, and terminates its node in `finally`. Fault tests reuse only
that run's private data directory; B→C migration uses another fresh node.
Run sequentially to avoid port conflicts. Kernel/network tunables are not changed.

## What executes

- Authenticated historical deployed WASM→candidate with nonempty locally created
  legacy settlement, failure, resolution and replay/index history; raw-key,
  ownership/role/accounting and token-custody preservation.
- Standard token funding/storage and successful exact100000-atomic transfers;
  missing registration, explicit rejection, insufficient token/NEAR balance,
  minimum gas, duplicate requests and concurrent payouts/campaigns.
- Actual private wrapper rejection plus root self-calls with stale/duplicate IDs.
- Discarded-response/fresh-client restart **model**, not an actual execution-service
  or PostgreSQL restart.
- Token success plus callback panic/OOG, scheduling-receipt rollback, unknown
  return data, pause-before-callback, and an incompatible in-flight local upgrade.
- M5-B→C with approved and orphan consumed preflight records. Approved execution
  succeeds; old consumed orphan stays frozen, requiring future M5-D review.

## Fault artifacts and token hooks

Production Disburse contains **no test switches**. `build_variants.py` copies
source into `/tmp` and produces explicitly labeled artifacts:

- `schedule-panic`: panic after TransferPending writes/events but before token promise.
- `panic-callback`: panic after the successful settlement body writes/events.
- `oog-callback`: allocate1 gas to the final callback.
- `missing-callback`: rename only the final callback to model an incompatible upgrade.

State rollback is verified through actual receipts and balances; failed-receipt
logs are not treated as committed settlement. Artifact hashes and exact patch
descriptions are saved in `fault-artifact-manifest.json`. The normal production
candidate is tested separately and restored after each fault case.

The local token wraps near-contract-standards5.30.1. Owner-only reject/burn/bad-return
controls are test fixtures. Its **pause hook** deliberately returns an owner-proxy
pause promise after the token debit, making receipt order deterministic. This is
not a claim about production token internals or failure atomicity for promise-
returning tokens. Only normal mode is used for atomic failed-token assertions;
the hook is used for pause/upgrade interleavings. Successful hook completion is
checked. The bad-return hook models delivered funds with a nonstandard return:
Disburse must keep ManualReview reserved and block resend.

## Measurements and limits

`collect_runtime_evidence.py` performs reads only against the completed local node
and saves gas/storage/protocol limits plus receipt block ordering. It can be run
through the node wrapper after the suite:

```bash
python3 tests/sandbox/with_node.py --sandbox-bin /tmp/disburse-m5c-tools/Linux-x86_64/near-sandbox --phase inspect --existing-home /tmp/disburse-m5c-local-REPLACE_WITH_RECORDED_HOME
```

Use the home recorded in `node-main.json`; that placeholder is a filesystem path,
not a recipient or transaction manifest. Do not submit any public-chain command.
All records are under `docs/evidence/milestone-5/m5c-implementation/`.

The suite proves local runtime behavior, not public deployment readiness, actual
Tidepool implementation/gas guarantees, real recipient control, multi-validator
load/forks, or execution-service integration. Independent review and separate
M5-D/M5-E/deployment gates remain mandatory. Never restore older WASM as an
automatic recovery for an unresolved token transfer.
