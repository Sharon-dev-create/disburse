import type { PayoutReservedEvent, PayoutSnapshot } from "../domain/payout.ts";
import type { ExecutionJobRecord, JobRepository, Lease } from "../persistence/repository.ts";
import type { ExecutionProviderAdapter } from "../providers/adapter.ts";
import type { SettlementVerifier } from "../verification/verifier.ts";

export interface DiscoverySource {
  /** Consumes finalized/indexed events and supports cursor-based replay after restart. */
  pollReservedPayouts(cursor: string | null): Promise<{
    readonly events: readonly PayoutReservedEvent[];
    readonly nextCursor: string | null;
  }>;
}

export interface ExecutionCoordinator {
  discover(event: PayoutReservedEvent): Promise<ExecutionJobRecord>;
  process(job: ExecutionJobRecord, lease: Lease): Promise<void>;
  reconcile(job: ExecutionJobRecord, lease: Lease): Promise<void>;
}

export interface CoordinatorDependencies {
  readonly discovery: DiscoverySource;
  readonly jobs: JobRepository;
  readonly provider: ExecutionProviderAdapter;
  readonly verifier: SettlementVerifier;
  readonly reservedPayoutReader: (event: PayoutReservedEvent) => Promise<PayoutSnapshot | null>;
}
