import "server-only";

import { headers } from "next/headers";
import {
  ExecutionApiClient,
  ExecutionApiError,
  executionApiBaseUrlFromEnvironment,
} from "./execution-api";
import type { ExecutionDataResult } from "./execution-api-shared";

export async function loadExecutionData<T>(
  request: (client: ExecutionApiClient) => Promise<T>,
): Promise<ExecutionDataResult<T>> {
  try {
    const incomingHeaders = await headers();
    const forwardedHeaders = new Headers();
    const authorization = incomingHeaders.get("authorization");
    const cookie = incomingHeaders.get("cookie");
    if (authorization) forwardedHeaders.set("authorization", authorization);
    if (cookie) forwardedHeaders.set("cookie", cookie);

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
