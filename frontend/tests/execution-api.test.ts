import { describe, expect, it } from "vitest";
import {
  ExecutionApiClient,
  executionApiBaseUrlFromEnvironment,
} from "../src/lib/execution-api";
import {
  ExecutionApiError,
  formatAtomicAmount,
} from "../src/lib/execution-api-shared";

const accounting = {
  campaignId: "42",
  budget: "900719925474099312345",
  funded: "800000000000000000000",
  reserved: "300000000000000000000",
  spent: "200000000000000000000",
  available: "300000000000000000000",
  tokenId: "wrap.testnet",
  tokenDecimals: 6,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function accountingResponse(value: unknown = accounting) {
  return {
    data: { accounting: value },
    meta: { readAt: "2026-11-12T12:00:00.000Z" },
  };
}

describe("execution API client", () => {
  it("reads a validated accounting response without caching or losing integer precision", async () => {
    let requestUrl: URL | undefined;
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestUrl = new URL(input.toString());
      requestInit = init;
      return jsonResponse(accountingResponse());
    };
    const client = new ExecutionApiClient("http://127.0.0.1:4000", {
      fetchImpl,
      headers: { authorization: "Bearer host-token" },
    });

    await expect(client.getCampaignAccounting("42")).resolves.toEqual(
      accounting,
    );
    expect(requestUrl?.pathname).toBe("/v1/campaigns/42/accounting");
    expect(requestInit?.cache).toBe("no-store");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer host-token",
    );
  });

  it("maps non-2xx responses to safe authorization and not-found errors", async () => {
    const forbiddenClient = new ExecutionApiClient(
      "http://127.0.0.1:4000",
      { fetchImpl: async () => jsonResponse({ error: "secret detail" }, 403) },
    );
    await expect(
      forbiddenClient.getCampaignAccounting("42"),
    ).rejects.toMatchObject({
      kind: "forbidden",
      message: "You do not have permission to view this execution data.",
    });

    const missingClient = new ExecutionApiClient("http://127.0.0.1:4000", {
      fetchImpl: async () => jsonResponse({ error: "internal db detail" }, 404),
    });
    await expect(
      missingClient.getCampaignPayout("42", "7"),
    ).rejects.toMatchObject({ kind: "not-found" });
  });

  it("handles network failures and service errors without exposing response bodies", async () => {
    const networkClient = new ExecutionApiClient("http://127.0.0.1:4000", {
      fetchImpl: async () => {
        throw new Error("private connection detail");
      },
    });
    await expect(
      networkClient.getCampaignAccounting("42"),
    ).rejects.toMatchObject({
      kind: "unavailable",
      message: "The execution service is unavailable.",
    });

    const serverClient = new ExecutionApiClient("http://127.0.0.1:4000", {
      fetchImpl: async () =>
        new Response("private database connection string", { status: 500 }),
    });
    await expect(
      serverClient.getCampaignAccounting("42"),
    ).rejects.toMatchObject({
      kind: "unavailable",
      message: "The execution service is unavailable.",
    });
  });

  it("rejects malformed JSON and accounting payloads", async () => {
    const invalidJsonClient = new ExecutionApiClient(
      "http://127.0.0.1:4000",
      { fetchImpl: async () => new Response("{", { status: 200 }) },
    );
    await expect(
      invalidJsonClient.getCampaignAccounting("42"),
    ).rejects.toMatchObject({ kind: "invalid-response" });

    const invalidDataClient = new ExecutionApiClient(
      "http://127.0.0.1:4000",
      {
        fetchImpl: async () =>
          jsonResponse(
            accountingResponse({ ...accounting, available: "300000000000000000001" }),
          ),
      },
    );
    await expect(
      invalidDataClient.getCampaignAccounting("42"),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("validates the server-only base URL configuration", () => {
    expect(() => executionApiBaseUrlFromEnvironment({})).toThrow(
      "The execution service is not configured.",
    );
    expect(() =>
      executionApiBaseUrlFromEnvironment({
        DISBURSE_EXECUTION_API_BASE_URL: "https://user:password@example.com",
      }),
    ).toThrow("The execution service configuration is invalid.");
    expect(() =>
      executionApiBaseUrlFromEnvironment({
        DISBURSE_EXECUTION_API_BASE_URL: "https://example.com/api",
      }),
    ).toThrow(ExecutionApiError);
  });
});

describe("exact token amount formatting", () => {
  it("formats large amounts using decimal strings and bigint arithmetic", () => {
    expect(formatAtomicAmount("900719925474099312345", 6)).toBe(
      "900,719,925,474,099.312345",
    );
    expect(formatAtomicAmount("100000000000000000000", 6)).toBe(
      "100,000,000,000,000",
    );
    expect(formatAtomicAmount("123456789", 0)).toBe("123,456,789");
  });
});

import { buildExecutionApiForwardHeaders } from "../src/lib/execution-api-auth";

describe("frontend execution API authentication behavior", () => {
  it("attaches the server-side demo token when configured and no incoming authorization is present", () => {
    const headers = buildExecutionApiForwardHeaders(new Headers(), {
      DISBURSE_EXECUTION_API_DEMO_TOKEN: "demo-token-123456",
    });
    expect(headers.get("authorization")).toBe("Bearer demo-token-123456");
  });

  it("does not expose or inject a demo token when unconfigured", () => {
    const headers = buildExecutionApiForwardHeaders(new Headers(), {});
    expect(headers.get("authorization")).toBeNull();
  });

  it("prefers an incoming authorization header over the demo token", () => {
    const headers = buildExecutionApiForwardHeaders(
      new Headers({ authorization: "Bearer incoming-token" }),
      { DISBURSE_EXECUTION_API_DEMO_TOKEN: "demo-token-123456" },
    );
    expect(headers.get("authorization")).toBe("Bearer incoming-token");
  });
});
