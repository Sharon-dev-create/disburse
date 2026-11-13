import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ContractStateBadge from "../src/components/dashboard/ContractStateBadge";
import ExecutionAccountingPanel from "../src/components/dashboard/ExecutionAccountingPanel";
import ExecutionStateBadge from "../src/components/dashboard/ExecutionStateBadge";
import { ExecutionApiError } from "../src/lib/execution-api-shared";

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

describe("execution data presentation", () => {
  it("renders authoritative dashboard accounting with token precision", () => {
    const html = renderToStaticMarkup(
      createElement(ExecutionAccountingPanel, {
        campaignId: "42",
        result: { kind: "success", data: accounting },
      }),
    );
    expect(html).toContain("Campaign accounting");
    expect(html).toContain("900,719,925,474,099.312345");
    expect(html).toContain("wrap.testnet");
    expect(html).toContain("300,000,000,000,000");
  });

  it("renders an unavailable state instead of inventing zero balances", () => {
    const html = renderToStaticMarkup(
      createElement(ExecutionAccountingPanel, {
        campaignId: "42",
        result: {
          kind: "error",
          error: new ExecutionApiError(
            "unavailable",
            "The execution service is unavailable.",
          ),
        },
      }),
    );
    expect(html).toContain("The execution service is unavailable.");
    expect(html).not.toContain("0.00");
  });

  it("renders contract and execution states as distinct statuses", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(ContractStateBadge, { status: "Succeeded" }),
        createElement(ExecutionStateBadge, { state: "SubmissionUnknown" }),
      ),
    );
    expect(html).toContain("Succeeded");
    expect(html).toContain("Submission Unknown");
  });
});
