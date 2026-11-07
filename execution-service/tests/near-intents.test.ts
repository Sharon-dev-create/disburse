import assert from "node:assert/strict";
import test from "node:test";

import {
  NearIntentsClient,
  NearIntentsError,
  type NearIntentsQuoteRequest,
} from "../src/providers/near-intents/client.ts";
import {
  NearIntentsQuoteAdapter,
  type NearIntentsAdapterConfig,
} from "../src/providers/near-intents/adapter.ts";
import {
  canTransitionQuote,
  isFreshQuote,
  type QuoteIntent,
} from "../src/providers/quote.ts";

const now = Date.parse("2026-11-07T12:00:00.000Z");

void test("1Click client sends authenticated preview-only exact-output quote", async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const client = new NearIntentsClient({
    apiKey: "test-api-key",
    requestTimeoutMs: 1000,
    fetchImpl: async (input, init) => {
      sent = { url: String(input), init: init ?? {} };
      return jsonResponse(validResponse());
    },
  });
  await client.requestQuote(request());
  assert.equal(sent?.url, "https://1click.chaindefuser.com/v0/quote");
  assert.equal(sent?.init.method, "POST");
  assert.equal(
    new Headers(sent?.init.headers).get("x-api-key"),
    "test-api-key",
  );
  assert.equal(new Headers(sent?.init.headers).get("authorization"), null);
  const body = JSON.parse(String(sent?.init.body)) as NearIntentsQuoteRequest;
  assert.equal(body.dry, true);
  assert.equal(body.swapType, "EXACT_OUTPUT");
  assert.equal(body.amount, "300");
  assert.equal(body.recipientType, "DESTINATION_CHAIN");
});

void test("client normalizes authentication, validation, rate limit, 5xx and network failures", async () => {
  for (const [status, kind, headers] of [
    [400, "permanent-validation", undefined],
    [401, "configuration-or-authentication", undefined],
    [403, "configuration-or-authentication", undefined],
    [404, "unsupported-capability", undefined],
    [429, "rate-limited", { "retry-after": "7" }],
    [503, "temporary-provider", undefined],
  ] as const) {
    const client = new NearIntentsClient({
      apiKey: "test-key",
      requestTimeoutMs: 100,
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: "safe provider error" }), {
          status,
          ...(headers === undefined ? {} : { headers }),
        }),
    });
    await assert.rejects(client.requestQuote(request()), (error: unknown) => {
      assert.ok(error instanceof NearIntentsError);
      assert.equal(error.kind, kind);
      if (status === 429) assert.equal(error.retryAfterSeconds, 7);
      return true;
    });
  }
  const networkClient = new NearIntentsClient({
    apiKey: "test-key",
    requestTimeoutMs: 100,
    fetchImpl: async () => {
      throw new TypeError("network down");
    },
  });
  await assert.rejects(
    networkClient.requestQuote(request()),
    (error: unknown) => {
      assert.ok(error instanceof NearIntentsError);
      assert.equal(error.kind, "ambiguous-outcome");
      assert.equal(error.code, "network-failure");
      return true;
    },
  );
});

void test("client rejects missing credentials, malformed JSON and malformed object response", async () => {
  assert.throws(
    () =>
      new NearIntentsClient({
        apiKey: "replace-with-key",
        requestTimeoutMs: 10,
      }),
    (error: unknown) =>
      error instanceof NearIntentsError &&
      error.kind === "configuration-or-authentication",
  );
  const malformedJson = new NearIntentsClient({
    apiKey: "key",
    requestTimeoutMs: 100,
    fetchImpl: async () => new Response("not-json"),
  });
  await assert.rejects(malformedJson.requestQuote(request()), /malformed JSON/);
  const malformedObject = new NearIntentsClient({
    apiKey: "key",
    requestTimeoutMs: 100,
    fetchImpl: async () => new Response(JSON.stringify([])),
  });
  await assert.rejects(
    malformedObject.requestQuote(request()),
    /must be an object/,
  );
});

