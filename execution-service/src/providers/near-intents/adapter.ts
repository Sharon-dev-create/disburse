import type {
  QuoteIntent,
  ExecutionOpportunity,
  QuoteProviderAdapter,
  QuoteFee,
} from "../quote.ts";
import { NearIntentsError, type NearIntentsClient } from "./client.ts";

export interface NearIntentsAssetMapping {
  readonly assetId: string;
  readonly networkId: string;
  readonly tokenId: string;
  readonly decimals: number;
}

export interface NearIntentsAdapterConfig {
  readonly client: NearIntentsClient;
  readonly assets: readonly NearIntentsAssetMapping[];
  readonly providerNetworkByDisburseNetwork: Readonly<Record<string, string>>;
  readonly maxQuoteAgeMs: number;
  readonly slippageToleranceBps: number;
  readonly now?: () => number;
}

const U128_MAX = (1n << 128n) - 1n;
const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;

/** Read-only 1Click adapter. It always sends dry:true and has no submit/status methods. */
export class NearIntentsQuoteAdapter implements QuoteProviderAdapter {
  readonly providerId = "near-intents-1click";
  private readonly now: () => number;
  private readonly config: NearIntentsAdapterConfig;

  constructor(config: NearIntentsAdapterConfig) {
    this.config = config;
    if (!Number.isInteger(config.maxQuoteAgeMs) || config.maxQuoteAgeMs <= 0) {
      throw invalid("max-quote-age", "Quote freshness window must be positive");
    }
    if (
      !Number.isInteger(config.slippageToleranceBps) ||
      config.slippageToleranceBps < 0 ||
      config.slippageToleranceBps > 10_000
    ) {
      throw invalid(
        "slippage-tolerance",
        "Slippage tolerance must be between 0 and 10000 bps",
      );
    }
    if (config.assets.length === 0)
      throw invalid("asset-mapping", "At least one asset mapping is required");
    const seen = new Set<string>();
    for (const asset of config.assets) {
      if (
        !asset.assetId.trim() ||
        !asset.networkId.trim() ||
        !asset.tokenId.trim()
      ) {
        throw invalid(
          "asset-mapping",
          "Asset mappings require asset, network, and token IDs",
        );
      }
      if (
        !Number.isInteger(asset.decimals) ||
        asset.decimals < 0 ||
        asset.decimals > 255
      ) {
        throw invalid(
          "asset-decimals",
          "Trusted asset decimals must fit an unsigned byte",
        );
      }
      if (seen.has(asset.assetId))
        throw invalid("asset-mapping", "Provider asset IDs must be unique");
      seen.add(asset.assetId);
    }
    this.now = config.now ?? Date.now;
  }

  async quote(intent: QuoteIntent): Promise<ExecutionOpportunity> {
    validateAmount(intent.input.atomicAmount, "input amount");
    validateAmount(intent.expectedOutput.atomicAmount, "expected output");
    validateTokenAmount(intent.input);
    validateTokenAmount(intent.expectedOutput);
    if (!intent.recipientAddress.trim() || !intent.refundAddress.trim()) {
      throw invalid(
        "missing-address",
        "Recipient and origin refund address are required",
      );
    }
    const deadlineMs = Date.parse(intent.deadline);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= this.now()) {
      throw invalid(
        "invalid-deadline",
        "A future quote deadline is required by the provider schema",
      );
    }

    const originChain =
      this.config.providerNetworkByDisburseNetwork[intent.sourceNetworkId];
    const destinationChain =
      this.config.providerNetworkByDisburseNetwork[intent.destinationNetworkId];
    if (!originChain || !destinationChain) {
      throw unsupported(
        "network",
        "Requested source or destination network is not configured",
      );
    }
    const origin = this.findAsset(intent.input.tokenId, intent.sourceNetworkId);
    const destination = this.findAsset(
      intent.expectedOutput.tokenId,
      intent.destinationNetworkId,
    );
    if (
      origin.networkId !== intent.sourceNetworkId ||
      destination.networkId !== intent.destinationNetworkId
    ) {
      throw unsupported(
        "asset-network-mismatch",
        "Configured token does not belong to the requested network",
      );
    }
    if (
      origin.decimals !== intent.input.decimals ||
      destination.decimals !== intent.expectedOutput.decimals
    ) {
      throw invalid(
        "decimal-metadata-mismatch",
        "Payout token decimals do not match trusted asset configuration",
      );
    }

