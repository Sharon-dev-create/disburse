import type { ContractReader } from "../near/clients.ts";
import type {
  DiscoveryObservation,
  DiscoveryRepository,
  nearPayoutKey,
} from "./repository.ts";
import { nearPayoutKey as payoutKeyFor } from "./repository.ts";

export interface ReconciliationResult {
  readonly checked: number;
  readonly changed: number;
  readonly missing: number;
  readonly failed: number;
}

/** Re-reads current chain views; event order and stored job state never override chain state. */
export class PayoutReconciler {
  constructor(
    private readonly networkId: string,
    private readonly contractId: string,
    private readonly reader: ContractReader,
    private readonly repository: DiscoveryRepository,
  ) {}

  async reconcileKnownPayouts(nowMs: number): Promise<ReconciliationResult> {
    const snapshot = await this.repository.getSnapshot();
    const keys = new Set<string>();
    for (const indexed of snapshot.events.values()) {
      if (indexed.event.kind === "known") {
        keys.add(payoutKeyFor(this.networkId, this.contractId, indexed.event.payoutId));
      }
    }
    for (const key of snapshot.observations.keys()) keys.add(key);

    let changed = 0;
    let missing = 0;
    let failed = 0;
    for (const payoutKey of keys) {
      const tuple = parsePayoutKey(payoutKey);
      if (!tuple || tuple.networkId !== this.networkId || tuple.contractId !== this.contractId) continue;
      const previous = snapshot.observations.get(payoutKey);
      try {
        const payout = await this.reader.getPayout(tuple.payoutId);
        if (!payout) {
          missing += 1;
          await this.repository.recordReconciliation(payoutKey, null, {
            kind: "payout-missing",
            message: "A previously indexed payout is absent from the current contract view",
            createdAtMs: nowMs,
          });
          continue;
        }
        if (payout.id !== tuple.payoutId) {
          failed += 1;
          await this.repository.recordReconciliation(payoutKey, null, {
            kind: "event-view-mismatch",
            message: "Contract view returned a different payout ID",
            createdAtMs: nowMs,
          });
          continue;
        }
        const observation: DiscoveryObservation = {
          networkId: this.networkId,
          contractId: this.contractId,
          payoutId: payout.id,
          campaignId: payout.campaignId,
          contractStatus: payout.status,
          payout,
          observedAtMs: nowMs,
        };
        const statusChanged = previous !== undefined && previous.contractStatus !== payout.status;
        if (statusChanged) changed += 1;
        await this.repository.recordReconciliation(
          payoutKey,
          observation,
          statusChanged
            ? {
                kind: "stale-observation",
                message: `Indexed status ${previous.contractStatus} was refreshed to authoritative status ${payout.status}`,
                createdAtMs: nowMs,
              }
            : null,
        );
      } catch (error) {
        failed += 1;
        await this.repository.recordReconciliation(payoutKey, null, {
          kind: "rpc-error",
          message: error instanceof Error ? error.message : "Unknown NEAR RPC failure",
          createdAtMs: nowMs,
        });
      }
    }
    return { checked: keys.size, changed, missing, failed };
  }
}

function parsePayoutKey(key: string): { networkId: string; contractId: string; payoutId: string } | null {
  try {
    const value: unknown = JSON.parse(key);
    if (
      Array.isArray(value) && value.length === 3 &&
      value.every((item) => typeof item === "string")
    ) {
      return { networkId: value[0] as string, contractId: value[1] as string, payoutId: value[2] as string };
    }
  } catch {
    return null;
  }
  return null;
}
