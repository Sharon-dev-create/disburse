import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ExecutionApiClient } from "../src/lib/execution-api";
import {
  ExecutionApiError,
  type CampaignDetails,
} from "../src/lib/execution-api-shared";
import CampaignDetailsPanel from "../src/components/dashboard/CampaignDetailsPanel";
const campaign: CampaignDetails = {
  id: "0",
  title: "Disburse Milestone 3 funding verification",
  creatorId: "disburse-topg.testnet",
  tokenId: "usdc.tidepool-sandbox.testnet",
  status: "Approved",
  createdAtNs: "1794722173685400100",
  accounting: {
    campaignId: "0",
    budget: "1000000",
    funded: "1000000",
    reserved: "0",
    spent: "0",
    available: "1000000",
    tokenId: "usdc.tidepool-sandbox.testnet",
    tokenDecimals: 6,
  },
};
function client(value: unknown = campaign, status = 200) {
  return new ExecutionApiClient("http://localhost:4100", {
    fetchImpl: async () =>
      Response.json({ data: { campaign: value } }, { status }),
  });
}
describe("funded campaign details", () => {
  it("validates live response shape and renders actual title, Approved status and exact accounting", async () => {
    const data = await client().getCampaign("0");
    expect(data).toEqual(campaign);
    const html = renderToStaticMarkup(
      <CampaignDetailsPanel
        campaignId="0"
        result={{ kind: "success", data }}
      />,
    );
    for (const text of [
      campaign.title,
      "Approved",
      "Campaign ID",
      "Budget",
      "Funded",
      "Reserved",
      "Spent / settled",
      "Available",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Successfully settled");
    expect(html).not.toContain("Bearer");
  });
  it("handles unauthorized, missing and unavailable without simulated values", async () => {
    for (const status of [401, 404, 503]) {
      let error: ExecutionApiError | undefined;
      try {
        await client(null, status).getCampaign("0");
      } catch (e) {
        error = e as ExecutionApiError;
      }
      const html = renderToStaticMarkup(
        <CampaignDetailsPanel
          campaignId="0"
          result={{ kind: "error", error: error! }}
        />,
      );
      expect(html).toContain("Campaign details unavailable");
      expect(html).not.toContain(campaign.title);
      expect(html).not.toContain("Live contract accounting");
    }
  });
  it("rejects wrong IDs, status, token and inconsistent accounting", async () => {
    for (const value of [
      { ...campaign, id: "1" },
      { ...campaign, status: "Settled" },
      { ...campaign, tokenId: "other.testnet" },
      {
        ...campaign,
        accounting: { ...campaign.accounting, available: "2000000" },
      },
    ])
      await expect(client(value).getCampaign("0")).rejects.toMatchObject({
        kind: "invalid-response",
      });
  });
});
