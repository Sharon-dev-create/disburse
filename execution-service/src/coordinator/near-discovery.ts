import type { NearEventSource } from "../discovery/source.ts";
import type { ContractReader } from "../near/clients.ts";
import type { DiscoveryRepository } from "../discovery/repository.ts";
import { PayoutDiscoveryProcessor } from "../discovery/processor.ts";
import { PayoutReconciler } from "../discovery/reconciler.ts";

export interface NearDiscoveryConfig {
  readonly networkId: string;
  readonly contractId: string;
  readonly pageSize?: number;
}

/** Wires read-only discovery and reconciliation; it has no execution or signing capability. */
export class NearDiscoveryCoordinator {
  private readonly processor: PayoutDiscoveryProcessor;
  private readonly reconciler: PayoutReconciler;

  constructor(
    config: NearDiscoveryConfig,
    source: NearEventSource,
    reader: ContractReader,
    repository: DiscoveryRepository,
  ) {
    this.processor = new PayoutDiscoveryProcessor(
      config,
      source,
      reader,
      repository,
    );
    this.reconciler = new PayoutReconciler(
      config.networkId,
      config.contractId,
      reader,
      repository,
    );
  }

  discover(nowMs: number) {
    return this.processor.processNextPage(nowMs);
  }

  reconcile(nowMs: number) {
    return this.reconciler.reconcileKnownPayouts(nowMs);
  }
}
