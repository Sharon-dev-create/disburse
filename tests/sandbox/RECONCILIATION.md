# M5-D local reconciliation tests

M5-C prerequisite: see the passing independent implementation re-review and pinned
source/WASM hash. No Rust/WASM change is introduced by M5-D. No production host,
signer, background execution worker, refund policy or frontend is wired to it.

The Python harness uses the existing C sandbox client with public synthetic keys.
It validates the pinned sandbox binary and reviewed C WASM before any local run.
All nodes bind loopback with the `disburse-m5c-local` chain ID. C artifacts must be
prepared as documented in README.md; do not refetch public code or overwrite old
milestone evidence merely to reproduce these tests. Use authenticated existing
historical/old-B/fault/token artifacts or rebuild isolated copies and verify pins.

Provide a **dedicated local** PostgreSQL17 `disburse_test` database owned by
`disburse_test`. Never point this at an existing development/production database.
The implementation and integration fixtures enforce local test identity. Example
for a freshly initialized throwaway cluster on port19543 (no application env file
is changed):

```bash
DISBURSE_TEST_DATABASE_URL=postgresql://disburse_test@127.0.0.1:19543/disburse_test python3 tests/sandbox/run_reconciliation.py
```

This explicit harness runs the C receipt/migration scenarios in a fresh temporary
node with extended GC retention (100000 epochs), copies only new M5-D evidence,
then reopens that synthetic ledger for read-only collection. It captures six real
finalized graph fixtures, runs the existing service and PostgreSQL test scripts,
then runs the explicitly separate native live-read tests and callback/observer
race fixture. The race fixture creates one new synthetic campaign/payout and
starts a read-only observer before its C callback; only C performs settlement.
Nodes terminate in `finally`. The database is supplied by the operator and should
be shut down/discarded after tests; no production schema migration is permitted.

The original non-archival sandbox can prune history; missing data is ManualReview,
not transfer failure. Archive=true alone was rejected by nearcore initialization;
this harness changes only GC retention in its temporary node config. It does not
claim to configure a production archival node or recover already deleted data.

Unit tests replay captured actual receipts and deliberately forge/mock conflicts.
Live-read tests use two aliases of one synthetic node, not two independently
operated validators. PostgreSQL tests use real server transactions, concurrency,
lease expiry and a SIGKILL/fresh-process restart. Repository-only mock decisions
are labeled and do not count as verified transfers. No on-chain recovery mutation
exists, so callback/reconciliation double settlement is structurally unavailable.