void test("timed-out preview is ambiguous but cannot become an execution result", async () => {
  const timeoutError = new Error("timed out");
  timeoutError.name = "TimeoutError";
  const client = new NearIntentsClient({
    apiKey: "test-key",
    requestTimeoutMs: 1,
    fetchImpl: async () => {
      throw timeoutError;
    },
  });
  await assert.rejects(client.requestQuote(request()), (error: unknown) => {
    assert.ok(error instanceof NearIntentsError);
    assert.equal(error.kind, "ambiguous-outcome");
    assert.equal(error.code, "request-timeout");
    return true;
  });
});

void test("valid exact-output quote maps to provider-neutral opportunity using atomic strings", async () => {
  const opportunity = await adapter().quote(intent());
  assert.equal(opportunity.providerId, "near-intents-1click");
  assert.equal(opportunity.sourceTokenId, "token:near-usdc");
  assert.equal(opportunity.quotedInputAtomicAmount, "250");
  assert.equal(opportunity.maximumInputAtomicAmount, null);
  assert.equal(opportunity.expectedOutputAtomicAmount, "300");
  assert.equal(opportunity.minimumOutputAtomicAmount, "300");
  assert.equal(opportunity.recipientAddress, "alice.destination");
  assert.equal(opportunity.quoteReference, "quote-reference-1");
  assert.equal(
    opportunity.providerMetadata.quoteSignature,
    "mock-signature-not-verified",
  );
  assert.equal(opportunity.expiresAt, null);
  assert.equal(opportunity.freshUntil, "2026-11-07T12:00:30.000Z");
  assert.deepEqual(opportunity.fees, [
    { kind: "origin-refund", tokenId: "token:near-usdc", atomicAmount: "2" },
    {
      kind: "destination-withdrawal",
      tokenId: "token:eth-usdc",
      atomicAmount: "1",
    },
  ]);
  assert.equal(opportunity.estimatedExecutionSeconds, 90);
  assert.equal(isFreshQuote(opportunity, now), true);
  assert.equal(isFreshQuote(opportunity, now + 30_000), false);
});

void test("rejects quotes that change source, destination, recipient, or refund route", async () => {
  for (const key of [
    "originAsset",
    "destinationAsset",
    "recipient",
    "refundTo",
  ] as const) {
    const response = validResponse();
    const echo = response.quoteRequest as Record<string, unknown>;
    echo[key] = "attacker-chosen-value";
    await assert.rejects(
      adapter(response).quote(intent()),
      (error: unknown) =>
        error instanceof NearIntentsError && error.code === "route-mismatch",
    );
  }
});

void test("rejects input over reservation, non-exact or insufficient output, and malformed fee data", async () => {
  const overBudget = validResponse();
  (overBudget.quote as Record<string, unknown>).amountIn = "1001";
  await assert.rejects(
    adapter(overBudget).quote(intent()),
    /exceeds the reserved/,
  );

  const wrongOutput = validResponse();
  (wrongOutput.quote as Record<string, unknown>).amountOut = "301";
  await assert.rejects(adapter(wrongOutput).quote(intent()), /does not match/);

  const tooLittleMin = validResponse();
  (tooLittleMin.quote as Record<string, unknown>).minAmountOut = "299";
  await assert.rejects(
    adapter(tooLittleMin).quote(intent()),
    /below the payout/,
  );

  const badFee = validResponse();
  (badFee.quote as Record<string, unknown>).withdrawFee = "1.5";
  await assert.rejects(
    adapter(badFee).quote(intent()),
    /atomic integer string/,
  );
});

void test("rejects missing IDs, invalid amounts, bad metadata, unsupported routes and invalid decimals", async () => {
  const noId = validResponse();
  noId.correlationId = "";
  await assert.rejects(adapter(noId).quote(intent()), /correlation ID/);

  const badAmount = validResponse();
  (badAmount.quote as Record<string, unknown>).amountIn =
    "999999999999999999999999999999999999999";
  await assert.rejects(adapter(badAmount).quote(intent()), /u128 range/);

  const baseIntent = intent();
  const unknownNetwork = { ...baseIntent, destinationNetworkId: "chain:other" };
  await assert.rejects(adapter().quote(unknownNetwork), /not configured/);

  const badDecimals = {
    ...baseIntent,
    input: { ...baseIntent.input, decimals: 5 },
  };
  await assert.rejects(
    adapter().quote(badDecimals),
    /trusted asset configuration/,
  );

  assert.throws(
    () => adapter(undefined, { slippageToleranceBps: 10_001 }),
    /between 0 and 10000/,
  );
});

