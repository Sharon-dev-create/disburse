import { trust, type AttemptIdentity, type Verification } from "./evidence.ts";
import {
  collectBundle,
  verifyBundle,
  type EvidencePolicy,
} from "./verifier.ts";
import type { EvidenceRpc } from "./rpc.ts";
import {
  type Claim,
  type Decision,
  type NativeReconciliationRepository,
  type Observation,
} from "./postgres.ts";
const unknown = (reason: string): Verification => ({
  classification: "ManualReview",
  reason,
  transferReceiptId: null,
  callbackReceiptId: null,
  semanticDigest: null,
  trust,
});
/** Independent sources are an operational trust assumption; distinct URLs do not prove independent operators. */
export async function observeAttempt(
  i: AttemptIdentity,
  claim: Pick<Claim, "locator">,
  sources: readonly EvidenceRpc[],
  policy: EvidencePolicy,
  signal?: AbortSignal,
): Promise<Decision> {
  if (
    sources.length !== 2 ||
    new Set(sources.map((s) => s.sourceId)).size !== 2 ||
    new Set(sources.map((s) => s.endpoint)).size !== 2
  )
    throw new Error("Two distinct configured RPC sources required");
  const policySnapshot = structuredClone(policy);
  const observations: Observation[] = await Promise.all(
    sources.map(async (source) => {
      try {
        const bundle = await collectBundle(
          source,
          i,
          claim.locator,
          policySnapshot.limits,
          signal,
        );
        return {
          sourceId: source.sourceId,
          endpoint: source.endpoint,
          bundle,
          verificationPolicy: policySnapshot,
          verification: verifyBundle(i, bundle, policySnapshot),
        };
      } catch (error) {
        return {
          sourceId: source.sourceId,
          endpoint: source.endpoint,
          bundle: null,
          verificationPolicy: policySnapshot,
          verification: unknown(
            error instanceof Error && "kind" in error
              ? `Incomplete observation: ${String(error.kind)}`
              : "RPC timeout, incomplete or unavailable finalized evidence",
          ),
        };
      }
    }),
  );
  const [a, b] = observations.map((o) => o.verification);
  if (!a || !b) throw new Error("Missing verification source");
  const conflicting =
    a.semanticDigest !== null &&
    b.semanticDigest !== null &&
    a.semanticDigest !== b.semanticDigest;
  const result = conflicting
    ? unknown("Conflicting RPC evidence")
    : a.classification !== "ManualReview" &&
        a.classification === b.classification &&
        a.semanticDigest === b.semanticDigest
      ? a
      : unknown(
          "Insufficient, invalid or conflicting evidence; preserve on-chain lock",
        );
  return { ...result, conflicting, observations };
}
/** One explicit bounded read-only pass. Not scheduled, exported by host, or connected to a signer. */
export async function reconcileOnce(
  repo: NativeReconciliationRepository,
  workerId: string,
  sources: readonly EvidenceRpc[],
  policy: EvidencePolicy,
  key?: string,
): Promise<Verification | null> {
  const claim = await repo.claim(workerId, 30000, key);
  if (!claim) return null;
  const decision = await observeAttempt(claim.identity, claim, sources, policy);
  // All network requests finish before the short fenced persistence transaction begins.
  return repo.complete(claim, decision);
}
