import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function createDemoBearerAuthorizer(
  expectedToken: string,
): (request: IncomingMessage) => boolean {
  const expected = Buffer.from(expectedToken, "utf8");
  return (request) => {
    const header = request.headers.authorization;
    if (typeof header !== "string") return false;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const providedValue = match?.[1];
    if (!providedValue) return false;
    const provided = Buffer.from(providedValue, "utf8");
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  };
}
