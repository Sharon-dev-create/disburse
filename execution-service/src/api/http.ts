import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { NearRpcError } from "../near/rpc.ts";
import { NearContractReader } from "../near/rpc.ts";

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const PAYOUT_STATUSES = [
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
] as const;

export interface ExecutionApiOptions {
  readonly reader: NearContractReader;
  readonly authorize: (
    request: IncomingMessage,
  ) => boolean | Promise<boolean>;
  readonly now?: () => Date;
}

export interface ExecutionApiListenOptions {
  readonly host?: string;
  readonly port: number;
}

export async function startExecutionApiServer(
  options: ExecutionApiOptions,
  listen: ExecutionApiListenOptions,
): Promise<Server> {
  validateOptions(options, listen);
  await options.reader.verifyNetwork();
  await options.reader.isPaused();

  const server = createExecutionApiServer(options);
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(listen.port, listen.host ?? "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    });
  } catch (error) {
    server.close();
    throw error;
  }
  return server;
}

function createExecutionApiServer(options: ExecutionApiOptions): Server {
  return createServer((request, response) => {
    void handleRequest(options, request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        const result = errorResponse(error);
        sendError(response, result.statusCode, result.code, result.message);
      } else {
        response.destroy();
      }
    });
  });
}

async function handleRequest(
  options: ExecutionApiOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const pathname = requestPathname(request.url);
  if (pathname === "/healthz" && request.method === "GET") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (!(await options.authorize(request))) {
    response.setHeader("www-authenticate", "Bearer");
    sendError(response, 401, "unauthorized", "Authentication is required.");
    return;
  }

  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendError(response, 405, "method_not_allowed", "Only GET requests are supported.");
    return;
  }
  if (hasRequestBody(request) || request.url?.includes("?")) {
    sendError(response, 400, "invalid_request", "This endpoint does not accept a body or query parameters.");
    return;
  }

  const payoutMatch = /^\/v1\/payouts\/([^/]+)$/.exec(pathname);
  const campaignPayoutMatch = /^\/v1\/campaigns\/([^/]+)\/payouts\/([^/]+)$/.exec(pathname);
  const accountingMatch = /^\/v1\/campaigns\/([^/]+)\/accounting$/.exec(pathname);

  if (payoutMatch) {
    const payoutId = parseU64PathId(payoutMatch[1] ?? "", "payout ID");
    const payout = await options.reader.getPayout(payoutId);
    if (!payout) {
      sendError(response, 404, "payout_not_found", "The payout does not exist on the configured contract.");
      return;
    }
    sendJson(response, 200, payoutEnvelope(options, payout));
    return;
  }

  if (campaignPayoutMatch) {
    const campaignId = parseU64PathId(campaignPayoutMatch[1] ?? "", "campaign ID");
    const payoutId = parseU64PathId(campaignPayoutMatch[2] ?? "", "payout ID");
    const payout = await options.reader.getCampaignPayout(campaignId, payoutId);
    if (!payout) {
      sendError(response, 404, "payout_not_found", "The campaign payout does not exist on the configured contract.");
      return;
    }
    sendJson(response, 200, payoutEnvelope(options, payout));
    return;
  }

  if (accountingMatch) {
    const campaignId = parseU64PathId(accountingMatch[1] ?? "", "campaign ID");
    const accounting = await options.reader.getCampaignPayoutAccounting(campaignId);
    if (!accounting) {
      sendError(response, 404, "campaign_not_found", "The campaign does not exist on the configured contract.");
      return;
    }
    sendJson(response, 200, accountingEnvelope(options, accounting));
    return;
  }

  sendError(response, 404, "route_not_found", "The requested endpoint does not exist.");
}

function payoutEnvelope(options: ExecutionApiOptions, payout: unknown) {
  const networkId = nearNetworkId(options.reader.config.networkId);
  const contractId = contractAccountId(
    options.reader.config.networkId,
    options.reader.config.contractId,
  );
  const parsed = parsePayoutResponse(payout, networkId);
  return {
    data: {
      networkId,
      contractId,
      payout: parsed,
    },
    meta: { readAt: readTimestamp(options.now) },
  };
}

function accountingEnvelope(
  options: ExecutionApiOptions,
  accounting: {
    readonly campaignId: string;
    readonly budget: string;
    readonly funded: string;
    readonly reserved: string;
    readonly spent: string;
    readonly available: string;
  },
) {
  const networkId = nearNetworkId(options.reader.config.networkId);
  const contractId = contractAccountId(
    options.reader.config.networkId,
    options.reader.config.contractId,
  );
  const parsed = parseAccountingResponse(accounting);
  return {
    data: {
      networkId,
      contractId,
      accounting: parsed,
    },
    meta: { readAt: readTimestamp(options.now) },
  };
}

