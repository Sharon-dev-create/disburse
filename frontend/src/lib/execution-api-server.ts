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
