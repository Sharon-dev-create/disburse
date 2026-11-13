export type ContractPayoutStatus =
  | "Created"
  | "Authorized"
  | "Reserved"
  | "Executing"
  | "PendingVerification"
  | "Succeeded"
  | "Failed"
  | "RefundPending"
  | "Refunded"
  | "ManualReview"
  | "ReservationReleased";

export type ExecutionJobState =
  | "Discovered"
  | "Queued"
  | "Leased"
  | "Preparing"
  | "SubmissionStarted"
  | "SubmissionUnknown"
  | "Submitted"
  | "ConfirmationPending"
  | "VerificationPending"
  | "SettlementReady"
  | "SettlementSubmitted"
  | "Completed"
  | "RetryableFailure"
  | "ManualReview"
  | "Abandoned";

export type TokenIdentity =
  | { readonly Near: string }
  | { readonly External: string };

export interface CampaignAccounting {
  readonly campaignId: string;
  readonly budget: string;
  readonly funded: string;
  readonly reserved: string;
  readonly spent: string;
  readonly available: string;
  readonly tokenId: string;
  readonly tokenDecimals: number;
}

export interface ContractPayout {
  readonly id: string;
  readonly campaignId: string;
  readonly status: ContractPayoutStatus;
  readonly source: {
    readonly networkId: string;
    readonly token: TokenIdentity;
    readonly atomicAmount: string;
    readonly decimals: number;
  };
  readonly destination: {
    readonly networkId: string;
    readonly recipientAddress: string;
    readonly token: TokenIdentity;
    readonly expectedAtomicAmount: string;
    readonly decimals: number;
  };
  readonly createdAtNs: string;
  readonly executionReference: string | null;
  readonly settlementEvidenceReference: string | null;
}

export interface ExecutionAttempt {
  readonly sequence: number;
  readonly phase: string;
  readonly outcome: string;
  readonly startedAt: string;
}

export interface PersistedExecutionJob {
  readonly jobId: string;
  readonly payoutId: string;
  readonly campaignId: string;
  readonly state: ExecutionJobState;
  readonly observedContractStatus: ContractPayoutStatus;
  readonly source: {
    readonly tokenId: string;
    readonly atomicAmount: string;
    readonly decimals: number;
  };
  readonly destination: {
    readonly networkId: string;
    readonly recipientAddress: string;
    readonly tokenId: string;
    readonly expectedAtomicAmount: string;
    readonly decimals: number;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attemptCount: number;
  readonly attempts: readonly ExecutionAttempt[];
  readonly leaseExpiresAt: string | null;
  readonly failureCode: string | null;
}

export interface CampaignPayoutList {
  readonly campaignId: string;
  readonly jobs: readonly PersistedExecutionJob[];
  readonly truncated: boolean;
}

export type ExecutionApiErrorKind =
  | "configuration"
  | "invalid-request"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "unavailable"
  | "invalid-response";

export class ExecutionApiError extends Error {
  constructor(
    readonly kind: ExecutionApiErrorKind,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ExecutionApiError";
  }
}

export type ExecutionDataResult<T> =
  | { readonly kind: "success"; readonly data: T }
  | { readonly kind: "error"; readonly error: ExecutionApiError };

const CONTRACT_STATUSES: readonly ContractPayoutStatus[] = [
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

const EXECUTION_STATES: readonly ExecutionJobState[] = [
  "Discovered",
  "Queued",
  "Leased",
  "Preparing",
  "SubmissionStarted",
  "SubmissionUnknown",
  "Submitted",
  "ConfirmationPending",
  "VerificationPending",
  "SettlementReady",
  "SettlementSubmitted",
  "Completed",
  "RetryableFailure",
  "ManualReview",
  "Abandoned",
];

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

export function executionApiBaseUrlFromEnvironment(
  environment: { readonly DISBURSE_EXECUTION_API_BASE_URL?: string } = process.env,
): string {
  const configured = environment.DISBURSE_EXECUTION_API_BASE_URL?.trim();
  if (!configured) {
    throw new ExecutionApiError(
      "configuration",
      "The execution service is not configured.",
    );
  }
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid URL");
    }
    return url.origin;
  } catch {
    throw new ExecutionApiError(
      "configuration",
      "The execution service configuration is invalid.",
    );
  }
}

