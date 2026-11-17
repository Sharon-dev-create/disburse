import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type RequestListener } from "node:http";
import { gzipSync } from "node:zlib";
import { BoundedReadHttp } from "../src/near/http.ts";
import { NearRpcError, HttpNearRpcTransport } from "../src/near/rpc.ts";
import {
  graphLimits,
  assertReceiptGraph,
} from "../src/reconciliation/limits.ts";
import { verifyBundle, collectBundle } from "../src/reconciliation/verifier.ts";
import { observeAttempt } from "../src/reconciliation/worker.ts";
import { nativeFixture } from "./support/native-reconciliation.ts";
import { type EvidenceRpc } from "../src/reconciliation/rpc.ts";
const kind = (expected: string) => (e: unknown) =>
  e instanceof NearRpcError && e.kind === expected;
async function server(
  handler: RequestListener,
  work: (url: string) => Promise<void>,
) {
  const http = createServer(handler);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  try {
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
}
for (const length of ["1000", undefined, "1"]) {
  void test(`bounded stream rejects oversized body (content-length ${length ?? "absent"}) and cancels`, async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(40));
        c.enqueue(new Uint8Array(40));
      },
      cancel() {
        cancelled = true;
      },
    });
    const headers = length === undefined ? {} : { "content-length": length };
    const client = new BoundedReadHttp(
      async () => new Response(stream, { headers }),
      { maxBytes: 64, maxAttempts: 1 },
    );
    await assert.rejects(
      client.text("http://fixture", {}),
      kind("resource-limit"),
    );
    assert.ok(cancelled);
  });
}
void test("limits apply to decompressed bytes from a real HTTP stream", async () => {
  await server(
    (_q, r) => {
      const b = gzipSync("x".repeat(1024));
      r.writeHead(200, {
        "content-encoding": "gzip",
        "content-length": String(b.length),
      });
      r.end(b);
    },
    async (url) => {
      await assert.rejects(
        new BoundedReadHttp(fetch, { maxBytes: 128, maxAttempts: 1 }).text(
          url,
          {},
        ),
        kind("resource-limit"),
      );
    },
  );
});
void test(
  "slow trickle has a total response deadline",
  { timeout: 3000 },
  async () => {
    await server(
      (_q, r) => {
        r.writeHead(200);
        r.write("{");
        const interval = setInterval(() => r.write(" "), 5);
        r.on("close", () => clearInterval(interval));
      },
      async (url) => {
        await assert.rejects(
          new BoundedReadHttp(fetch, {
            timeoutMs: 60,
            totalMs: 100,
            maxAttempts: 1,
          }).text(url, {}),
          kind("timeout"),
        );
      },
    );
  },
);
void test("external cancellation interrupts body reading and frees the slot", async () => {
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  let cancelled = false;
  const client = new BoundedReadHttp(
    async () => {
      started();
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("{"));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    },
    { concurrency: 1, maxAttempts: 1 },
  );
  const controller = new AbortController();
  const pending = client.text("http://fixture", {}, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(pending, kind("cancelled"));
  assert.ok(cancelled);
});
void test("deadline works even if injected fetch ignores abort", async () => {
  const client = new BoundedReadHttp(() => new Promise(() => undefined), {
    timeoutMs: 10,
    maxAttempts: 1,
  });
  await assert.rejects(client.text("http://fixture", {}), kind("timeout"));
});
void test("malformed JSON is classified without retrying", async () => {
  let calls = 0;
  const rpc = new HttpNearRpcTransport("http://fixture", 1000, async () => {
    calls++;
    return new Response("{oops");
  });
  await assert.rejects(rpc.getNetworkId(), kind("malformed"));
  assert.equal(calls, 1);
});
for (const status of [429, 503]) {
  void test(`transient HTTP ${status} retries within budget and recovers`, async () => {
    let calls = 0;
    await server(
      (_q, r) => {
        calls++;
        r.writeHead(calls === 1 ? status : 200);
        r.end(calls === 1 ? "" : "{}");
      },
      async (url) => {
        assert.equal(
          await new BoundedReadHttp(fetch, {
            maxAttempts: 2,
            backoffMs: 0,
          }).text(url, {}),
          "{}",
        );
        assert.equal(calls, 2);
      },
    );
  });
}
void test("retry attempts and cumulative duration are bounded", async () => {
  let calls = 0;
  const client = new BoundedReadHttp(
    async () => {
      calls++;
      return new Response("", { status: 503 });
    },
    { maxAttempts: 3, backoffMs: 0 },
  );
  await assert.rejects(client.text("http://fixture", {}), kind("unavailable"));
  assert.equal(calls, 3);
  const deadline = new BoundedReadHttp(
    async () => new Response("", { status: 429 }),
    { maxAttempts: 5, backoffMs: 100, totalMs: 15 },
  );
  await assert.rejects(deadline.text("http://fixture", {}), kind("timeout"));
});
void test("concurrency and queued work are bounded; saturated/aborted requests do not leak slots", async () => {
  let unblock!: () => void;
  const gate = new Promise<void>((r) => {
    unblock = r;
  });
  let active = 0,
    peak = 0;
  const client = new BoundedReadHttp(
    async () => {
      active++;
      peak = Math.max(peak, active);
      await gate;
      active--;
      return new Response("{}");
    },
    { concurrency: 1, maxQueue: 1, maxAttempts: 1 },
  );
  const first = client.text("http://fixture", {});
  const cancel = new AbortController();
  const queued = client.text("http://fixture", {}, cancel.signal);
  await assert.rejects(
    client.text("http://fixture", {}),
    kind("resource-limit"),
  );
  cancel.abort();
  await assert.rejects(queued, kind("cancelled"));
  unblock();
  await first;
  assert.equal(await client.text("http://fixture", {}), "{}");
  assert.equal(peak, 1);
});
void test("JSON nesting is bounded before parsing", async () => {
  await assert.rejects(
    new BoundedReadHttp(async () => new Response("[[[[]]]]"), {
      jsonDepth: 2,
    }).text("http://fixture", {}),
    kind("resource-limit"),
  );
});
void test("receipt node, depth, duplicate and cyclic reference limits fail closed", () => {
  const f = nativeFixture();
  assert.throws(
    () =>
      assertReceiptGraph(
        f.bundle.transaction as Record<string, unknown>,
        graphLimits({ nodes: 1 }),
      ),
    kind("resource-limit"),
  );
  assert.throws(
    () =>
      assertReceiptGraph(
        f.bundle.transaction as Record<string, unknown>,
        graphLimits({ depth: 1 }),
      ),
    kind("resource-limit"),
  );
  const tx = structuredClone(f.bundle.transaction) as {
    receipts_outcome: unknown[];
  };
  tx.receipts_outcome.push(tx.receipts_outcome[0]);
  assert.throws(
    () => assertReceiptGraph(tx, graphLimits()),
    kind("inconsistent"),
  );
  const cyclic = structuredClone(f.bundle.transaction) as {
    receipts_outcome: { id: string; outcome: { receipt_ids: string[] } }[];
  };
  cyclic.receipts_outcome[0]!.outcome.receipt_ids = [
    cyclic.receipts_outcome[0]!.id,
  ];
  assert.throws(
    () => assertReceiptGraph(cyclic, graphLimits()),
    kind("inconsistent"),
  );
  assert.equal(
    verifyBundle(f.identity, f.bundle, { ...f.policy, limits: { nodes: 1 } })
      .classification,
    "ManualReview",
  );
});
void test("incomplete/cancelled traversal cannot become positive evidence or a successful checkpoint", async () => {
  const f = nativeFixture();
  let calls = 0;
  const source: EvidenceRpc = {
    sourceId: "one",
    endpoint: "http://one",
    read: async () => {
      calls++;
      return { chain_id: f.identity.chainId };
    },
  };
  await assert.rejects(
    collectBundle(source, f.identity, f.locator, { calls: 1 }),
    kind("resource-limit"),
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  const observed = await observeAttempt(
    f.identity,
    f,
    [source, { ...source, sourceId: "two", endpoint: "http://two" }],
    f.policy,
    controller.signal,
  );
  assert.equal(observed.classification, "ManualReview");
  assert.ok(observed.observations.every((o) => o.bundle === null));
  assert.equal(calls, 1);
});
void test("mid-response connection failure is never decoded as success", async () => {
  await server(
    (_q, r) => {
      r.writeHead(200);
      r.write('{"result":');
      r.destroy();
    },
    async (url) => {
      await assert.rejects(
        new BoundedReadHttp(fetch, { maxAttempts: 1 }).text(url, {}),
        kind("unavailable"),
      );
    },
  );
});

void test("empty chunk floods remain memory-bounded and hit a monotonic deadline", async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(0));
    },
  });
  await assert.rejects(
    new BoundedReadHttp(async () => new Response(stream), {
      timeoutMs: 10,
      maxAttempts: 1,
      maxBytes: 32,
    }).text("http://fixture", {}),
    kind("timeout"),
  );
});
