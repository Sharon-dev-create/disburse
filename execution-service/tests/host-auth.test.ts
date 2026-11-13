import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import { createDemoBearerAuthorizer } from "../src/host/auth.ts";

function request(authorization?: string): IncomingMessage {
  return {
    headers: authorization ? { authorization } : {},
  } as IncomingMessage;
}

void test("demo bearer authorizer accepts the configured token", () => {
  const authorize = createDemoBearerAuthorizer("demo-token-123456");
  assert.equal(authorize(request("Bearer demo-token-123456")), true);
  assert.equal(authorize(request("bearer demo-token-123456")), true);
});

void test("demo bearer authorizer rejects missing, malformed, and incorrect credentials", () => {
  const authorize = createDemoBearerAuthorizer("demo-token-123456");
  assert.equal(authorize(request()), false);
  assert.equal(authorize(request("Basic demo-token-123456")), false);
  assert.equal(authorize(request("Bearer")), false);
  assert.equal(authorize(request("Bearer wrong-token-123456")), false);
  assert.equal(authorize(request("Bearer demo-token-123456-extra")), false);
});
