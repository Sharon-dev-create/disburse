import "server-only";

import { headers } from "next/headers";
import {
  ExecutionApiClient,
  executionApiBaseUrlFromEnvironment,
} from "./execution-api";
import {
  ExecutionApiError,
  type ExecutionDataResult,
} from "./execution-api-shared";

function demoApiAuthorizationHeader(): string | undefined {
  const token = process.env.DISBURSE_EXECUTION_API_DEMO_TOKEN?.trim();
  if (!token) return undefined;
  return `Bearer ${token}`;
}

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

    // Local/demo-only: server-side shared token for execution-service auth.
    // Never expose via NEXT_PUBLIC_*; not production identity authentication.
    if (!forwardedHeaders.has("authorization")) {
      const demoAuthorization = demoApiAuthorizationHeader();
      if (demoAuthorization) {
        forwardedHeaders.set("authorization", demoAuthorization);
      }
    }

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
