import { OperationalMonitor } from "../operations/monitoring.ts";
import { NearRpcError } from "./errors.ts";
export interface HttpLimits {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly totalMs: number;
  readonly maxAttempts: number;
  readonly concurrency: number;
  readonly maxQueue: number;
  readonly backoffMs: number;
  readonly jsonDepth: number;
}
export const DEFAULT_HTTP_LIMITS: HttpLimits = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  timeoutMs: 10000,
  totalMs: 15000,
  maxAttempts: 2,
  concurrency: 4,
  maxQueue: 32,
  backoffMs: 100,
  jsonDepth: 64,
});
export function httpLimits(options: Partial<HttpLimits> = {}): HttpLimits {
  const result = { ...DEFAULT_HTTP_LIMITS, ...options };
  const caps: Record<keyof HttpLimits, number> = {
    maxBytes: 16 * 1024 * 1024,
    timeoutMs: 60000,
    totalMs: 120000,
    maxAttempts: 5,
    concurrency: 16,
    maxQueue: 128,
    backoffMs: 2000,
    jsonDepth: 128,
  };
  for (const key of Object.keys(caps) as (keyof HttpLimits)[]) {
    if (
      !Number.isSafeInteger(result[key]) ||
      result[key] < (key === "maxQueue" || key === "backoffMs" ? 0 : 1) ||
      result[key] > caps[key]
    )
      throw new Error(`Invalid RPC limit: ${key}`);
  }
  return Object.freeze(result);
}
function aborted(signal: AbortSignal): NearRpcError {
  return signal.reason instanceof NearRpcError
    ? signal.reason
    : new NearRpcError("cancelled", "Read operation cancelled");
}
export function withAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => undefined);
    return Promise.reject(aborted(signal));
  }
  return new Promise((resolve, reject) => {
    const stop = () => reject(aborted(signal));
    signal.addEventListener("abort", stop, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
interface Waiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (e: Error) => void;
  readonly signal: AbortSignal;
  readonly cancel: () => void;
}
/** Per reused client: bounds active logical reads and queued reads, including retries. */
export class BoundedReadHttp {
  readonly monitoring = new OperationalMonitor();
  readonly limits: HttpLimits;
  private active = 0;
  private readonly queue: Waiter[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly random: () => number;
  constructor(
    fetchImpl: typeof fetch = fetch,
    options: Partial<HttpLimits> = {},
    random: () => number = Math.random,
  ) {
    this.fetchImpl = fetchImpl;
    this.limits = httpLimits(options);
    this.random = random;
  }
  private release = () => {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      next.signal.removeEventListener("abort", next.cancel);
      this.active++;
      next.resolve(this.onceRelease());
    }
  };
  private onceRelease() {
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.release();
      }
    };
  }
  private acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(aborted(signal));
    if (this.active < this.limits.concurrency) {
      this.active++;
      return Promise.resolve(this.onceRelease());
    }
    if (this.queue.length >= this.limits.maxQueue)
      return Promise.reject(
        new NearRpcError("resource-limit", "RPC queue capacity exceeded"),
      );
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        cancel: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(aborted(signal));
        },
      };
      this.queue.push(waiter);
      signal.addEventListener("abort", waiter.cancel, { once: true });
    });
  }
  /** Callers use only read-only RPC queries or archive GETs. Never a transaction submission transport. */
  async text(
    url: string | URL,
    init: RequestInit,
    external?: AbortSignal,
  ): Promise<string> {
    const totalDeadline = performance.now() + this.limits.totalMs;
    const total = new AbortController();
    const timer = setTimeout(
      () =>
        total.abort(new NearRpcError("timeout", "RPC total deadline exceeded")),
      this.limits.totalMs,
    );
    const cancel = () =>
      total.abort(new NearRpcError("cancelled", "Read operation cancelled"));
    external?.addEventListener("abort", cancel, { once: true });
    if (external?.aborted) cancel();
    let release: (() => void) | undefined;
    try {
      release = await this.acquire(total.signal);
      for (let attempt = 0; attempt < this.limits.maxAttempts; attempt++) {
        const attemptDeadline = Math.min(
          totalDeadline,
          performance.now() + this.limits.timeoutMs,
        );
        const controller = new AbortController();
        const stop = () => controller.abort(total.signal.reason);
        total.signal.addEventListener("abort", stop, { once: true });
        if (total.signal.aborted) stop();
        const timeout = setTimeout(
          () =>
            controller.abort(
              new NearRpcError("timeout", "RPC response deadline exceeded"),
            ),
          this.limits.timeoutMs,
        );
        try {
          const pending = this.fetchImpl(url, {
            ...init,
            signal: controller.signal,
          });
          // A late response from a nonconforming injected transport must not retain its body.
          void pending.then(
            (r) => {
              if (controller.signal.aborted)
                void r.body?.cancel().catch(() => undefined);
            },
            () => undefined,
          );
          const response = await withAbort(pending, controller.signal);
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            throw new NearRpcError(
              response.status === 429
                ? "rate-limited"
                : response.status >= 500
                  ? "unavailable"
                  : "rpc",
              "Read endpoint rejected request",
              { status: response.status },
            );
          }
          return await this.readBody(
            response,
            controller.signal,
            attemptDeadline,
          );
        } catch (error) {
          const classified = controller.signal.aborted
            ? aborted(controller.signal)
            : error instanceof NearRpcError
              ? error
              : new NearRpcError("unavailable", "Read endpoint unavailable");
          if (total.signal.aborted) throw aborted(total.signal);
          if (!classified.retryable || attempt + 1 >= this.limits.maxAttempts)
            throw classified;
        } finally {
          clearTimeout(timeout);
          total.signal.removeEventListener("abort", stop);
          controller.abort();
        }
        const delay =
          Math.min(2000, this.limits.backoffMs * 2 ** attempt) *
          (0.5 + Math.max(0, Math.min(1, this.random())) * 0.5);
        await new Promise<void>((resolve, reject) => {
          if (total.signal.aborted) {
            reject(aborted(total.signal));
            return;
          }
          const handle = setTimeout(() => {
            total.signal.removeEventListener("abort", stop);
            resolve();
          }, delay);
          const stop = () => {
            clearTimeout(handle);
            total.signal.removeEventListener("abort", stop);
            reject(aborted(total.signal));
          };
          total.signal.addEventListener("abort", stop, { once: true });
        });
      }
      throw new NearRpcError("unavailable", "Read retry budget exhausted");
    } catch (error) {
      if (error instanceof NearRpcError)
        this.monitoring.record(
          error.kind === "timeout"
            ? "rpc_timeout"
            : error.kind === "rate-limited"
              ? "rpc_rate_limit"
              : error.kind === "resource-limit"
                ? "resource_limit"
                : "reconciliation_uncertain",
        );
      throw error;
    } finally {
      release?.();
      clearTimeout(timer);
      external?.removeEventListener("abort", cancel);
    }
  }
  private async readBody(
    response: Response,
    signal: AbortSignal,
    deadline: number,
  ): Promise<string> {
    const length = response.headers.get("content-length");
    if (
      length &&
      /^\d+$/.test(length) &&
      BigInt(length) > BigInt(this.limits.maxBytes)
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw new NearRpcError(
        "resource-limit",
        "RPC response byte limit exceeded",
      );
    }
    if (!response.body)
      throw new NearRpcError("malformed", "Read response body missing");
    const reader = response.body.getReader();
    const bytes = new Uint8Array(this.limits.maxBytes);
    let size = 0;
    try {
      while (true) {
        if (performance.now() >= deadline)
          throw new NearRpcError("timeout", "RPC response deadline exceeded");
        const part = await withAbort(reader.read(), signal);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > this.limits.maxBytes)
          throw new NearRpcError(
            "resource-limit",
            "RPC response byte limit exceeded",
          );
        bytes.set(part.value, size - part.value.byteLength);
      }
      let value: string;
      try {
        value = new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, size),
        );
      } catch {
        throw new NearRpcError("malformed", "Read response encoding invalid");
      }
      assertJsonDepth(value, this.limits.jsonDepth);
      return value;
    } finally {
      void reader.cancel().catch(() => undefined);
      try {
        reader.releaseLock();
      } catch {
        /* Pending aborted read; cancellation releases the underlying stream. */
      }
    }
  }
}
export function assertJsonDepth(raw: string, maximum: number): void {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const char of raw) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") {
      if (++depth > maximum)
        throw new NearRpcError("resource-limit", "JSON nesting limit exceeded");
    } else if (char === "]" || char === "}") depth--;
  }
}
