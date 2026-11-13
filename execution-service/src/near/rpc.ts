import { Buffer } from "node:buffer";
import type { PayoutId } from "../domain/payout.ts";
import type {
  CampaignAccountingSnapshot,
  ContractReader,
  NearPayoutView,
} from "./clients.ts";

export interface NearRpcTransport {
  viewFunction(
    contractId: string,
    methodName: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  getNetworkId?(): Promise<string>;
}

export class NearRpcError extends Error {
  readonly retryable: boolean;
  readonly kind:
    | "timeout"
    | "unavailable"
    | "rate-limited"
    | "rpc"
    | "network-mismatch"
    | "malformed";

  constructor(
    kind:
      | "timeout"
      | "unavailable"
      | "rate-limited"
      | "rpc"
      | "network-mismatch"
      | "malformed",
    message: string,
  ) {
    super(message);
    this.name = "NearRpcError";
    this.kind = kind;
    this.retryable = ["timeout", "unavailable", "rate-limited"].includes(kind);
  }
}

/** JSON-RPC transport for read-only NEAR `call_function` requests. */
export class HttpNearRpcTransport implements NearRpcTransport {
  private requestId = 0;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    endpoint: string,
    timeoutMs = 10_000,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("NEAR RPC endpoint must use HTTP or HTTPS");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("RPC timeout must be a positive safe integer");
    }
  }

  async viewFunction(
    contractId: string,
    methodName: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.requestId,
          method: "query",
          params: {
            request_type: "call_function",
            finality: "final",
            account_id: contractId,
            method_name: methodName,
            args_base64: Buffer.from(serializeNearArgs(args)).toString(
              "base64",
            ),
          },
        }),
      });
      if (response.status === 429) {
        throw new NearRpcError(
          "rate-limited",
          "NEAR RPC rate limit was reached",
        );
      }
      if (!response.ok) {
        throw new NearRpcError(
          "unavailable",
          `NEAR RPC returned HTTP ${response.status}`,
        );
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new NearRpcError("malformed", "NEAR RPC returned invalid JSON");
      }
      if (!isRecord(body)) {
        throw new NearRpcError(
          "malformed",
          "NEAR RPC response is not an object",
        );
      }
      if ("error" in body) {
        throw new NearRpcError("rpc", "NEAR RPC returned a query error");
      }
      const result = body.result;
      if (!isRecord(result) || !Array.isArray(result.result)) {
        throw new NearRpcError(
          "malformed",
          "NEAR RPC response has no result bytes",
        );
      }
      const bytes = result.result;
      if (
        !bytes.every(
          (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
        )
      ) {
        throw new NearRpcError(
          "malformed",
          "NEAR RPC result contains invalid bytes",
        );
      }
      const json = Buffer.from(bytes).toString("utf8");
      try {
        return JSON.parse(preserveU64Lexemes(json)) as unknown;
      } catch {
        throw new NearRpcError(
          "malformed",
          "Contract view returned malformed JSON",
        );
      }
    } catch (error) {
      if (error instanceof NearRpcError) throw error;
      if (controller.signal.aborted) {
        throw new NearRpcError("timeout", "NEAR RPC request timed out");
      }
      throw new NearRpcError("unavailable", "NEAR RPC request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  async getNetworkId(): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.requestId,
          method: "status",
          params: [],
        }),
      });
      if (response.status === 429)
        throw new NearRpcError(
          "rate-limited",
          "NEAR RPC rate limit was reached",
        );
      if (!response.ok)
        throw new NearRpcError(
          "unavailable",
          `NEAR RPC returned HTTP ${response.status}`,
        );
      const body: unknown = await response.json();
      if (
        !isRecord(body) ||
        !isRecord(body.result) ||
        typeof body.result.chain_id !== "string"
      ) {
        throw new NearRpcError(
          "malformed",
          "NEAR status response has no chain ID",
        );
      }
      return body.result.chain_id;
    } catch (error) {
      if (error instanceof NearRpcError) throw error;
      if (controller.signal.aborted)
        throw new NearRpcError("timeout", "NEAR status request timed out");
      throw new NearRpcError("unavailable", "NEAR status request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface NearContractReaderConfig {
  readonly networkId: string;
  readonly contractId: string;
}

/** Concrete, read-only reader for the view methods present in the contract ABI. */
export class NearContractReader implements ContractReader {
  readonly config: NearContractReaderConfig;
  private readonly rpc: NearRpcTransport;

  constructor(config: NearContractReaderConfig, rpc: NearRpcTransport) {
    this.config = config;
    this.rpc = rpc;
    if (!config.networkId.trim() || !config.contractId.trim()) {
      throw new Error("NEAR network and contract identifiers are required");
    }
  }

  async getPayout(payoutId: PayoutId): Promise<NearPayoutView | null> {
    const payout = parseNullablePayout(
      await this.call("get_payout", {
        payout_id: nearU64(payoutId, "payout ID"),
      }),
    );
    if (payout && payout.id !== asU64String(payoutId, "payout ID"))
      throw malformed("Payout response does not match requested ID");
    return payout;
  }

  async verifyNetwork(): Promise<void> {
    if (!this.rpc.getNetworkId)
      throw new Error(
        "RPC transport cannot verify its configured NEAR network",
      );
    const actual = await this.rpc.getNetworkId();
    if (actual !== this.config.networkId) {
      throw new NearRpcError(
        "network-mismatch",
        `Configured NEAR network ${this.config.networkId} does not match RPC network ${actual}`,
      );
    }
  }

  async getCampaignPayout(
    campaignId: string,
    payoutId: PayoutId,
  ): Promise<NearPayoutView | null> {
    const payout = parseNullablePayout(
      await this.call("get_campaign_payout", {
        campaign_id: nearU64(campaignId, "campaign ID"),
        payout_id: nearU64(payoutId, "payout ID"),
      }),
    );
    if (
      payout &&
      (payout.id !== asU64String(payoutId, "payout ID") ||
        payout.campaignId !== asU64String(campaignId, "campaign ID"))
    )
      throw malformed("Campaign payout response does not match requested IDs");
    return payout;
  }

  async getPayoutByIdempotency(
    campaignId: string,
    idempotencyKey: string,
  ): Promise<NearPayoutView | null> {
    if (!idempotencyKey.trim()) throw new Error("Idempotency key is required");
    const payout = parseNullablePayout(
      await this.call("get_payout_by_idempotency", {
        campaign_id: nearU64(campaignId, "campaign ID"),
        idempotency_key: idempotencyKey,
      }),
    );
    if (payout && payout.campaignId !== asU64String(campaignId, "campaign ID"))
      throw malformed(
        "Idempotency lookup returned a payout from another campaign",
      );
    return payout;
  }

  async getCampaignPayoutAccounting(
    campaignId: string,
  ): Promise<CampaignAccountingSnapshot | null> {
    const value = await this.call("get_campaign_payout_accounting", {
      campaign_id: nearU64(campaignId, "campaign ID"),
    });
    if (value === null) return null;
    if (!isRecord(value))
      throw malformed("Invalid campaign accounting response");
    const parsed = {
      campaignId: asU64String(value.campaign_id, "campaign ID"),
      budget: asU128(value.budget, "budget"),
      funded: asU128(value.funded, "funded"),
      reserved: asU128(value.reserved, "reserved"),
      spent: asU128(value.spent, "spent"),
      available: asU128(value.available, "available"),
    };
    if (parsed.campaignId !== asU64String(campaignId, "campaign ID")) {
      throw malformed(
        "Campaign accounting response does not match the request",
      );
    }
    const funding = await this.call("get_campaign_funding", {
      campaign_id: nearU64(campaignId, "campaign ID"),
    });
    if (!isRecord(funding)) {
      throw malformed("Invalid campaign funding response");
    }
    if (
      asU64String(funding.campaign_id, "campaign ID") !==
      asU64String(campaignId, "campaign ID")
    ) {
      throw malformed("Campaign funding response does not match the request");
    }
    const tokenId = nonEmptyString(funding.token_id, "funding token account");
    if (
      tokenId.length > 64 ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(tokenId)
    ) {
      throw malformed("Invalid campaign funding token account");
    }
    const metadata = await this.rpc.viewFunction(tokenId, "ft_metadata", {});
    if (
      !isRecord(metadata) ||
      typeof metadata.decimals !== "number" ||
      !Number.isInteger(metadata.decimals) ||
      metadata.decimals < 0 ||
      metadata.decimals > 255
    ) {
      throw malformed("Invalid funding token metadata");
    }
    return { ...parsed, tokenId, tokenDecimals: metadata.decimals };
  }

  async isPaused(): Promise<boolean> {
    const value = await this.call("is_paused", {});
    if (typeof value !== "boolean") throw malformed("Invalid pause response");
    return value;
  }

  async hasRole(
    accountId: string,
    role: "Operator" | "Administrator" | "Verifier",
  ): Promise<boolean> {
    if (!accountId.trim()) throw new Error("Account ID is required");
    const value = await this.call("has_role", { account_id: accountId, role });
    if (typeof value !== "boolean") throw malformed("Invalid role response");
    return value;
  }

  private call(method: string, args: Readonly<Record<string, unknown>>) {
    return this.rpc.viewFunction(this.config.contractId, method, args);
  }
}

function parseNullablePayout(value: unknown): NearPayoutView | null {
  if (value === null) return null;
  if (!isRecord(value)) throw malformed("Payout view is not an object");
  const id = asU64String(value.id, "payout ID");
  const campaignId = asU64String(value.campaign_id, "campaign ID");
  const recipient = value.recipient_near_account_id;
  if (recipient !== null && typeof recipient !== "string") {
    throw malformed("Invalid NEAR recipient account");
  }
  if (!isRecord(value.destination))
    throw malformed("Invalid payout destination");
  const destination = {
    chainId: nonEmptyString(value.destination.chain_id, "destination chain"),
    recipientAddress: nonEmptyString(
      value.destination.recipient_address,
      "destination recipient",
    ),
  };
  if (!Array.isArray(value.resolution_evidence)) {
    throw malformed("Invalid payout resolution history");
  }
  return {
    id,
    campaignId,
    recipientNearAccountId: recipient,
    inputAmount: parseTokenAmount(value.input_amount),
    destination,
    expectedOutputAmount: parseTokenAmount(value.expected_output_amount),
    status: enumValue(
      value.status,
      [
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
      ] as const,
      "payout status",
    ),
    createdAtNs: asU64String(value.created_at_ns, "creation timestamp"),
    executionReference: nullableString(
      value.execution_reference,
      "execution reference",
    ),
    settlementEvidenceReference: nullableString(
      value.settlement_evidence_reference,
      "settlement evidence reference",
    ),
    lifecycleReason: nullableString(value.lifecycle_reason, "lifecycle reason"),
    failureEvidence: value.failure_evidence ?? null,
    settlementEvidence: value.settlement_evidence ?? null,
    resolutionEvidence: value.resolution_evidence,
  };
}

function parseTokenAmount(value: unknown) {
  if (!isRecord(value) || !isRecord(value.token_id)) {
    throw malformed("Invalid token amount response");
  }
  const tokenKeys = Object.keys(value.token_id);
  if (
    tokenKeys.length !== 1 ||
    !["Near", "External"].includes(tokenKeys[0] ?? "")
  ) {
    throw malformed("Invalid token identity response");
  }
  const tokenValue = nonEmptyString(
    value.token_id[tokenKeys[0] ?? ""],
    "token ID",
  );
  const tokenId =
    tokenKeys[0] === "Near" ? { Near: tokenValue } : { External: tokenValue };
  if (
    typeof value.decimals !== "number" ||
    !Number.isInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > 255
  ) {
    throw malformed("Invalid token decimals");
  }
  return {
    tokenId,
    atomicAmount: asU128(value.atomic_amount, "token amount"),
    decimals: value.decimals as number,
  };
}

function preserveU64Lexemes(json: string): string {
  return json.replace(
    /("(?:id|campaign_id|created_at_ns)"\s*:\s*)(\d+)(?=\s*[,}])/g,
    (_match, prefix: string, digits: string) => `${prefix}"${digits}"`,
  );
}

