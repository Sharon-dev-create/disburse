import { assertJsonDepth, httpLimits } from "./http.ts";
import { HttpNearRpcTransport } from "./rpc.ts";
import { NearRpcError } from "./errors.ts";
import { validateRecipient } from "../providers/recipient.ts";
import { object, uint, exactJson } from "../reconciliation/evidence.ts";
export const TIDEPOOL = "usdc.tidepool-sandbox.testnet";
export interface InspectionRpc {
  readonly jsonDepthLimit?: number;
  read(
    method: "status" | "query" | "block",
    params: Readonly<Record<string, unknown>> | readonly unknown[],
    signal?: AbortSignal,
  ): Promise<unknown>;
}
export interface Snapshot {
  readonly hash: string;
  readonly height: string;
  readonly network: "testnet";
}
export interface ReadEvidence {
  readonly timestamp: string;
  readonly endpoint: string;
  readonly network: "testnet";
  readonly blockHash: string | null;
  readonly blockHeight: string | null;
  readonly accountId: string | null;
  readonly method: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: unknown;
}
/** Only bounded read-only status/block/query calls. No signer or transaction interface. */
export class TestnetInspector {
  readonly evidence: ReadEvidence[] = [];
  private readonly rpc: InspectionRpc;
  private readonly jsonDepthLimit: number;
  private readonly endpoint: string;
  constructor(
    endpoint: string,
    rpc: InspectionRpc = new HttpNearRpcTransport(endpoint),
  ) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.hash)
      throw new Error("Invalid inspection endpoint");
    this.endpoint = url.origin;
    this.rpc = rpc;
    this.jsonDepthLimit = httpLimits({
      jsonDepth: rpc.jsonDepthLimit ?? 64,
    }).jsonDepth;
  }
  async snapshot(): Promise<Snapshot> {
    const status = object(await this.rpc.read("status", []));
    if (status.chain_id !== "testnet")
      throw new NearRpcError(
        "network-mismatch",
        "Testnet inspection network mismatch",
      );
    const header = object(
      object(await this.rpc.read("block", { finality: "final" })).header,
    );
    const snapshot: Snapshot = {
      hash: codeHash(header.hash),
      height: uint(header.height),
      network: "testnet",
    };
    this.record(null, "status", {}, status, snapshot);
    this.record(null, "block(final)", {}, header, snapshot);
    return snapshot;
  }
  async account(
    accountId: string,
    snapshot: Snapshot,
  ): Promise<Record<string, unknown>> {
    this.accountSyntax(accountId);
    const result = object(
      await this.rpc.read("query", {
        request_type: "view_account",
        account_id: accountId,
        block_id: snapshot.hash,
      }),
    );
    this.pin(result, snapshot);
    codeHash(result.code_hash);
    this.record(accountId, "view_account", {}, result, snapshot);
    return result;
  }
  async view(
    accountId: string,
    method:
      | "ft_metadata"
      | "storage_balance_bounds"
      | "storage_balance_of"
      | "ft_balance_of",
    args: Readonly<Record<string, unknown>>,
    snapshot: Snapshot,
  ): Promise<unknown> {
    this.accountSyntax(accountId);
    if (
      ![
        "ft_metadata",
        "storage_balance_bounds",
        "storage_balance_of",
        "ft_balance_of",
      ].includes(method)
    )
      throw new NearRpcError("rpc", "Unsupported inspection method");
    const result = object(
      await this.rpc.read("query", {
        request_type: "call_function",
        account_id: accountId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        block_id: snapshot.hash,
      }),
    );
    this.pin(result, snapshot);
    if (
      !Array.isArray(result.result) ||
      !result.result.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)
    )
      throw new NearRpcError("malformed", "Invalid token view bytes");
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(result.result),
      );
    } catch {
      throw new NearRpcError("malformed", "Invalid token view encoding");
    }
    assertJsonDepth(decoded, this.jsonDepthLimit);
    let value: unknown;
    try {
      value = exactJson(decoded);
    } catch {
      throw new NearRpcError("malformed", "Invalid token view JSON");
    }
    this.record(accountId, method, args, value, snapshot);
    return value;
  }
  private pin(result: Record<string, unknown>, snapshot: Snapshot) {
    if (
      result.block_hash !== snapshot.hash ||
      uint(result.block_height) !== snapshot.height
    )
      throw new NearRpcError(
        "inconsistent",
        "Token inspection snapshot mismatch",
      );
  }
  private accountSyntax(account: string) {
    if (!validateRecipient("near:testnet", account).valid)
      throw new NearRpcError("malformed", "Invalid NEAR account");
  }
  private record(
    accountId: string | null,
    method: string,
    args: Readonly<Record<string, unknown>>,
    result: unknown,
    snapshot: Snapshot,
  ) {
    if (this.evidence.length >= 32)
      throw new NearRpcError(
        "resource-limit",
        "Inspection batch limit exceeded",
      );
    this.evidence.push({
      timestamp: new Date().toISOString(),
      endpoint: this.endpoint,
      network: "testnet",
      blockHash: snapshot.hash,
      blockHeight: snapshot.height,
      accountId,
      method,
      args,
      result,
    });
  }
}
function codeHash(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
    throw new NearRpcError("malformed", "Invalid code/block identity");
  return value;
}
export function tokenMetadata(value: unknown) {
  const v = object(value);
  if (
    v.spec !== "ft-1.0.0" ||
    v.symbol !== "USDC" ||
    v.decimals !== 6 ||
    typeof v.name !== "string" ||
    !v.name.trim()
  )
    throw new NearRpcError("malformed", "Inconsistent Tidepool metadata");
  return { symbol: v.symbol, decimals: v.decimals, name: v.name, spec: v.spec };
}
export function storageBounds(value: unknown) {
  const v = object(value),
    min = uint(v.min, 128),
    max = v.max === null ? null : uint(v.max, 128);
  if (BigInt(min) <= 0n || (max !== null && BigInt(max) < BigInt(min)))
    throw new NearRpcError("malformed", "Invalid storage bounds");
  return { min, max };
}
export function storageBalance(value: unknown, minimum: string) {
  if (value === null) return null;
  const v = object(value),
    total = uint(v.total, 128),
    available = uint(v.available, 128);
  if (BigInt(total) < BigInt(minimum) || BigInt(available) > BigInt(total))
    throw new NearRpcError("malformed", "Unexpected storage balance");
  return { total, available };
}
export interface OwnershipClaim {
  readonly recipientId: string;
  readonly network: string;
  readonly expiresAtMs: number;
  readonly replayed: boolean;
}
/** Advisory claims are never signature verification. There is deliberately no positive Verified path. */
export function ownershipPrerequisite(
  recipientId: string,
  claim?: OwnershipClaim,
  now = Date.now(),
) {
  const status =
    claim === undefined
      ? "Unverified"
      : claim.recipientId !== recipientId ||
          claim.network !== "near:testnet" ||
          claim.replayed ||
          !Number.isSafeInteger(claim.expiresAtMs)
        ? "VerificationFailed"
        : claim.expiresAtMs <= now
          ? "VerificationExpired"
          : "VerificationPending";
  return {
    status,
    verified: false as const,
    reason: "No integrated authenticated, replay-protected ownership verifier",
  };
}
export interface RecipientPreflightRequest {
  readonly network: string;
  readonly tokenId: string;
  readonly assetId: string;
  readonly expectedTokenCodeHash: string;
  readonly recipientId: string;
  readonly approvedRecipientId: string;
  readonly approvedTokenId: string;
  readonly ownershipClaim?: OwnershipClaim;
}
export async function nativeRecipientPreflight(
  inspector: TestnetInspector,
  request: RecipientPreflightRequest,
) {
  const ownership = ownershipPrerequisite(
    request.recipientId,
    request.ownershipClaim,
  );
  const blockers: string[] = [];
  try {
    if (request.network !== "near:testnet")
      throw new NearRpcError(
        "network-mismatch",
        "Wrong native recipient network",
      );
    if (!validateRecipient(request.network, request.recipientId).valid)
      throw new NearRpcError("malformed", "Invalid recipient account");
    if (
      request.tokenId !== TIDEPOOL ||
      request.assetId !== `nep141:${TIDEPOOL}` ||
      request.approvedTokenId !== request.tokenId
    )
      throw new NearRpcError("inconsistent", "Token identity mismatch");
    if (request.approvedRecipientId !== request.recipientId)
      throw new NearRpcError(
        "inconsistent",
        "Recipient changed after approval",
      );
    const snapshot = await inspector.snapshot();
    const token = await inspector.account(request.tokenId, snapshot);
    if (
      codeHash(request.expectedTokenCodeHash) !== token.code_hash ||
      token.code_hash === "1".repeat(32)
    )
      throw new NearRpcError("inconsistent", "Token code hash mismatch");
    await inspector.account(request.recipientId, snapshot);
    const metadata = tokenMetadata(
      await inspector.view(request.tokenId, "ft_metadata", {}, snapshot),
    );
    const bounds = storageBounds(
      await inspector.view(
        request.tokenId,
        "storage_balance_bounds",
        {},
        snapshot,
      ),
    );
    const storage = storageBalance(
      await inspector.view(
        request.tokenId,
        "storage_balance_of",
        { account_id: request.recipientId },
        snapshot,
      ),
      bounds.min,
    );
    if (storage === null)
      blockers.push("Recipient storage registration missing");
    return {
      technicalReady: blockers.length === 0,
      ownership,
      executionReady: false as const,
      blockers: [
        ...blockers,
        "Recipient ownership and execution authorization not established",
      ],
      snapshot,
      metadata,
      bounds,
      storage,
    };
  } catch (error) {
    blockers.push(
      error instanceof NearRpcError ? error.kind : "invalid-response",
    );
    return {
      technicalReady: false,
      ownership,
      executionReady: false as const,
      blockers,
    };
  }
}
