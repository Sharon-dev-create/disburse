# M5-F.1C receipt regression recovery

**BLOCKED: eight receipt-backed local RPC tests and twenty sandbox receipt groups were not run freshly.** Historical passes are not substituted. No incomplete or unverified binary was executed.

The repository-supported harness is `tests/sandbox/run_reconciliation.py`, described in `tests/sandbox/RECONCILIATION.md` and `README.md`. It requires near-sandbox 2.14.0, candidate WASM, historical deployed WASM, old-B migration WASM and local token/fault artifacts. Existing `/tmp/disburse-m5c-artifacts` caches and the unchanged candidate are available. The missing dependency is the pinned executable `/tmp/disburse-m5c-tools/Linux-x86_64/near-sandbox`.

The available `parallel.tar.gz` is a partial 17,825,792-byte download, not the required 35,582,480-byte archive. It must not be extracted or treated as authenticated. Twenty-six cached 1 MiB ranges were available; eight ranges remained missing. Recovery fetched smaller 64 KiB HTTP ranges from the same official S3 object, checking status 206, exact Content-Range and body length. Both official S3 hostname forms were tried. Each request had a 10-second timeout, at most two attempts, eight concurrent requests and a 180-second scheduling budget per pass; already-running requests can drain after the scheduling deadline. No application timeout/resource/integrity configuration was changed.

The first pass completed 82 of 128 missing subranges (205.90 seconds including draining requests). A final bounded cache-resuming pass reached 125 of 128 (105.50 seconds). Three subranges remained unavailable: chunk 31 parts 0, 14 and 15, with TimeoutError/URLError. Complete range lengths alone do not establish authenticity: full archive and extracted binary hash checks remain mandatory. No further automatic retry was made.

Expected archive SHA-256:
`a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691`

Expected extracted binary SHA-256:
`797b9d7a9a23907048d68a427e86a55c94f1de232dbfb8b8a1eec09ecef3bf13`

Official artifact URLs:

- `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz`
- `https://s3.us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz`

Recovery code and raw failures: `evidence/milestone-5/m5f1c/recover-artifact.py`, `artifact-recovery.log`, `artifact-recovery-final.log`. Existing B download failures and evidence are preserved. This is an infrastructure validation blocker, not a demonstrated contract regression; toolchain compatibility cannot be freshly established without running the binary.

## Exact remaining procedure

1. Recover the official artifact into the supported `/tmp/disburse-m5c-tools` cache, verify archive length and SHA-256 before extraction, then verify the binary SHA-256. The retained recovery script can resume its cache with `python3 docs/evidence/milestone-5/m5f1c/recover-artifact.py`; it does not start a node. Do not replace the pin or skip checks.
2. Prepare an isolated repository copy containing the current `src`, `tests`, `execution-service`, Cargo manifests, linked verified candidate target and service dependencies, and the six prerequisite sandbox fixture files. `/tmp/m5f1c-sandbox` was prepared this way during this attempt. This copy avoids overwriting earlier evidence when the supported harness writes its original output paths. Recreate it if temporary files have expired.
3. Start a fresh dedicated local PostgreSQL17 database/role `disburse_test`, inspect physical host/port/database/role, and supply its explicit test-only DSN. The completed M5-F.1C cluster on port 19555 is stopped after tests; do not point at an unknown replacement.
4. From the isolated copy, run:

```sh
DISBURSE_TEST_DATABASE_URL=postgresql://disburse_test@127.0.0.1:19555/disburse_test python3 tests/sandbox/run_reconciliation.py
```

5. Require exit zero and a newly generated `docs/evidence/milestone-5/m5d/reproduction-result.json`. Inspect the fresh logs for all eight native live read-only tests and twenty receipt groups (ten main, seven fault, two migration, one callback/observer race). Preserve the complete new output under a separate milestone evidence directory and verify copied source hashes match the reviewed implementation. Then stop the owned temporary database/node.

The harness uses private synthetic `disburse-m5c-local` nodes bound to loopback, synthetic fixture transfers only, and no production workers or Testnet signers. Its two local RPC aliases reach one validator; they do not demonstrate independent public providers. The sandbox token also does not prove arbitrary live token compatibility. Until this fresh run succeeds, completion gate H remains BLOCKED and overall completion is PARTIAL.