void test("duplicate dry quote responses are observations only and do not mutate payout intent", async () => {
  const payout = intent();
  const before = structuredClone(payout);
  const first = await adapter().quote(payout);
  const second = await adapter().quote(payout);
  assert.equal(first.quoteReference, second.quoteReference);
  assert.deepEqual(payout, before);
  assert.equal(payout.expectedOutput.atomicAmount, "300");
  assert.equal(payout.input.atomicAmount, "1000");
});

void test("rejects stale provider timestamps as expired previews", async () => {
  const stale = validResponse();
  stale.timestamp = "2026-11-07T11:59:00.000Z";
  await assert.rejects(adapter(stale).quote(intent()), (error: unknown) => {
    assert.ok(error instanceof NearIntentsError);
    assert.equal(error.kind, "expired-quote");
    return true;
  });
});

void test("quote lifecycle stays separate from payout execution states", () => {
  assert.equal(canTransitionQuote("Requested", "Received"), true);
  assert.equal(canTransitionQuote("Received", "Validated"), true);
  assert.equal(canTransitionQuote("Validated", "Expired"), true);
  assert.equal(canTransitionQuote("Requested", "Validated"), false);
  assert.equal(canTransitionQuote("Rejected", "Validated"), false);
});

function adapter(
  response = validResponse(),
  overrides: Partial<
    Pick<NearIntentsAdapterConfig, "maxQuoteAgeMs" | "slippageToleranceBps">
  > = {},
) {
  const client = new NearIntentsClient({
    apiKey: "test-api-key",
    requestTimeoutMs: 1000,
    fetchImpl: async () => jsonResponse(response),
  });
  return new NearIntentsQuoteAdapter({
    client,
    assets: [
      {
        assetId: "nep141:wrap.near",
        networkId: "near:mainnet",
        tokenId: "token:near-usdc",
        decimals: 6,
      },
      {
        assetId: "nep141:eth-usdc",
        networkId: "eth:mainnet",
        tokenId: "token:eth-usdc",
        decimals: 6,
      },
    ],
    providerNetworkByDisburseNetwork: {
      "near:mainnet": "near",
      "eth:mainnet": "eth",
    },
    maxQuoteAgeMs: overrides.maxQuoteAgeMs ?? 30_000,
    slippageToleranceBps: overrides.slippageToleranceBps ?? 0,
    now: () => now,
  });
}

function intent(): QuoteIntent {
  return {
    sourceNetworkId: "near:mainnet",
    input: { tokenId: "token:near-usdc", atomicAmount: "1000", decimals: 6 },
    destinationNetworkId: "eth:mainnet",
    recipientAddress: "alice.destination",
    expectedOutput: {
      tokenId: "token:eth-usdc",
      atomicAmount: "300",
      decimals: 6,
    },
    refundAddress: "treasury.near",
    deadline: "2026-11-07T12:10:00.000Z",
  };
}

function request(): NearIntentsQuoteRequest {
  return {
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 0,
    originAsset: "nep141:wrap.near",
    depositType: "ORIGIN_CHAIN",
    destinationAsset: "nep141:eth-usdc",
    amount: "300",
    refundTo: "treasury.near",
    refundType: "ORIGIN_CHAIN",
    recipient: "alice.destination",
    recipientType: "DESTINATION_CHAIN",
    deadline: "2026-11-07T12:10:00.000Z",
  };
}

function validResponse(): {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: Record<string, unknown>;
  quote: Record<string, unknown>;
} {
  return {
    correlationId: "quote-reference-1",
    timestamp: "2026-11-07T12:00:00.000Z",
    signature: "mock-signature-not-verified",
    quoteRequest: {
      ...request(),
    },
    quote: {
      amountIn: "250",
      minAmountIn: "250",
      amountOut: "300",
      minAmountOut: "300",
      refundFee: "2",
      withdrawFee: "1",
      timeEstimate: 90,
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