export class ExecutionApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestHeaders: Headers;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    options: {
      readonly fetchImpl?: typeof fetch;
      readonly headers?: HeadersInit;
      readonly timeoutMs?: number;
    } = {},
  ) {
    this.baseUrl = executionApiBaseUrlFromEnvironment({
      DISBURSE_EXECUTION_API_BASE_URL: baseUrl,
    });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestHeaders = new Headers(options.headers);
    this.requestHeaders.set("accept", "application/json");
    this.timeoutMs = options.timeoutMs ?? 8_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new ExecutionApiError(
        "configuration",
        "The execution service timeout configuration is invalid.",
      );
    }
  }

  getCampaignAccounting(campaignId: string): Promise<CampaignAccounting> {
    const id = requireU64(campaignId, "campaign ID");
    return this.get(
      `/v1/campaigns/${id}/accounting`,
      (value) => {
        if (!isRecord(value) || !isRecord(value.data)) return null;
        const accounting = value.data.accounting;
        return isCampaignAccounting(accounting) &&
          accounting.campaignId === id
          ? accounting
          : null;
      },
    );
  }

  getCampaignPayout(
    campaignId: string,
    payoutId: string,
  ): Promise<ContractPayout> {
    const campaign = requireU64(campaignId, "campaign ID");
    const payout = requireU64(payoutId, "payout ID");
    return this.get(
      `/v1/campaigns/${campaign}/payouts/${payout}`,
      (value) => {
        if (!isRecord(value) || !isRecord(value.data)) return null;
        const result = value.data.payout;
        return isContractPayout(result) &&
          result.campaignId === campaign &&
          result.id === payout
          ? result
          : null;
      },
    );
  }

  getPayout(payoutId: string): Promise<ContractPayout> {
    const payout = requireU64(payoutId, "payout ID");
    return this.get(`/v1/payouts/${payout}`, (value) => {
      if (!isRecord(value) || !isRecord(value.data)) return null;
      const result = value.data.payout;
      return isContractPayout(result) && result.id === payout ? result : null;
    });
  }

  getCampaignPayouts(campaignId: string): Promise<CampaignPayoutList> {
    const id = requireU64(campaignId, "campaign ID");
    return this.get(
      `/v1/campaigns/${id}/payouts`,
      (value) => {
        if (!isRecord(value) || !isRecord(value.data)) return null;
        const result = value.data;
        if (
          result.campaignId !== id ||
          typeof result.truncated !== "boolean" ||
          !Array.isArray(result.jobs) ||
          !result.jobs.every(
            (job) =>
              isPersistedExecutionJob(job) && job.campaignId === id,
          )
        ) {
          return null;
        }
        return {
          campaignId: id,
          jobs: result.jobs,
          truncated: result.truncated,
        };
      },
    );
  }

  getCampaignExecutionJob(
    campaignId: string,
    payoutId: string,
  ): Promise<PersistedExecutionJob> {
    const campaign = requireU64(campaignId, "campaign ID");
    const payout = requireU64(payoutId, "payout ID");
    return this.get(
      `/v1/campaigns/${campaign}/payouts/${payout}/execution`,
      (value) => {
        if (!isRecord(value) || !isRecord(value.data)) return null;
        const result = value.data.job;
        return isPersistedExecutionJob(result) &&
          result.campaignId === campaign &&
          result.payoutId === payout
          ? result
          : null;
      },
    );
  }

  private async get<T>(
    path: string,
    validate: (value: unknown) => T | null,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(new URL(path, this.baseUrl), {
          method: "GET",
          headers: this.requestHeaders,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new ExecutionApiError(
          "unavailable",
          "The execution service is unavailable.",
        );
      }
      if (!response.ok) {
        if (response.status === 401) {
          throw new ExecutionApiError(
            "unauthorized",
            "You are not authorized to view execution data.",
            response.status,
          );
        }
        if (response.status === 403) {
          throw new ExecutionApiError(
            "forbidden",
            "You do not have permission to view this execution data.",
            response.status,
          );
        }
        if (response.status === 404) {
          throw new ExecutionApiError(
            "not-found",
            "The requested execution record was not found.",
            response.status,
          );
        }
        if (response.status >= 500) {
          throw new ExecutionApiError(
            "unavailable",
            "The execution service is unavailable.",
            response.status,
          );
        }
        throw new ExecutionApiError(
          "invalid-response",
          "The execution service rejected the request.",
          response.status,
        );
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ExecutionApiError(
          "invalid-response",
          "The execution service returned an invalid response.",
        );
      }
      const result = validate(body);
      if (result === null) {
        throw new ExecutionApiError(
          "invalid-response",
          "The execution service returned an unexpected response.",
        );
      }
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function formatAtomicAmount(atomicAmount: string, decimals: number): string {
  if (
    !/^(?:0|[1-9]\d{0,38})$/.test(atomicAmount) ||
    BigInt(atomicAmount) > U128_MAX ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new Error("Invalid token amount.");
  }
  const amount = BigInt(atomicAmount);
  if (decimals === 0) return groupInteger(amount.toString());
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fractional = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fractional
    ? `${groupInteger(whole.toString())}.${fractional}`
    : groupInteger(whole.toString());
}

export function formatTokenIdentity(token: TokenIdentity): string {
  return "Near" in token ? token.Near : token.External;
}

export function getContractStatusLabel(status: ContractPayoutStatus): string {
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function getExecutionStateLabel(state: ExecutionJobState): string {
  return state.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function isCampaignAccounting(value: unknown): value is CampaignAccounting {
  if (
    !isRecord(value) ||
    !isU64(value.campaignId) ||
    !isU128(value.budget) ||
    !isU128(value.funded) ||
    !isU128(value.reserved) ||
    !isU128(value.spent) ||
    !isU128(value.available) ||
    !isSafeText(value.tokenId, 64) ||
    typeof value.tokenDecimals !== "number" ||
    !Number.isInteger(value.tokenDecimals) ||
    value.tokenDecimals < 0 ||
    value.tokenDecimals > 255
  ) {
    return false;
  }
  const budget = BigInt(value.budget);
  const funded = BigInt(value.funded);
  const reserved = BigInt(value.reserved);
  const spent = BigInt(value.spent);
  const available = BigInt(value.available);
  return (
    funded <= budget &&
    reserved + spent <= funded &&
    available === funded - reserved - spent
  );
}

function isContractPayout(value: unknown): value is ContractPayout {
  return (
    isRecord(value) &&
    isU64(value.id) &&
    isU64(value.campaignId) &&
    isContractStatus(value.status) &&
    isRecord(value.source) &&
    isSafeText(value.source.networkId, 64) &&
    isTokenIdentity(value.source.token) &&
    isU128(value.source.atomicAmount) &&
    isDecimals(value.source.decimals) &&
    isRecord(value.destination) &&
    isSafeText(value.destination.networkId, 64) &&
    isSafeText(value.destination.recipientAddress, 128) &&
    isTokenIdentity(value.destination.token) &&
    isU128(value.destination.expectedAtomicAmount) &&
    isDecimals(value.destination.decimals) &&
    isIsoTimestampNs(value.createdAtNs) &&
    isNullableText(value.executionReference, 256) &&
    isNullableText(value.settlementEvidenceReference, 256)
  );
}

function isPersistedExecutionJob(
  value: unknown,
): value is PersistedExecutionJob {
  return (
    isRecord(value) &&
    isPositiveIntegerString(value.jobId) &&
    isU64(value.payoutId) &&
    isU64(value.campaignId) &&
    isExecutionState(value.state) &&
    isContractStatus(value.observedContractStatus) &&
    isRecord(value.source) &&
    isSafeText(value.source.tokenId, 256) &&
    isU128(value.source.atomicAmount) &&
    isDecimals(value.source.decimals) &&
    isRecord(value.destination) &&
    isSafeText(value.destination.networkId, 64) &&
    isSafeText(value.destination.recipientAddress, 128) &&
    isSafeText(value.destination.tokenId, 256) &&
    isU128(value.destination.expectedAtomicAmount) &&
    isDecimals(value.destination.decimals) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.updatedAt) &&
    Number.isSafeInteger(value.attemptCount) &&
    typeof value.attemptCount === "number" &&
    value.attemptCount >= 0 &&
    Array.isArray(value.attempts) &&
    value.attempts.every(isExecutionAttempt) &&
    (value.leaseExpiresAt === null || isIsoTimestamp(value.leaseExpiresAt)) &&
    (value.failureCode === null ||
      (isSafeText(value.failureCode, 64) &&
        /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.failureCode)))
  );
}

function isExecutionAttempt(value: unknown): value is ExecutionAttempt {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.sequence === "number" &&
    value.sequence > 0 &&
    typeof value.phase === "string" &&
    ["validate", "quote", "prepare", "submit", "confirm", "verify", "settle"].includes(
      value.phase,
    ) &&
    typeof value.outcome === "string" &&
    ["started", "accepted", "rejected", "unknown", "verified", "failed"].includes(
      value.outcome,
    ) &&
    isIsoTimestamp(value.startedAt)
  );
}

function isTokenIdentity(value: unknown): value is TokenIdentity {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    (("Near" in value && isSafeText(value.Near, 256)) ||
      ("External" in value && isSafeText(value.External, 256)))
  );
}

function isContractStatus(value: unknown): value is ContractPayoutStatus {
  return (
    typeof value === "string" &&
    CONTRACT_STATUSES.includes(value as ContractPayoutStatus)
  );
}

function isExecutionState(value: unknown): value is ExecutionJobState {
  return (
    typeof value === "string" &&
    EXECUTION_STATES.includes(value as ExecutionJobState)
  );
}

function isU64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,19})$/.test(value) &&
    BigInt(value) <= U64_MAX
  );
}

function isU128(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,38})$/.test(value) &&
    BigInt(value) <= U128_MAX
  );
}

function isPositiveIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

function isDecimals(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}

function isSafeText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u0020\u007f-\u009f]/.test(value)
  );
}

function isNullableText(value: unknown, maximumLength: number): value is string | null {
  return value === null || isSafeText(value, maximumLength);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isIsoTimestampNs(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,19})$/.test(value) &&
    BigInt(value) <= U64_MAX
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireU64(value: string, label: string): string {
  if (!isU64(value)) {
    throw new ExecutionApiError(
      "invalid-request",
      `The ${label} must be a canonical unsigned integer.`,
    );
  }
  return value;
}

function groupInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