    const request = {
      dry: true as const,
      swapType: "EXACT_OUTPUT" as const,
      slippageTolerance: this.config.slippageToleranceBps,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN" as const,
      destinationAsset: destination.assetId,
      amount: intent.expectedOutput.atomicAmount,
      refundTo: intent.refundAddress,
      refundType: "ORIGIN_CHAIN" as const,
      recipient: intent.recipientAddress,
      recipientType: "DESTINATION_CHAIN" as const,
      deadline: intent.deadline,
    };
    const receivedAtMs = this.now();
    const response = await this.config.client.requestQuote(request);
    const responseQuote = record(response.quote, "quote");
    const echo = record(response.quoteRequest, "quoteRequest");

    if (
      !isNonEmptyString(response.correlationId) ||
      !isNonEmptyString(response.signature)
    ) {
      throw invalid(
        "missing-quote-identity",
        "Quote response is missing its correlation ID or signature",
      );
    }
    if (!isIsoDate(response.timestamp))
      throw invalid("invalid-timestamp", "Quote timestamp is invalid");
    const responseTimestampMs = Date.parse(response.timestamp);
    if (responseTimestampMs > receivedAtMs + 60_000) {
      throw invalid(
        "future-timestamp",
        "Quote timestamp is too far in the future",
      );
    }
    if (receivedAtMs - responseTimestampMs > this.config.maxQuoteAgeMs) {
      throw new NearIntentsError(
        "expired-quote",
        "stale-provider-response",
        "Provider response is older than the configured quote freshness window",
      );
    }
    assertEqual(echo.dry, true, "echoed dry mode");
    assertEqual(echo.swapType, "EXACT_OUTPUT", "echoed swap type");
    assertEqual(
      echo.slippageTolerance,
      this.config.slippageToleranceBps,
      "echoed slippage tolerance",
    );
    assertEqual(echo.originAsset, origin.assetId, "echoed source asset");
    assertEqual(echo.depositType, "ORIGIN_CHAIN", "echoed deposit type");
    assertEqual(
      echo.destinationAsset,
      destination.assetId,
      "echoed destination asset",
    );
    assertEqual(
      echo.amount,
      intent.expectedOutput.atomicAmount,
      "echoed amount",
    );
    assertEqual(echo.recipient, intent.recipientAddress, "echoed recipient");
    assertEqual(
      echo.recipientType,
      "DESTINATION_CHAIN",
      "echoed recipient type",
    );
    assertEqual(echo.refundTo, intent.refundAddress, "echoed refund address");
    assertEqual(echo.refundType, "ORIGIN_CHAIN", "echoed refund type");
    assertEqual(echo.deadline, intent.deadline, "echoed deadline");

    const amountIn = parseAmount(responseQuote.amountIn, "amountIn");
    const minAmountIn = parseAmount(responseQuote.minAmountIn, "minAmountIn");
    const amountOut = parseAmount(responseQuote.amountOut, "amountOut");
    const minAmountOut = parseAmount(
      responseQuote.minAmountOut,
      "minAmountOut",
    );
    const authorizedInput = BigInt(intent.input.atomicAmount);
    if (BigInt(amountIn) > authorizedInput) {
      throw invalid(
        "input-budget-exceeded",
        "Quote maximum input exceeds the reserved payout input amount",
      );
    }
    if (BigInt(minAmountIn) > BigInt(amountIn)) {
      throw invalid(
        "invalid-input-range",
        "Quote minimum input exceeds its quoted input amount",
      );
    }
    if (amountOut !== intent.expectedOutput.atomicAmount) {
      throw invalid(
        "exact-output-mismatch",
        "Exact-output quote does not match the payout's required atomic output",
      );
    }
    if (BigInt(minAmountOut) < BigInt(intent.expectedOutput.atomicAmount)) {
      throw invalid(
        "minimum-output-below-required",
        "Quote minimum output is below the payout's exact required output",
      );
    }
    const fees = parseFees(responseQuote, origin, destination);
    const estimated = responseQuote.timeEstimate;
    if (
      estimated !== undefined &&
      (typeof estimated !== "number" ||
        !Number.isFinite(estimated) ||
        estimated < 0)
    ) {
      throw invalid(
        "invalid-estimate",
        "Provider execution-time estimate is invalid",
      );
    }

