export const NEAR_INTENTS_API_BASE_URL = "https://1click.chaindefuser.com";

export interface NearIntentsQuoteRequest {
  readonly dry: true;
  readonly swapType: "EXACT_OUTPUT";
  readonly slippageTolerance: number;
  readonly originAsset: string;
  readonly depositType: "ORIGIN_CHAIN";
  readonly destinationAsset: string;
  readonly amount: string;
  readonly refundTo: string;
  readonly refundType: "ORIGIN_CHAIN";
  readonly recipient: string;
  readonly recipientType: "DESTINATION_CHAIN";
  readonly deadline: string;
}

export interface NearIntentsQuoteResponse {
  readonly correlationId: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly quoteRequest: unknown;
  readonly quote: unknown;
}

export type NearIntentsFailureKind =
  | "permanent-validation"
  | "temporary-provider"
  | "rate-limited"
  | "configuration-or-authentication"
  | "expired-quote"
  | "ambiguous-outcome"
  | "unsupported-capability";

export class NearIntentsError extends Error {
  constructor(
    readonly kind: NearIntentsFailureKind,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "NearIntentsError";
  }
}

export interface NearIntentsClientConfig {
  readonly apiKey: string;
  readonly requestTimeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

export class NearIntentsClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: NearIntentsClientConfig) {
    if (!config.apiKey.trim() || config.apiKey.startsWith("replace-with")) {
      throw new NearIntentsError(
        "configuration-or-authentication",
        "missing-api-key",
        "A NEAR Intents API key is required",
      );
    }
    if (
      !Number.isInteger(config.requestTimeoutMs) ||
      config.requestTimeoutMs < 1
    ) {
      throw new NearIntentsError(
        "permanent-validation",
        "invalid-timeout",
        "Request timeout must be a positive integer",
      );
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async requestQuote(
    request: NearIntentsQuoteRequest,
  ): Promise<NearIntentsQuoteResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${NEAR_INTENTS_API_BASE_URL}/v0/quote`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new NearIntentsError(
        "ambiguous-outcome",
        timedOut ? "request-timeout" : "network-failure",
        timedOut
          ? "Quote request timed out; no quote was accepted"
          : "Quote request failed before a response was received",
      );
    }

    if (!response.ok) {
      const safeMessage = await readProviderMessage(response);
      if (response.status === 400) {
        throw new NearIntentsError(
          "permanent-validation",
          "http-400",
          safeMessage,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new NearIntentsError(
          "configuration-or-authentication",
          `http-${response.status}`,
          safeMessage,
        );
      }
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
        throw new NearIntentsError(
          "rate-limited",
          "http-429",
          safeMessage,
          Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
        );
      }
      if (response.status >= 500) {
        throw new NearIntentsError(
          "temporary-provider",
          `http-${response.status}`,
          safeMessage,
        );
      }
      throw new NearIntentsError(
        "temporary-provider",
        `http-${response.status}`,
        safeMessage,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new NearIntentsError(
        "permanent-validation",
        "malformed-json",
        "Provider returned malformed JSON",
      );
    }
    if (!isRecord(body)) {
      throw new NearIntentsError(
        "permanent-validation",
        "malformed-response",
        "Provider quote response must be an object",
      );
    }
    return body as unknown as NearIntentsQuoteResponse;
  }
}

async function readProviderMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.message === "string") {
      return body.message.slice(0, 400);
    }
  } catch {
    // Keep a bounded status-only diagnostic if the error body is not JSON.
  }
  return `NEAR Intents API returned HTTP ${response.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
