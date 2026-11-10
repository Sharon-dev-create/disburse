import { createTestPostgresSecurityComposition } from "../../src/persistence/postgres-security-composition.ts";
import { makeAuthorizationFixture } from "./postgres-fixtures.ts";
import { fingerprintRefundPolicy } from "../../src/providers/refund.ts";

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
const revokedFixture = makeAuthorizationFixture(`${seed}-revoked`, { nowMs });
const repositories = await createTestPostgresSecurityComposition();
try {
  if (mode === "write") {
    const stored = await repositories.authorizations.create(
      fixture.authorization,
    );
    await repositories.authorizations.approve(stored.authorizationId, nowMs);
    const revoked = await repositories.authorizations.create(
      revokedFixture.authorization,
    );
    await repositories.authorizations.revoke(revoked.authorizationId, nowMs);
    await repositories.refundPolicies.approve(fixture.refundPolicy);
  } else {
    const stored = await repositories.authorizations.get(
      fixture.authorization.authorizationId,
    );
    if (!stored || stored.lifecycle !== "Approved")
      throw new Error(
        "Restarted process did not recover approved authorization",
      );
    if (stored.authorizationHash !== fixture.authorization.authorizationHash)
      throw new Error("Restarted authorization fields or fingerprint changed");
    const refund = await repositories.refundPolicies.get(
      fixture.refundPolicy.campaignId,
      fixture.refundPolicy.payoutId,
    );
    if (
      !refund ||
      refund.fingerprint !== fingerprintRefundPolicy(fixture.refundPolicy)
    )
      throw new Error("Restarted process did not recover refund policy");
    await repositories.authorizations.consume(
      stored.authorizationId,
      fixture.request,
      fixture.policy,
      fixture.reservation,
      fixture.quote,
      nowMs,
    );
    let reusedConsumed = false;
    try {
      await repositories.authorizations.consume(
        stored.authorizationId,
        fixture.request,
        fixture.policy,
        fixture.reservation,
        fixture.quote,
        nowMs,
      );
      reusedConsumed = true;
    } catch {
      // Consumed authorizations remain unusable across calls.
    }
    if (reusedConsumed)
      throw new Error("Consumed authorization was reusable after restart");
    const revoked = await repositories.authorizations.get(
      revokedFixture.authorization.authorizationId,
    );
    if (!revoked || revoked.lifecycle !== "Revoked")
      throw new Error("Revoked authorization was not durable across restart");
    let reusedRevoked = false;
    try {
      await repositories.authorizations.consume(
        revoked.authorizationId,
        revokedFixture.request,
        revokedFixture.policy,
        revokedFixture.reservation,
        revokedFixture.quote,
        nowMs,
      );
      reusedRevoked = true;
    } catch {
      // Revoked authorization must stay unusable after restart.
    }
    if (reusedRevoked)
      throw new Error("Revoked authorization became consumable after restart");
  }
} finally {
  await repositories.close();
}
