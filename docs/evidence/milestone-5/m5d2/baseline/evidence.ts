import { createHash } from "node:crypto";

export type JsonRecord = Record<string, unknown>;
export function object(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected evidence object");
  return value as JsonRecord;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 512)
    throw new Error("Invalid evidence text");
  return value;
}
export function uint(value: unknown, bits = 64): string {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Lossy integer evidence");
  const s = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(s) || BigInt(s) >= 1n << BigInt(bits))
    throw new Error("Invalid unsigned evidence integer");
  return s;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const v = object(value);
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(",")}}`;
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
/** Preserve large JSON integer tokens without rewriting digits inside strings. */
export function exactJson(s: string): unknown {
  return JSON.parse(
    s.replace(
      /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (all, quoted: string | undefined, number: string | undefined) => {
        if (quoted || !number || !/^-?\d+$/.test(number)) return all;
        return Number.isSafeInteger(Number(number))
          ? number
          : JSON.stringify(number);
      },
    ),
  );
}
export interface AttemptIdentity {
  readonly chainId: string;
  readonly contractId: string;
  readonly campaignId: string;
  readonly payoutId: string;
  readonly attemptId: string;
  readonly authorizationId: string;
  readonly bindingHash: string;
  readonly tokenId: string;
  readonly recipientId: string;
  readonly amount: string;
  readonly executorId: string;
}
export interface TransactionLocator {
  readonly transactionHash: string;
  readonly senderId: string;
}
export function identityKey(i: AttemptIdentity): string {
  validateIdentity(i);
  return digest([i.chainId, i.contractId, i.payoutId, i.attemptId]);
}
export function validateIdentity(i: AttemptIdentity): void {
  for (const s of [i.chainId, i.authorizationId]) text(s);
  for (const s of [i.contractId, i.tokenId, i.recipientId, i.executorId]) {
    if (
      s.length < 2 ||
      s.length > 64 ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(s)
    )
      throw new Error("Invalid evidence account");
  }
  for (const s of [i.campaignId, i.payoutId, i.attemptId]) uint(s);
  if (
    !/^[a-f0-9]{64}$/.test(i.bindingHash) ||
    BigInt(uint(i.amount, 128)) === 0n ||
    BigInt(i.amount) > 100000n
  )
    throw new Error("Invalid binding/amount");
}
/** Exact Rust NativeBinding V1 Borsh digest, including string lengths and LE integers. */
export function bindingDigest(v: JsonRecord): string {
  const str = (x: unknown) => {
    const b = Buffer.from(text(x));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    return Buffer.concat([len, b]);
  };
  const int = (x: unknown, bytes: number) => {
    let n = BigInt(uint(x, bytes * 8));
    const b = Buffer.alloc(bytes);
    for (let k = 0; k < bytes; k++) {
      b[k] = Number(n & 255n);
      n >>= 8n;
    }
    return b;
  };
  const b = Buffer.concat([
    int(v.version, 1),
    str(v.domain),
    str(v.contract_id),
    str(v.network),
    int(v.campaign_id, 8),
    int(v.payout_id, 8),
    str(v.token_id),
    str(v.recipient_id),
    int(v.amount, 16),
    int(v.decimals, 1),
    str(v.reservation_actor),
    int(v.reserved_at_ns, 8),
    str(v.recipient_evidence_hash),
  ]);
  return createHash("sha256").update(b).digest("hex");
}
export type Classification =
  | "ObservedSucceededSettled"
  | "ObservedSucceededSettlementPending"
  | "ObservedTransferFailed"
  | "ManualReview";
export interface Verification {
  readonly classification: Classification;
  readonly reason: string;
  readonly transferReceiptId: string | null;
  readonly callbackReceiptId: string | null;
  readonly semanticDigest: string | null;
  readonly trust: "TRUSTED_RPC_OBSERVATION_NOT_ON_CHAIN_PROOF";
}
export const trust = "TRUSTED_RPC_OBSERVATION_NOT_ON_CHAIN_PROOF" as const;
