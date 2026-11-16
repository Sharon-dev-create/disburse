import { readFileSync } from "node:fs";
import type {
  AttemptIdentity,
  TransactionLocator,
} from "../../src/reconciliation/evidence.ts";
import type {
  EvidenceBundle,
  EvidencePolicy,
} from "../../src/reconciliation/verifier.ts";
export interface NativeFixture {
  identity: AttemptIdentity;
  locator: TransactionLocator;
  policy: EvidencePolicy;
  bundle: EvidenceBundle;
}
export function nativeFixture(name = "successful-transfer"): NativeFixture {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../docs/evidence/milestone-5/m5d/sandbox/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as NativeFixture;
}