function nearU64(value: string, label: string): string {
  const normalized = asU64String(value, label);
  if (BigInt(normalized) > 18_446_744_073_709_551_615n)
    throw new Error(`${label} exceeds u64`);
  return `__DISBURSE_U64_${normalized}__`;
}

function serializeNearArgs(args: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(args).replace(/"__DISBURSE_U64_(\d+)__"/g, "$1");
}

function asU64String(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw malformed(`Invalid ${label}`);
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw malformed(`${label} cannot be decoded exactly`);
  }
  const text = String(value);
  if (!/^\d+$/.test(text)) throw malformed(`Invalid ${label}`);
  if (BigInt(text) > 18_446_744_073_709_551_615n)
    throw malformed(`${label} exceeds u64`);
  return BigInt(text).toString();
}

function asU128(value: unknown, label: string): string {
  const text =
    typeof value === "string" ? value : isRecord(value) ? value.value : value;
  if (typeof text !== "string" || !/^\d+$/.test(text))
    throw malformed(`Invalid ${label}`);
  if (BigInt(text) > (1n << 128n) - 1n)
    throw malformed(`${label} exceeds u128`);
  return text;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value))
    throw malformed(`Invalid ${label}`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return nonEmptyString(value, label);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw malformed(`Invalid ${label}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(message: string): NearRpcError {
  return new NearRpcError("malformed", message);
}
