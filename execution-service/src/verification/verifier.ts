import type { PayoutSnapshot } from "../domain/payout.js";
import type { ProviderEvidenceClaims } from "../providers/adapter.js";

export type VerificationResult =
  | {
      readonly kind: "verified";
      readonly normalizedEvidence: ProviderEvidenceClaims;
      readonly verifierId: string;
      readonly verificationMethod: string;
      readonly verifiedAt: string;
    }
  | { readonly kind: "insufficient"; readonly reason: string }
  | { readonly kind: "mismatch"; readonly reason: string };

/** Must validate evidence independently; a provider status response is not sufficient. */
export interface SettlementVerifier {
  verify(payout: PayoutSnapshot, claims: ProviderEvidenceClaims): Promise<VerificationResult>;
}
