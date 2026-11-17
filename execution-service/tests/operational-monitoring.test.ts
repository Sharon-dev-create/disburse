import type { NearContractReader } from "../src/near/rpc.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OperationalMonitor,
  operationalReadiness,
} from "../src/operations/monitoring.ts";
void test("operational events discard secrets and arbitrary fields", () => {
  const logs: unknown[] = [];
  const monitor = new OperationalMonitor((v) => logs.push(v));
  monitor.record("rpc_timeout", {
    payoutId: "1",
    network: "testnet",
    authorization: "Bearer SECRET",
    privateKey: "SECRET",
    databaseUrl: "postgres://SECRET",
    error: "SECRET",
  });
  const value = JSON.stringify(logs);
  assert.ok(!value.includes("SECRET"));
  assert.ok(value.includes('"payoutId":"1"'));
});
void test("metric dimensions are fixed event names without correlation IDs", () => {
  const monitor = new OperationalMonitor();
  monitor.record("manual_review", { payoutId: "1" });
  monitor.record("manual_review", { payoutId: "2" });
  assert.deepEqual(
    monitor.metrics().find((v) => v.event === "manual_review"),
    { event: "manual_review", count: 2 },
  );
  assert.ok(!JSON.stringify(monitor.metrics()).includes("payoutId"));
});
void test("healthy dependencies never imply execution readiness", () => {
  const value = operationalReadiness({
    database: true,
    rpc: true,
    discoveryFresh: true,
    reconciliationFresh: true,
  });
  assert.equal(value.executionReady, false);
  assert.equal(value.readOnly, true);
  assert.equal(value.reconciliationReady, true);
});
void test("unavailable or stale dependencies degrade readiness safely", () => {
  const value = operationalReadiness({
    database: false,
    rpc: false,
    discoveryFresh: false,
    reconciliationFresh: false,
  });
  assert.equal(value.processLive, true);
  assert.equal(value.reconciliationReady, false);
  assert.equal(value.executionReady, false);
});

void test("readiness HTTP endpoint requires authentication and never enables execution", async () => {
  const { startExecutionApiServer } = await import("../src/api/http.ts");
  const reader = {
    config: { networkId: "testnet", contractId: "disburse.testnet" },
    verifyNetwork: async () => undefined,
    isPaused: async () => true,
  } as unknown as NearContractReader;
  const server = await startExecutionApiServer(
    {
      reader,
      authorize: (r) => r.headers.authorization === "Bearer local-test",
    },
    { host: "127.0.0.1", port: 0 },
  );
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(url + "/healthz")).status, 200);
    assert.equal((await fetch(url + "/v1/readiness")).status, 401);
    const response = await fetch(url + "/v1/readiness", {
      headers: { authorization: "Bearer local-test" },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: { executionReady: boolean; databaseReady: boolean };
    };
    assert.equal(body.data.executionReady, false);
    assert.equal(body.data.databaseReady, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
