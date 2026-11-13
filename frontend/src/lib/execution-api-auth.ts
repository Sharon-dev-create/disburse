export function buildExecutionApiForwardHeaders(
  incomingHeaders: Headers,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Headers {
  const forwardedHeaders = new Headers();
  const authorization = incomingHeaders.get("authorization");
  const cookie = incomingHeaders.get("cookie");
  if (authorization) forwardedHeaders.set("authorization", authorization);
  if (cookie) forwardedHeaders.set("cookie", cookie);

  // Local/demo-only: server-side shared token for execution-service auth.
  // Never expose via NEXT_PUBLIC_*; not production identity authentication.
  if (!forwardedHeaders.has("authorization")) {
    const token = environment.DISBURSE_EXECUTION_API_DEMO_TOKEN?.trim();
    if (token) {
      forwardedHeaders.set("authorization", `Bearer ${token}`);
    }
  }

  return forwardedHeaders;
}
