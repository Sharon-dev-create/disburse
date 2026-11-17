export type RpcErrorKind =
  | "timeout"
  | "unavailable"
  | "rate-limited"
  | "rpc"
  | "network-mismatch"
  | "malformed"
  | "resource-limit"
  | "cancelled"
  | "finality-uncertain"
  | "inconsistent";
export class NearRpcError extends Error {
  readonly kind: RpcErrorKind;
  readonly retryable: boolean;
  readonly status: number | undefined;
  constructor(
    kind: RpcErrorKind,
    message: string,
    options?: { readonly cause?: unknown; readonly status?: number },
  ) {
    super(message, options);
    this.name = "NearRpcError";
    this.kind = kind;
    this.status = options?.status;
    this.retryable = ["timeout", "unavailable", "rate-limited"].includes(kind);
  }
}
