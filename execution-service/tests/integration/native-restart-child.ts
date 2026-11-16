import { loadPostgresRuntimeConfig } from "../../src/persistence/postgres-config.ts";
import { createPostgresPool } from "../../src/persistence/postgres-pool.ts";
import { NativeReconciliationRepository } from "../../src/reconciliation/postgres.ts";
import { trust } from "../../src/reconciliation/evidence.ts";
const pool = createPostgresPool(loadPostgresRuntimeConfig("test"));
const repo = new NativeReconciliationRepository(pool);
const [mode, key] = process.argv.slice(2);
if (!key) throw new Error("Missing test job");
const c = await repo.claim(
  `child-${process.pid}`,
  mode === "crash" ? 150 : 5000,
  key,
);
if (!c) throw new Error("No restart job");
if (mode === "crash") {
  process.send?.({ claim: c });
  setInterval(() => undefined, 1000);
} else {
  const result = await repo.complete(c, {
    classification: "ManualReview",
    reason:
      "Restart persisted unresolved evidence; no RPC observation invented",
    transferReceiptId: null,
    callbackReceiptId: null,
    semanticDigest: null,
    trust,
    conflicting: false,
    observations: [],
  });
  process.send?.({ result, history: await repo.history(key) });
  await pool.end();
  process.disconnect?.();
}
