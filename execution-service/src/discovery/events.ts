import { Buffer } from "node:buffer";

export interface NearEventIdentity {
  readonly networkId: string;
  readonly contractId: string;
  readonly blockHeight: string;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly receiptId: string;
  readonly eventIndex: number;
}

export interface RawNearEvent {
  readonly identity: NearEventIdentity;
  /** Exact log line as returned by the indexing source; bounded before persistence. */
  readonly log: string;
  /** Opaque source cursor that resumes immediately after this event. */
  readonly cursor: string;
}

export type PayoutLifecycleEventName =
  | "payout_reserved"
  | "payout_execution_started"
  | "payout_pending_verification"
  | "payout_execution_failed"
  | "payout_manual_review"
  | "payout_settled"
  | "failed_payout_reservation_released"
  | "manual_review_execution_confirmed"
  | "manual_review_non_settlement_confirmed";

export interface DecodedPayoutEvent {
  readonly kind: "known";
  readonly name: PayoutLifecycleEventName;
  readonly payoutId: string;
  readonly campaignId: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly rawLog: string;
  readonly identity: NearEventIdentity;
  readonly cursor: string;
}

export interface UnknownNearEvent {
  readonly kind: "unknown";
  readonly eventName: string | null;
  readonly reason: string;
  readonly rawLog: string;
  readonly identity: NearEventIdentity;
  readonly cursor: string;
}

export interface MalformedNearEvent {
  readonly kind: "malformed";
  readonly eventName: string | null;
  readonly reason: string;
  readonly rawLog: string;
  readonly identity: NearEventIdentity;
  readonly cursor: string;
}

export type DecodedNearEvent =
  DecodedPayoutEvent | UnknownNearEvent | MalformedNearEvent;

const MAX_RAW_LOG_BYTES = 16_384;
const REQUIRED_FIELDS: Readonly<
  Record<PayoutLifecycleEventName, readonly string[]>
> = {
  payout_reserved: [
    "payout_id",
    "campaign_id",
    "actor_id",
    "input_token_id",
    "input_amount",
    "expected_output_token_id",
    "expected_output_amount",
    "status",
  ],
  payout_execution_started: [
    "payout_id",
    "campaign_id",
    "actor_id",
    "previous_status",
    "new_status",
    "execution_reference",
  ],
  payout_pending_verification: [
    "payout_id",
    "campaign_id",
    "actor_id",
    "previous_status",
    "new_status",
    "execution_reference",
  ],
  payout_execution_failed: [
    "payout_id",
    "campaign_id",
    "actor_id",
    "previous_status",
    "new_status",
    "failure_kind",
    "evidence_reference",
    "reason",
  ],
  payout_manual_review: [
    "payout_id",
    "campaign_id",
    "actor_id",
    "previous_status",
    "new_status",
    "reason",
  ],
  payout_settled: [
    "payout_id",
    "campaign_id",
    "verifier_id",
    "previous_status",
    "new_status",
    "destination_chain_id",
    "provider_id",
    "execution_id",
    "output_token_id",
    "recipient_address",
    "actual_output_amount",
    "evidence_reference",
    "content_hash",
    "input_amount_moved_to_spent",
  ],
  failed_payout_reservation_released: [
    "payout_id",
    "campaign_id",
    "verifier_id",
    "previous_status",
    "new_status",
    "released_input_amount",
    "evidence_reference",
    "resolution_outcome",
  ],
  manual_review_execution_confirmed: [
    "payout_id",
    "campaign_id",
    "verifier_id",
    "previous_status",
    "new_status",
    "execution_reference",
    "evidence_reference",
  ],
  manual_review_non_settlement_confirmed: [
    "payout_id",
    "campaign_id",
    "verifier_id",
    "previous_status",
    "new_status",
    "released_input_amount",
    "evidence_reference",
    "resolution_outcome",
  ],
};

const KNOWN_NAMES = Object.keys(REQUIRED_FIELDS) as PayoutLifecycleEventName[];

