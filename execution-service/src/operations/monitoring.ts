export const OPERATION_EVENTS = [
  "rpc_timeout",
  "rpc_rate_limit",
  "resource_limit",
  "checkpoint_failure",
  "discovery_lag",
  "lease_expiry",
  "fencing_rejection",
  "worker_restart",
  "reconciliation_uncertain",
  "callback_observation",
  "manual_review",
  "configuration_rejection",
] as const;
export type OperationEvent = (typeof OPERATION_EVENTS)[number];
const correlationKeys = [
  "campaignId",
  "payoutId",
  "attemptId",
  "jobId",
  "observationId",
] as const;
/** Only an explicit safe schema is emitted. Raw errors, headers, URLs and configuration are excluded. */
export class OperationalMonitor {
  private readonly counts = new Map<OperationEvent, number>();
  private readonly emit: (event: Readonly<Record<string, unknown>>) => void;
  constructor(
    emit: (event: Readonly<Record<string, unknown>>) => void = () => undefined,
  ) {
    this.emit = emit;
  }
  record(
    event: OperationEvent,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    if (!OPERATION_EVENTS.includes(event))
      throw new Error("Unknown operational event");
    this.counts.set(event, (this.counts.get(event) ?? 0) + 1);
    const safe: Record<string, unknown> = {
      event,
      timestamp: new Date().toISOString(),
    };
    for (const key of correlationKeys) {
      const value = context[key];
      if (
        typeof value === "string" &&
        /^(?:[0-9]{1,39}|[a-f0-9]{64})$/.test(value)
      )
        safe[key] = value;
    }
    if (["testnet", "mainnet", "sandbox"].includes(String(context.network)))
      safe.network = context.network;
    this.emit(Object.freeze(safe));
  }
  metrics() {
    return OPERATION_EVENTS.map((event) => ({
      event,
      count: this.counts.get(event) ?? 0,
    }));
  }
}
/** Pure diagnostics, not an execution-enabling readiness gate. No configuration/secrets exposed. */
export function operationalReadiness(state: {
  readonly database: boolean;
  readonly rpc: boolean;
  readonly discoveryFresh: boolean;
  readonly reconciliationFresh: boolean;
}) {
  return {
    processLive: true,
    databaseReady: state.database,
    rpcReady: state.rpc,
    discoveryReady: state.discoveryFresh,
    reconciliationReady:
      state.database && state.rpc && state.reconciliationFresh,
    executionReady: false,
    readOnly: true,
  } as const;
}
