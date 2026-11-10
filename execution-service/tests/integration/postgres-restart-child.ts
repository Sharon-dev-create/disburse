import { createTestPostgresSecurityComposition } from "../../src/persistence/postgres-security-composition.ts";
import { makeAuthorizationFixture } from "./postgres-fixtures.ts";

const mode = process.argv[2];
const seed = process.argv[3];
const nowMs = Number(process.argv[4]);
if (
  (mode !== "write" && mode !== "read-consume") ||
  !seed ||
  !Number.isSafeInteger(nowMs)
) {
  throw new Error("Invalid integration restart child arguments");
}

const fixture = makeAuthorizationFixture(seed, { nowMs });
const repositories = await createTestPostgresSecurityComposition();
try {
  if (mode === "write") {
    const stored = await repositories.authorizations.create(
      fixture.authorization,
    );
    await repositories.authorizations.approve(stored.authorizationId, nowMs);
  } else {
    const stored = await repositories.authorizations.get(
      fixture.authorization.authorizationId,
    );
    if (!stored || stored.lifecycle !== "Approved")
      throw new Error(
        "Restarted process did not recover approved authorization",
      );
    await repositories.authorizations.consume(
      stored.authorizationId,
      fixture.request,
      fixture.policy,
      fixture.reservation,
      fixture.quote,
      nowMs,
    );
  }
} finally {
  await repositories.close();
}