/** Strict decoder for the exact `disburse` NEP-297 v1 event envelope emitted by src/lib.rs. */
export function decodeNearEvent(raw: RawNearEvent): DecodedNearEvent {
  const rawLog = Buffer.from(raw.log, "utf8")
    .subarray(0, MAX_RAW_LOG_BYTES)
    .toString("utf8");
  if (Buffer.byteLength(raw.log, "utf8") > MAX_RAW_LOG_BYTES) {
    return malformed(
      raw,
      null,
      "Event log exceeds the configured size limit",
      rawLog,
    );
  }
  const prefix = "EVENT_JSON:";
  if (!raw.log.startsWith(prefix)) {
    return unknown(raw, null, "Log is not a NEP-297 event", rawLog);
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(
      preserveEventIds(raw.log.slice(prefix.length)),
    ) as unknown;
  } catch {
    return malformed(raw, null, "Event log contains malformed JSON", rawLog);
  }
  if (!isRecord(envelope))
    return malformed(raw, null, "Event envelope is not an object", rawLog);
  const eventName = typeof envelope.event === "string" ? envelope.event : null;
  if (envelope.standard !== "disburse") {
    return unknown(raw, eventName, "Unsupported event standard", rawLog);
  }
  if (envelope.version !== "1.0.0") {
    return unknown(
      raw,
      eventName,
      "Unsupported disburse event version",
      rawLog,
    );
  }
  if (
    !eventName ||
    !KNOWN_NAMES.includes(eventName as PayoutLifecycleEventName)
  ) {
    return unknown(raw, eventName, "Unknown disburse event type", rawLog);
  }
  if (
    !Array.isArray(envelope.data) ||
    envelope.data.length !== 1 ||
    !isRecord(envelope.data[0])
  ) {
    return malformed(
      raw,
      eventName,
      "Known event must contain exactly one data object",
      rawLog,
    );
  }
  const fields = envelope.data[0];
  for (const key of REQUIRED_FIELDS[eventName as PayoutLifecycleEventName]) {
    if (!(key in fields))
      return malformed(
        raw,
        eventName,
        `Missing required field: ${key}`,
        rawLog,
      );
  }
  const payoutId = canonicalU64(fields.payout_id);
  const campaignId = canonicalU64(fields.campaign_id);
  if (payoutId === null || campaignId === null) {
    return malformed(raw, eventName, "Invalid payout or campaign ID", rawLog);
  }
  if (eventName === "payout_reserved") {
    if (
      fields.status !== "Reserved" ||
      !isUnsigned(fields.input_amount) ||
      !isUnsigned(fields.expected_output_amount)
    ) {
      return malformed(
        raw,
        eventName,
        "Invalid payout reservation fields",
        rawLog,
      );
    }
  }
  const stringFields = [
    "input_token_id",
    "expected_output_token_id",
    "actor_id",
    "verifier_id",
    "previous_status",
    "new_status",
    "execution_reference",
    "evidence_reference",
    "reason",
    "failure_kind",
    "resolution_outcome",
    "destination_chain_id",
    "provider_id",
    "execution_id",
    "output_token_id",
    "recipient_address",
    "content_hash",
  ];
  for (const key of stringFields) {
    if (
      key in fields &&
      fields[key] !== null &&
      (typeof fields[key] !== "string" || !fields[key].trim())
    ) {
      return malformed(raw, eventName, `Invalid event field: ${key}`, rawLog);
    }
  }
  const statuses = [
    "Created",
    "Authorized",
    "Reserved",
    "Executing",
    "PendingVerification",
    "Succeeded",
    "Failed",
    "RefundPending",
    "Refunded",
    "ManualReview",
    "ReservationReleased",
  ];
  for (const key of ["previous_status", "new_status"]) {
    if (
      key in fields &&
      (typeof fields[key] !== "string" || !statuses.includes(fields[key]))
    ) {
      return malformed(raw, eventName, `Invalid payout status: ${key}`, rawLog);
    }
  }
  const expectedStatus: Partial<Record<PayoutLifecycleEventName, string>> = {
    payout_reserved: "Reserved",
    payout_execution_started: "Executing",
    payout_pending_verification: "PendingVerification",
    payout_execution_failed: "Failed",
    payout_manual_review: "ManualReview",
    payout_settled: "Succeeded",
    failed_payout_reservation_released: "ReservationReleased",
    manual_review_execution_confirmed: "PendingVerification",
    manual_review_non_settlement_confirmed: "ReservationReleased",
  };
  if (
    "new_status" in fields &&
    fields.new_status !== expectedStatus[eventName as PayoutLifecycleEventName]
  ) {
    return malformed(
      raw,
      eventName,
      "Event new_status conflicts with its event type",
      rawLog,
    );
  }
  if (
    "failure_kind" in fields &&
    !["RejectedBeforeSubmission", "TransactionReverted"].includes(
      String(fields.failure_kind),
    )
  ) {
    return malformed(
      raw,
      eventName,
      "Unsupported execution failure kind",
      rawLog,
    );
  }
  if (
    "resolution_outcome" in fields &&
    fields.resolution_outcome !== "NonSettlementConfirmed"
  ) {
    return malformed(
      raw,
      eventName,
      "Unsupported recovery resolution outcome",
      rawLog,
    );
  }
  for (const key of [
    "input_amount",
    "expected_output_amount",
    "actual_output_amount",
    "input_amount_moved_to_spent",
    "released_input_amount",
  ]) {
    if (key in fields && !isUnsigned(fields[key]))
      return malformed(raw, eventName, `Invalid amount: ${key}`, rawLog);
  }
  return {
    kind: "known",
    name: eventName as PayoutLifecycleEventName,
    payoutId,
    campaignId,
    fields,
    rawLog,
    identity: raw.identity,
    cursor: raw.cursor,
  };
}

function canonicalU64(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const text = String(value);
  if (!/^\d+$/.test(text) || BigInt(text) > 18_446_744_073_709_551_615n)
    return null;
  return BigInt(text).toString();
}

function isUnsigned(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d+$/.test(value) &&
    BigInt(value) <= (1n << 128n) - 1n
  );
}

function preserveEventIds(json: string): string {
  return json.replace(
    /("(?:payout_id|campaign_id)"\s*:\s*)(\d+)(?=\s*[,}])/g,
    (_match, prefix: string, digits: string) => `${prefix}"${digits}"`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknown(
  raw: RawNearEvent,
  eventName: string | null,
  reason: string,
  rawLog: string,
): UnknownNearEvent {
  return {
    kind: "unknown",
    eventName,
    reason,
    rawLog,
    identity: raw.identity,
    cursor: raw.cursor,
  };
}

function malformed(
  raw: RawNearEvent,
  eventName: string | null,
  reason: string,
  rawLog: string,
): MalformedNearEvent {
  return {
    kind: "malformed",
    eventName,
    reason,
    rawLog,
    identity: raw.identity,
    cursor: raw.cursor,
  };
}
