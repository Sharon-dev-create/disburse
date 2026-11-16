# M5-D — Migration and compatibility safety

No Rust source, Borsh layout, native enum, storage prefix, promise graph, callback method, guard or WASM change is required for read-only M5-D. Candidate C SHA256 remains `37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9` and the per-source hash manifest from the passing independent C re-review is retained.

The fresh C review reran authenticated historical deployed-WASM→C and M5-B→C upgrades locally, including nonempty locally generated legacy settlement/failure/resolution records, immutable indexes, roles/owner, accounting and token custody. The original deployed bytecode was authenticated in the prior milestone; this review reuses its pinned local artifact, without a live RPC fetch. Approved B payout executes under C; consumed orphan preflight remains frozen. Synthetic populated history is not claimed to be authentic nonempty production history.

M5-D receipt-fixture generation reruns the same local migration cases with extended retention. No additional contract upgrade or bootstrap is added to reconcile evidence. Any future recovery mutation would require its own versioned storage design, old-to-new migration and callback-in-flight tests; C's reviewed layout is not silently extended here.

PostgreSQL0004 only adds native evidence tables, indexes and triggers, registered in the existing checksum migration runner. Previous migrations remain byte-identical. Migration reapplication must report no new changes, and existing execution jobs/security repositories must retain passing regression tests. Only the dedicated newly created local test database is migrated. No existing development/production schema or historical records are adopted, reset or edited.

Frontend, deployment configuration, host read-only configuration, signing/refund controls and root dependencies are outside this diff. A future host restart after deploying the new migration registry would require separately applying the approved schema migration; this local implementation is not a deployment procedure or approval.