    const freshUntilMs = receivedAtMs + this.config.maxQuoteAgeMs;
    if (!Number.isFinite(freshUntilMs))
      throw invalid("invalid-clock", "Quote freshness timestamp overflowed");
    return {
      providerId: this.providerId,
      sourceNetworkId: intent.sourceNetworkId,
      sourceTokenId: intent.input.tokenId,
      quotedInputAtomicAmount: amountIn,
      maximumInputAtomicAmount: null,
      destinationNetworkId: intent.destinationNetworkId,
      destinationTokenId: intent.expectedOutput.tokenId,
      recipientAddress: intent.recipientAddress,
      expectedOutputAtomicAmount: amountOut,
      minimumOutputAtomicAmount: minAmountOut,
      quoteReference: response.correlationId,
      expiresAt: null,
      freshUntil: new Date(freshUntilMs).toISOString(),
      fees,
      estimatedExecutionSeconds: estimated === undefined ? null : estimated,
      providerMetadata: {
        responseTimestamp: response.timestamp,
        quoteSignature: response.signature,
        previewOnly: "true",
      },
    };
  }

  private findAsset(
    tokenId: string,
    networkId: string,
  ): NearIntentsAssetMapping {
    const matches = this.config.assets.filter(
      (asset) => asset.tokenId === tokenId && asset.networkId === networkId,
    );
    if (matches.length !== 1) {
      throw unsupported(
        "asset",
        "Requested token and network pair is not uniquely allowlisted",
      );
    }
    return matches[0]!;
  }
}

function parseFees(
  quote: Record<string, unknown>,
  origin: NearIntentsAssetMapping,
  destination: NearIntentsAssetMapping,
): QuoteFee[] {
  const fees: QuoteFee[] = [];
  for (const [field, kind, tokenId] of [
    ["refundFee", "origin-refund", origin.tokenId],
    ["withdrawFee", "destination-withdrawal", destination.tokenId],
  ] as const) {
    const value = quote[field];
    if (value === undefined) continue;
    const atomicAmount = parseAmount(value, field, true);
    fees.push({ kind, tokenId, atomicAmount });
  }
  return fees;
}

function validateTokenAmount(amount: { readonly decimals: number }): void {
  if (
    !Number.isInteger(amount.decimals) ||
    amount.decimals < 0 ||
    amount.decimals > 255
  ) {
    throw invalid(
      "invalid-decimals",
      "Token decimals must fit an unsigned byte",
    );
  }
}

function validateAmount(value: string, label: string): string {
  const parsed = parseAmount(value, label);
  if (BigInt(parsed) === 0n)
    throw invalid("invalid-amount", `${label} must be positive`);
  return parsed;
}

function parseAmount(value: unknown, label: string, allowZero = false): string {
  if (typeof value !== "string" || !DECIMAL_INTEGER.test(value)) {
    throw invalid(
      "malformed-amount",
      `${label} must be an unsigned atomic integer string`,
    );
  }
  const parsed = BigInt(value);
  if (parsed > U128_MAX || (!allowZero && parsed === 0n)) {
    throw invalid(
      "amount-out-of-range",
      `${label} is outside the supported u128 range`,
    );
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("malformed-response", `Provider ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected)
    throw invalid(
      "route-mismatch",
      `Provider ${label} does not match the requested payout`,
    );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function invalid(code: string, message: string): NearIntentsError {
  return new NearIntentsError("permanent-validation", code, message);
}

function unsupported(code: string, message: string): NearIntentsError {
  return new NearIntentsError("unsupported-capability", code, message);
}
