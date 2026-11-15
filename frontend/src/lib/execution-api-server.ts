import "server-only";

import { headers } from "next/headers";
import { buildExecutionApiForwardHeaders } from "./execution-api-auth";
import {
  ExecutionApiClient,
  executionApiBaseUrlFromEnvironment,
} from "./execution-api";
import {
  ExecutionApiError,
  type ExecutionDataResult,
} from "./execution-api-shared";

export { buildExecutionApiForwardHeaders };

export async function loadExecutionData<T>(
  request: (client: ExecutionApiClient) => Promise<T>,
): Promise<ExecutionDataResult<T>> {
  try {
    const incomingHeaders = await headers();
    const forwardedHeaders = buildExecutionApiForwardHeaders(
      incomingHeaders,
      process.env,
    );

    const client = new ExecutionApiClient(
      executionApiBaseUrlFromEnvironment(process.env),
      { headers: forwardedHeaders },
    );
    return { kind: "success", data: await request(client) };
  } catch (error) {
    if (error instanceof ExecutionApiError) {
      return { kind: "error", error };
    }
    throw error;
  }
}

/** Count is monotonic in the reviewed contract; pick the latest existing numeric ID, never a demo row. */
export async function loadCampaignOverview(requestedId = "") {
  const status = await loadExecutionData((client) =>
    client.getContractStatus(),
  );
  const campaignId =
    requestedId ||
    (status.kind === "success" && BigInt(status.data.campaignCount) > 0n
      ? (BigInt(status.data.campaignCount) - 1n).toString()
      : "");
  const campaign = campaignId
    ? await loadExecutionData((client) => client.getCampaign(campaignId))
    : null;
  return { status, campaignId, campaign };
}