function parsePayoutResponse(value: unknown, networkId: "mainnet" | "testnet") {
  if (!isRecord(value) || !isRecord(value.destination)) {
    throw new ResponseValidationError("Contract returned an invalid payout.");
  }
  const id = parseU64(value.id, "payout ID");
  const campaignId = parseU64(value.campaignId, "campaign ID");
  if (
    typeof value.status !== "string" ||
    !(PAYOUT_STATUSES as readonly string[]).includes(value.status)
  ) {
    throw new ResponseValidationError("Contract returned an unknown payout status.");
  }
  const inputAmount = parseTokenAmount(value.inputAmount);
  const expectedOutputAmount = parseTokenAmount(value.expectedOutputAmount);
  const destinationNetworkId = parseDestinationNetworkId(value.destination.chainId);
  const recipientAddress = parseDestinationAddress(
    destinationNetworkId,
    value.destination.recipientAddress,
  );
  const createdAtNs = parseU64(value.createdAtNs, "payout creation timestamp");
  const executionReference = nullableReference(value.executionReference);
  const settlementEvidenceReference = nullableReference(
    value.settlementEvidenceReference,
  );

  return {
    id,
    campaignId,
    status: value.status,
    source: {
      networkId: `near:${networkId}`,
      token: inputAmount.token,
      atomicAmount: inputAmount.atomicAmount,
      decimals: inputAmount.decimals,
    },
    destination: {
      networkId: destinationNetworkId,
      recipientAddress,
      token: expectedOutputAmount.token,
      expectedAtomicAmount: expectedOutputAmount.atomicAmount,
      decimals: expectedOutputAmount.decimals,
    },
    createdAtNs,
    executionReference,
    settlementEvidenceReference,
  };
}

function parseTokenAmount(value: unknown) {
  if (!isRecord(value) || !isRecord(value.tokenId)) {
    throw new ResponseValidationError("Contract returned an invalid token amount.");
  }
  const tokenKeys = Object.keys(value.tokenId);
  if (
    tokenKeys.length !== 1 ||
    (tokenKeys[0] !== "Near" && tokenKeys[0] !== "External")
  ) {
    throw new ResponseValidationError("Contract returned an invalid token identity.");
  }
  const tokenKey = tokenKeys[0];
  const tokenId = safeIdentifier(
    value.tokenId[tokenKey],
    "token identifier",
    256,
  );
  if (
    typeof value.decimals !== "number" ||
    !Number.isInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > 255
  ) {
    throw new ResponseValidationError("Contract returned invalid token decimals.");
  }
  const atomicAmount = parseU128(value.atomicAmount, "token amount");
  if (BigInt(atomicAmount) <= 0n) {
    throw new ResponseValidationError("Contract returned a non-positive payout amount.");
  }
  return {
    token: tokenKey === "Near" ? { Near: tokenId } : { External: tokenId },
    atomicAmount,
    decimals: value.decimals,
  };
}

function parseAccountingResponse(accounting: unknown) {
  if (!isRecord(accounting)) {
    throw new ResponseValidationError("Contract returned invalid campaign accounting.");
  }
  const campaignId = parseU64(accounting.campaignId, "campaign ID");
  const budget = parseU128(accounting.budget, "campaign budget");
  const funded = parseU128(accounting.funded, "funded amount");
  const reserved = parseU128(accounting.reserved, "reserved amount");
  const spent = parseU128(accounting.spent, "spent amount");
  const available = parseU128(accounting.available, "available amount");

  if (
    BigInt(funded) > BigInt(budget) ||
    BigInt(reserved) + BigInt(spent) > BigInt(funded) ||
    BigInt(available) !== BigInt(funded) - BigInt(reserved) - BigInt(spent)
  ) {
    throw new ResponseValidationError("Contract returned inconsistent campaign accounting.");
  }
  return { campaignId, budget, funded, reserved, spent, available };
}

function parseDestinationNetworkId(value: unknown): string {
  const networkId = safeIdentifier(value, "destination network ID", 64);
  if (!/^(?:near:(?:mainnet|testnet)|eip155:[1-9][0-9]*)$/.test(networkId)) {
    throw new ResponseValidationError("Contract returned an unsupported destination network identifier.");
  }
  return networkId;
}

