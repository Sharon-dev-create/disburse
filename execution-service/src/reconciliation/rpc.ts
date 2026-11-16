import { NearRpcError } from "../near/rpc.ts";
import { exactJson, object, text, uint, type JsonRecord } from "./evidence.ts";

export interface EvidenceRpc {
  readonly sourceId: string;
  readonly endpoint: string;
  read(
    method: string,
    params: JsonRecord | readonly unknown[],
  ): Promise<unknown>;
}
const views = new Set([
  "get_native_payout",
  "get_native_attempt",
  "get_native_authorization",
  "get_native_execution_outcome",
  "get_payout",
  "get_campaign_payout_accounting",
]);
/** No broadcast, signer, keychain, authorization, refund or contract-mutation capability. */
export class ReadOnlyEvidenceRpc implements EvidenceRpc {
  readonly sourceId: string;
  readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  constructor(
    sourceId: string,
    endpoint: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
    this.sourceId = text(sourceId);
    this.endpoint = new URL(endpoint).toString();
    if (!["http:", "https:"].includes(new URL(endpoint).protocol))
      throw new Error("Invalid RPC URL");
  }
  async read(
    method: string,
    params: JsonRecord | readonly unknown[],
  ): Promise<unknown> {
    if (
      ![
        "status",
        "tx_status",
        "block",
        "EXPERIMENTAL_receipt",
        "query",
      ].includes(method)
    )
      throw new Error("RPC mutation/unsupported method forbidden");
    if (method === "query") {
      const p = object(params);
      if (
        p.request_type !== "call_function" ||
        !views.has(String(p.method_name)) ||
        !p.block_id
      )
        throw new Error("Only pinned supported contract views allowed");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "native-reconciliation",
          method,
          params,
        }),
      });
      if (!response.ok) throw new Error("RPC unavailable");
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 4 * 1024 * 1024)
        throw new Error("Oversized RPC evidence");
      const body = object(exactJson(raw));
      if ("error" in body) throw new Error("RPC evidence unavailable");
      return body.result;
    } catch {
      throw new NearRpcError(
        controller.signal.aborted ? "timeout" : "unavailable",
        "Read-only evidence lookup failed",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
export async function viewAt(
  rpc: EvidenceRpc,
  contractId: string,
  method: string,
  args: JsonRecord,
  block: string,
) {
  // Only u64 view arguments are unquoted, after strict validation; user strings never become raw JSON.
  const encoded = JSON.stringify(args).replace(
    /"(payout_id|attempt_id|campaign_id)":"(\d+)"/g,
    (_m, k: string, v: string) => `"${k}":${uint(v)}`,
  );
  const result = object(
    await rpc.read("query", {
      request_type: "call_function",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(encoded).toString("base64"),
      block_id: block,
    }),
  );
  if (
    result.block_hash !== block ||
    !Array.isArray(result.result) ||
    !result.result.every(
      (x) => Number.isInteger(x) && Number(x) >= 0 && Number(x) <= 255,
    )
  )
    throw new Error("Unpinned/invalid view");
  return exactJson(Buffer.from(result.result as number[]).toString("utf8"));
}
