import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExecutionApiClient } from "../src/lib/execution-api";
import {
  ExecutionApiError,
  type ContractStatus,
} from "../src/lib/execution-api-shared";
import LiveContractOverview from "../src/components/dashboard/LiveContractOverview";
import CampaignCreation from "../src/app/dashboard/campaigns/new/layout";
import PayoutCreation from "../src/app/dashboard/payouts/new/layout";
import RecipientCreation from "../src/app/dashboard/recipients/new/layout";
const status: ContractStatus = {
  networkId: "testnet",
  contractId: "disburse-test-contract.testnet",
  codeHash: "CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf",
  ownerId: "disburse-topg.testnet",
  paused: false,
  campaignCount: "0",
  payoutCount: "0",
  payoutCountSource: "inferred_from_zero_campaigns",
  readOnly: true,
};
describe("live contract integration", () => {
  it("validates and renders API shape, zero counts and disabled actions", async () => {
    const client = new ExecutionApiClient("http://localhost:4000", {
      fetchImpl: async () => new Response(JSON.stringify({ data: status })),
    });
    const data = await client.getContractStatus();
    const html = renderToStaticMarkup(
      <LiveContractOverview result={{ kind: "success", data }} />,
    );
    expect(html).toContain(status.contractId);
    expect(html).toContain("Active (unpaused)");
    expect(html).toContain("No campaigns currently exist");
    expect(html).toContain("No on-chain payout records");
    expect(html.match(/disabled=""/g)).toHaveLength(5);
    expect(html).not.toContain("Bearer");
  });
  it("does not fabricate empty records when unauthorized or unavailable", async () => {
    for (const code of [401, 503]) {
      const client = new ExecutionApiClient("http://localhost:4000", {
        fetchImpl: async () => new Response("{}", { status: code }),
      });
      let error: ExecutionApiError | undefined;
      try {
        await client.getContractStatus();
      } catch (e) {
        error = e as ExecutionApiError;
      }
      expect(error?.kind).toBe(code === 401 ? "unauthorized" : "unavailable");
      const html = renderToStaticMarkup(
        <LiveContractOverview result={{ kind: "error", error: error! }} />,
      );
      expect(html).toContain("Contract data unavailable");
      expect(html).not.toContain("No campaigns currently exist");
    }
  });
  it("rejects inconsistent or malformed count and identity responses", async () => {
    for (const data of [
      { ...status, campaignCount: "1", payoutCount: "0" },
      { ...status, paused: "false" },
      { ...status, codeHash: null },
      { ...status, campaignCount: 0 },
    ]) {
      const client = new ExecutionApiClient("http://localhost:4000", {
        fetchImpl: async () => new Response(JSON.stringify({ data })),
      });
      await expect(client.getContractStatus()).rejects.toMatchObject({
        kind: "invalid-response",
      });
    }
  });
  it("creation routes withhold simulated success forms", () => {
    for (const View of [CampaignCreation, PayoutCreation, RecipientCreation]) {
      const html = renderToStaticMarkup(<View />);
      expect(html).toContain("Creation unavailable");
      expect(html).not.toContain("<form");
    }
  });
});