function parseDestinationAddress(networkId: string, value: unknown): string {
  const address = safeIdentifier(value, "destination address", 128);
  if (networkId.startsWith("eip155:") && !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new ResponseValidationError("Contract returned an invalid EVM destination address.");
  }
  if (networkId.startsWith("near:")) {
    const validNamed =
      address.length >= 2 &&
      address.length <= 64 &&
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(address);
    const validImplicit = /^[0-9a-f]{64}$/.test(address);
    if (!validNamed && !validImplicit) {
      throw new ResponseValidationError("Contract returned an invalid NEAR destination address.");
    }
  }
  return address;
}

function parseU64PathId(value: string, label: string): string {
  try {
    return parseU64(decodeURIComponent(value), label);
  } catch (error) {
    if (error instanceof ResponseValidationError) {
      throw new RequestValidationError(error.message);
    }
    throw new RequestValidationError(`Invalid ${label}.`);
  }
}

function parseU64(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]{0,19})$/.test(value) ||
    BigInt(value) > U64_MAX
  ) {
    throw new ResponseValidationError(`Contract returned an invalid ${label}.`);
  }
  return value;
}

function parseU128(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]{0,38})$/.test(value) ||
    BigInt(value) > U128_MAX
  ) {
    throw new ResponseValidationError(`Contract returned an invalid ${label}.`);
  }
  return value;
}

function safeIdentifier(value: unknown, label: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    throw new ResponseValidationError(`Contract returned an invalid ${label}.`);
  }
  return value;
}

function nullableReference(value: unknown): string | null {
  if (value === null) return null;
  return safeIdentifier(value, "payout reference", 256);
}

function nearNetworkId(value: string): "mainnet" | "testnet" {
  if (value !== "mainnet" && value !== "testnet") {
    throw new Error("The API supports only configured NEAR mainnet or testnet readers.");
  }
  return value;
}

function contractAccountId(networkId: string, value: string): string {
  const account = safeIdentifier(value, "contract account ID", 64);
  const suffix = networkId === "testnet" ? ".testnet" : ".near";
  const base = account.slice(0, -suffix.length);
  if (
    !account.endsWith(suffix) ||
    base.length < 2 ||
    base.length > 64 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(base)
  ) {
    throw new Error("Contract account ID does not match the configured NEAR network.");
  }
  return account;
}

function readTimestamp(now: (() => Date) | undefined): string {
  const value = (now ?? (() => new Date()))().toISOString();
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("The API clock returned an invalid timestamp.");
  }
  return value;
}

function requestPathname(requestUrl: string | undefined): string {
  try {
    return new URL(requestUrl ?? "/", "http://localhost").pathname;
  } catch {
    throw new RequestValidationError("Invalid request URL.");
  }
}

function hasRequestBody(request: IncomingMessage): boolean {
  const length = request.headers["content-length"];
  return (
    request.headers["transfer-encoding"] !== undefined ||
    (length !== undefined && length !== "0")
  );
}

function validateOptions(
  options: ExecutionApiOptions,
  listen: ExecutionApiListenOptions,
): void {
  nearNetworkId(options.reader.config.networkId);
  contractAccountId(
    options.reader.config.networkId,
    options.reader.config.contractId,
  );
  if (typeof options.authorize !== "function") {
    throw new Error("An API request authorizer is required.");
  }
  if (
    !Number.isInteger(listen.port) ||
    listen.port < 0 ||
    listen.port > 65_535
  ) {
    throw new Error("API port must be an integer from 0 to 65535.");
  }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  sendJson(response, statusCode, { error: { code, message } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(error: unknown): {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof RequestValidationError) {
    return {
      statusCode: 400,
      code: "invalid_request",
      message: error.message,
    };
  }
  if (error instanceof ResponseValidationError) {
    return {
      statusCode: 502,
      code: "invalid_contract_response",
      message: "The configured contract returned data that failed validation.",
    };
  }
  if (error instanceof NearRpcError) {
    return {
      statusCode:
        error.kind === "timeout" ||
        error.kind === "unavailable" ||
        error.kind === "rate-limited"
          ? 503
          : 502,
      code: "near_rpc_failure",
      message: "The configured NEAR RPC could not provide a valid contract view.",
    };
  }
  return {
    statusCode: 500,
    code: "internal_error",
    message: "The request could not be completed.",
  };
}

class RequestValidationError extends Error {}
class ResponseValidationError extends Error {}
