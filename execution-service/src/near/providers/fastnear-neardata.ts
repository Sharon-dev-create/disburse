import { createHash } from "node:crypto";
import type { RawNearEvent } from "../../discovery/events.ts";
import type { DiscoveryBlockObservation } from "../../discovery/repository.ts";
import type { NearEventPage, NearEventSource } from "../../discovery/source.ts";

export type NearDataNetwork = "mainnet" | "testnet";

export type NearDataErrorKind =
  | "timeout"
  | "unavailable"
  | "rate-limited"
  | "missing-history"
  | "configuration"
  | "malformed"
  | "cursor-corruption"
  | "block-continuity-failure"
  | "network-mismatch";

export class NearDataProviderError extends Error {
  readonly kind: NearDataErrorKind;
  readonly retryable: boolean;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    kind: NearDataErrorKind,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "NearDataProviderError";
    this.kind = kind;
    this.retryable = ["timeout", "unavailable", "rate-limited"].includes(kind);
    this.context = context;
  }
}

export interface FastNearNearDataConfig {
  readonly network: NearDataNetwork;
  readonly contractId: string;
  readonly startBlockHeight: string;
  readonly firstBlockHeight?: string;
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly retryAttempts?: number;
  readonly maxBlocksPerPage?: number;
}

interface BlockCursor {
  readonly version: 1;
  readonly nextBlockHeight: string;
  readonly logOffset: number;
  readonly previousBlockHash: string | null;
  readonly currentBlockHash: string | null;
}

interface ContractLog {
  readonly receiptId: string;
  readonly transactionHash: string;
  readonly eventIndex: number;
  readonly log: string;
}

interface FinalizedBlock {
  readonly height: string;
  readonly hash: string;
  readonly previousHash: string;
  readonly logs: readonly ContractLog[];
  readonly observation: DiscoveryBlockObservation;
}

export interface NearDataDiagnostics {
  readonly network: NearDataNetwork;
  readonly contractId: string;
  readonly startBlockHeight: string;
  readonly connected: boolean;
  readonly finalityPolicy: "finalized-only";
  readonly reorgRetractions: "not-supported";
  readonly lastObservedBlock: string | null;
  readonly lastFinalizedBlockHeight: string | null;
  readonly lastPageCursor: string | null;
  readonly eventsRetrieved: number;
  readonly blocksScanned: number;
  readonly pagesRead: number;
  readonly requests: number;
  readonly lastSuccessfulPollAtMs: number | null;
}

/**
 * Read-only adapter for FastNear NEAR Data's finalized block archive.
 * Cursors point to the next raw contract log (or next block when a block is drained).
 */
export class FastNearNearDataEventSource implements NearEventSource {
  readonly providerId = "fastnear-neardata";
  private readonly network: NearDataNetwork;
  private readonly contractId: string;
  private readonly startBlockHeight: bigint;
  private readonly firstBlockHeight: bigint;
  private readonly endpoint: URL;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly maxBlocksPerPage: number;
  private readonly fetchImpl: typeof fetch;
  private requestCount = 0;
  private retrievedEvents = 0;
  private scannedBlocks = 0;
  private readPages = 0;
  private lastObservedBlock: string | null = null;
  private lastFinalizedBlockHeight: string | null = null;
  private lastPageCursor: string | null = null;
  private lastSuccessfulPollAtMs: number | null = null;
  private connected = false;
  private networkVerified = false;

  constructor(config: FastNearNearDataConfig, fetchImpl: typeof fetch = fetch) {
    this.network = config.network;
    this.contractId = config.contractId.trim();
    this.startBlockHeight = parseHeight(
      config.startBlockHeight,
      "start block height",
    );
    this.firstBlockHeight = parseHeight(
      config.firstBlockHeight ??
        (config.network === "testnet" ? "42376888" : "9820210"),
      "first block height",
    );
    this.endpoint = new URL(
      config.endpoint ??
        (config.network === "testnet"
          ? "https://testnet.neardata.xyz"
          : "https://mainnet.neardata.xyz"),
    );
    if (
      this.endpoint.protocol !== "https:" &&
      this.endpoint.protocol !== "http:"
    )
      throw new Error("NEAR Data endpoint must use HTTP or HTTPS");
    if (!this.contractId)
      throw new Error("Disburse contract account ID is required");
    if (
      config.endpoint === undefined &&
      this.endpoint.hostname !==
        (config.network === "testnet"
          ? "testnet.neardata.xyz"
          : "mainnet.neardata.xyz")
    ) {
      throw new Error("NEAR Data endpoint does not match configured network");
    }
    this.apiKey = config.apiKey?.trim() || undefined;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.maxBlocksPerPage = config.maxBlocksPerPage ?? 100;
    this.fetchImpl = fetchImpl;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0)
      throw new Error("NEAR Data timeout must be a positive safe integer");
    if (
      !Number.isSafeInteger(this.retryAttempts) ||
      this.retryAttempts < 1 ||
      this.retryAttempts > 5
    )
      throw new Error("NEAR Data retry attempts must be between 1 and 5");
    if (
      !Number.isSafeInteger(this.maxBlocksPerPage) ||
      this.maxBlocksPerPage < 1 ||
      this.maxBlocksPerPage > 1_000
    )
      throw new Error("NEAR Data block scan bound must be between 1 and 1000");
  }

  static fromEnvironment(
    env: NodeJS.ProcessEnv = process.env,
    fetchImpl: typeof fetch = fetch,
  ): FastNearNearDataEventSource {
    const network = env.NEAR_NETWORK;
    if (network !== "mainnet" && network !== "testnet")
      throw new Error("NEAR_NETWORK must be mainnet or testnet");
    const contractId = env.DISBURSE_CONTRACT_ID;
    if (!contractId?.trim())
      throw new Error("DISBURSE_CONTRACT_ID must be configured");
    const startBlockHeight = env.NEAR_DISCOVERY_START_BLOCK;
    if (!startBlockHeight?.trim())
      throw new Error("NEAR_DISCOVERY_START_BLOCK must be configured");
    return new FastNearNearDataEventSource(
      {
        network,
        contractId,
        startBlockHeight,
        ...(env.NEAR_DATA_FIRST_BLOCK_HEIGHT
          ? { firstBlockHeight: env.NEAR_DATA_FIRST_BLOCK_HEIGHT }
          : {}),
        ...(env.NEAR_DATA_ENDPOINT ? { endpoint: env.NEAR_DATA_ENDPOINT } : {}),
        ...(env.FASTNEAR_API_KEY ? { apiKey: env.FASTNEAR_API_KEY } : {}),
      },
      fetchImpl,
    );
  }

  getDiagnostics(): NearDataDiagnostics {
    return {
      network: this.network,
      contractId: this.contractId,
      startBlockHeight: this.startBlockHeight.toString(),
      connected: this.connected,
      finalityPolicy: "finalized-only",
      reorgRetractions: "not-supported",
      lastObservedBlock: this.lastObservedBlock,
      lastFinalizedBlockHeight: this.lastFinalizedBlockHeight,
      lastPageCursor: this.lastPageCursor,
      eventsRetrieved: this.retrievedEvents,
      blocksScanned: this.scannedBlocks,
      pagesRead: this.readPages,
      requests: this.requestCount,
      lastSuccessfulPollAtMs: this.lastSuccessfulPollAtMs,
    };
  }

  async readAfter(
    cursor: string | null,
    limit: number,
  ): Promise<NearEventPage> {
    const position =
      cursor === null
        ? initialCursor(this.startBlockHeight)
        : decodeCursor(cursor);
    return this.read(position, limit);
  }

  async readFrom(startPosition: string, limit: number): Promise<NearEventPage> {
    const height = parseHeight(startPosition, "historical start position");
    return this.read(initialCursor(height), limit);
  }

  async readRange(
    startBlockHeight: string,
    endBlockHeight: string,
    cursor: string | null,
    limit: number,
  ): Promise<NearEventPage> {
    const start = parseHeight(startBlockHeight, "recovery start height");
    const end = parseHeight(endBlockHeight, "recovery end height");
    if (end < start)
      throw new NearDataProviderError(
        "configuration",
        "Recovery range end precedes its start",
        { startBlockHeight, endBlockHeight },
      );
    return this.read(
      cursor === null ? initialCursor(start) : decodeCursor(cursor),
      limit,
      end,
    );
  }

  private async read(
    position: BlockCursor,
    limit: number,
    endHeight: bigint | null = null,
  ): Promise<NearEventPage> {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error("Event page limit must be a positive safe integer");
    const events: RawNearEvent[] = [];
    const blocks: DiscoveryBlockObservation[] = [];
    let current = position;
    let blocksScanned = 0;
    await this.verifyNetwork();
    const head = await this.getFinalizedHead();
    const effectiveHead =
      endHeight === null || endHeight > BigInt(head.height)
        ? BigInt(head.height)
        : endHeight;
    while (BigInt(current.nextBlockHeight) <= effectiveHead) {
      if (blocksScanned >= this.maxBlocksPerPage) break;
      const block = await this.getFinalizedBlock(current.nextBlockHeight);
      validateCanonicalBlock(block, current);
      blocks.push(block.observation);
      this.lastObservedBlock = block.height;
      this.scannedBlocks += 1;
      blocksScanned += 1;

      if (
        current.currentBlockHash !== null &&
        current.currentBlockHash !== block.hash
      )
        throw new NearDataProviderError(
          "block-continuity-failure",
          "Finalized block hash changed while resuming an event cursor",
          {
            blockHeight: block.height,
            expectedBlockHash: current.currentBlockHash,
            observedBlockHash: block.hash,
          },
        );
      const offset = current.currentBlockHash === null ? 0 : current.logOffset;
      if (offset > block.logs.length)
        throw new NearDataProviderError(
          "cursor-corruption",
          "NEAR Data cursor exceeds block log count",
          {
            blockHeight: block.height,
            logOffset: offset,
            availableLogs: block.logs.length,
          },
        );

      for (let index = offset; index < block.logs.length; index += 1) {
        const item = block.logs[index];
        if (!item) continue;
        const afterEvent = nextCursorForEvent(block, index + 1);
        events.push({
          identity: {
            networkId: this.network,
            contractId: this.contractId,
            blockHeight: block.height,
            blockHash: block.hash,
            transactionHash: item.transactionHash,
            receiptId: item.receiptId,
            eventIndex: item.eventIndex,
          },
          log: item.log,
          cursor: encodeCursor(afterEvent),
        });
        current = afterEvent;
        if (events.length >= limit) {
          const drainedBlock = index + 1 >= block.logs.length;
          const checkpoint = drainedBlock ? nextBlockCursor(block) : afterEvent;
          const hasMore = BigInt(checkpoint.nextBlockHeight) <= effectiveHead;
          return this.finish(events, blocks, checkpoint, hasMore);
        }
      }

      current = nextBlockCursor(block);
    }
    const hasMore = BigInt(current.nextBlockHeight) <= effectiveHead;
    return this.finish(events, blocks, current, hasMore);
  }

  private finish(
    events: readonly RawNearEvent[],
    blocks: readonly DiscoveryBlockObservation[],
    cursor: BlockCursor,
    hasMore: boolean,
  ): NearEventPage {
    const encoded = encodeCursor(cursor);
    this.retrievedEvents += events.length;
    this.readPages += 1;
    this.lastPageCursor = encoded;
    this.lastSuccessfulPollAtMs = Date.now();
    this.connected = true;
    return { events, blocks, nextCursor: encoded, hasMore };
  }

  private async verifyNetwork(): Promise<void> {
    if (this.networkVerified) return;
    const body = await this.getJson("/v0/first_block");
    const block = parseBlock(body, null, this.network, this.contractId);
    if (BigInt(block.height) !== this.firstBlockHeight)
      throw new NearDataProviderError(
        "network-mismatch",
        "NEAR Data first block does not match the configured network",
        {
          expectedFirstBlockHeight: this.firstBlockHeight.toString(),
          observedFirstBlockHeight: block.height,
        },
      );
    this.networkVerified = true;
  }

  private async getFinalizedHead(): Promise<FinalizedBlock> {
    const body = await this.getJson("/v0/last_block/final");
    const block = parseBlock(body, null, this.network, this.contractId);
    this.lastFinalizedBlockHeight = block.height;
    return block;
  }

  private async getFinalizedBlock(height: string): Promise<FinalizedBlock> {
    const body = await this.getJson(`/v0/block/${height}`);
    if (body === null)
      throw new NearDataProviderError(
        "missing-history",
        `NEAR Data has no finalized block at requested height ${height}`,
        { blockHeight: height },
      );
    return parseBlock(body, height, this.network, this.contractId);
  }

  private async getJson(path: string): Promise<unknown> {
    let lastError: NearDataProviderError | null = null;
    for (let attempt = 0; attempt < this.retryAttempts; attempt += 1) {
      const url = new URL(path, this.endpoint);
      if (this.apiKey) url.searchParams.set("apiKey", this.apiKey);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        this.requestCount += 1;
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (response.status === 429) {
          lastError = new NearDataProviderError(
            "rate-limited",
            "NEAR Data rate limit was reached",
          );
        } else if (response.status >= 500) {
          lastError = new NearDataProviderError(
            "unavailable",
            `NEAR Data returned HTTP ${response.status}`,
          );
        } else if (response.status === 404) {
          throw new NearDataProviderError(
            "missing-history",
            "NEAR Data does not have the requested historical resource",
            { path },
          );
        } else if (response.status === 401 || response.status === 403) {
          throw new NearDataProviderError(
            "configuration",
            `NEAR Data rejected the configured credentials (HTTP ${response.status})`,
          );
        } else if (!response.ok) {
          throw new NearDataProviderError(
            "malformed",
            `NEAR Data returned HTTP ${response.status}`,
          );
        } else {
          try {
            const result: unknown = await response.json();
            this.connected = true;
            return result;
          } catch {
            throw new NearDataProviderError(
              "malformed",
              "NEAR Data returned invalid JSON",
            );
          }
        }
      } catch (error) {
        if (error instanceof NearDataProviderError) {
          if (!error.retryable) throw error;
          lastError = error;
        } else if (controller.signal.aborted) {
          lastError = new NearDataProviderError(
            "timeout",
            "NEAR Data request timed out",
          );
        } else {
          lastError = new NearDataProviderError(
            "unavailable",
            "NEAR Data request failed",
          );
        }
      } finally {
        clearTimeout(timer);
      }
      if (attempt + 1 < this.retryAttempts)
        await delay(Math.min(1_000, 100 * 2 ** attempt));
    }
    this.connected = false;
    throw (
      lastError ??
      new NearDataProviderError("unavailable", "NEAR Data request failed")
    );
  }
}

function parseBlock(
  value: unknown,
  expectedHeight: string | null,
  networkId: string,
  contractId: string,
): FinalizedBlock {
  const root = record(value, "block response");
  const block = record(root.block, "block envelope");
  const header = record(block.header, "block header");
  const height = parseHeight(header.height, "block height").toString();
  const hash = nonEmptyString(header.hash, "block hash");
  const previousHash = nonEmptyString(header.prev_hash, "previous block hash");
  if (expectedHeight !== null && height !== expectedHeight)
    throw new NearDataProviderError(
      "block-continuity-failure",
      "NEAR Data returned a different block height",
      { expectedBlockHeight: expectedHeight, observedBlockHeight: height },
    );
  if (!Array.isArray(root.shards))
    throw new NearDataProviderError(
      "malformed",
      "NEAR Data block has no shards array",
    );

  const shards = root.shards
    .map((entry) => {
      const shard = record(entry, "shard");
      return {
        shardId: parseHeight(shard.shard_id, "shard ID"),
        outcomes: array(
          shard.receipt_execution_outcomes,
          "receipt execution outcomes",
        ),
      };
    })
    .sort((left, right) =>
      left.shardId < right.shardId ? -1 : left.shardId > right.shardId ? 1 : 0,
    );

  const logs: ContractLog[] = [];
  const contractReceipts: unknown[] = [];
  let contractLogCount = 0;
  for (const shard of shards) {
    for (const [outcomeIndex, outcomeValue] of shard.outcomes.entries()) {
      const outcomeWithReceipt = record(
        outcomeValue,
        "receipt execution outcome",
      );
      const execution = record(
        outcomeWithReceipt.execution_outcome,
        "execution outcome",
      );
      const result = record(execution.outcome, "execution outcome result");
      if (result.executor_id !== contractId) continue;
      const receiptId = nonEmptyString(execution.id, "receipt ID");
      const transactionHash = nonEmptyString(
        outcomeWithReceipt.tx_hash,
        "originating transaction hash",
      );
      const blockHash = nonEmptyString(
        execution.block_hash,
        "execution block hash",
      );
      if (blockHash !== hash)
        throw new NearDataProviderError(
          "block-continuity-failure",
          "Receipt outcome block hash differs from its block header",
          {
            blockHeight: height,
            expectedBlockHash: hash,
            observedBlockHash: blockHash,
            receiptId,
          },
        );
      const rawLogs = array(result.logs, "execution logs");
      const receiptLogs: string[] = [];
      rawLogs.forEach((log, eventIndex) => {
        if (typeof log !== "string")
          throw new NearDataProviderError(
            "malformed",
            "NEAR Data execution log is not a string",
          );
        logs.push({ receiptId, transactionHash, eventIndex, log });
        receiptLogs.push(log);
      });
      contractReceipts.push({
        shardId: shard.shardId.toString(),
        outcomeIndex,
        receiptId,
        transactionHash,
        blockHash,
        logs: receiptLogs,
      });
      contractLogCount += receiptLogs.length;
    }
  }
  const canonicalPayloadHash = sha256(JSON.stringify(contractReceipts));
  return {
    height,
    hash,
    previousHash,
    logs,
    observation: {
      networkId,
      contractId,
      blockHeight: height,
      blockHash: hash,
      parentBlockHash: previousHash,
      providerId: "fastnear-neardata",
      contractReceiptCount: contractReceipts.length,
      contractLogCount,
      canonicalPayloadHash,
    },
  };
}

function validateCanonicalBlock(
  block: FinalizedBlock,
  cursor: BlockCursor,
): void {
  if (
    cursor.currentBlockHash !== null &&
    cursor.currentBlockHash !== block.hash
  )
    throw new NearDataProviderError(
      "block-continuity-failure",
      "Finalized block hash changed while resuming an event cursor",
      {
        blockHeight: block.height,
        expectedBlockHash: cursor.currentBlockHash,
        observedBlockHash: block.hash,
      },
    );
  if (
    cursor.currentBlockHash === null &&
    cursor.previousBlockHash !== null &&
    block.previousHash !== cursor.previousBlockHash
  )
    throw new NearDataProviderError(
      "block-continuity-failure",
      "Finalized block chain does not connect to the persisted cursor",
      {
        blockHeight: block.height,
        expectedParentHash: cursor.previousBlockHash,
        observedParentHash: block.previousHash,
      },
    );
  if (cursor.currentBlockHash !== null && cursor.logOffset > block.logs.length)
    throw new NearDataProviderError(
      "cursor-corruption",
      "NEAR Data cursor exceeds block log count",
      {
        blockHeight: block.height,
        logOffset: cursor.logOffset,
        availableLogs: block.logs.length,
      },
    );
}

function nextCursorForEvent(
  block: FinalizedBlock,
  offset: number,
): BlockCursor {
  return {
    version: 1,
    nextBlockHeight: block.height,
    logOffset: offset,
    previousBlockHash: block.previousHash,
    currentBlockHash: block.hash,
  };
}

function nextBlockCursor(block: FinalizedBlock): BlockCursor {
  return {
    version: 1,
    nextBlockHeight: (BigInt(block.height) + 1n).toString(),
    logOffset: 0,
    previousBlockHash: block.hash,
    currentBlockHash: null,
  };
}

function initialCursor(height: bigint): BlockCursor {
  return {
    version: 1,
    nextBlockHeight: height.toString(),
    logOffset: 0,
    previousBlockHash: null,
    currentBlockHash: null,
  };
}

function encodeCursor(cursor: BlockCursor): string {
  return `near-data:v1:${BufferlessBase64.encode(JSON.stringify(cursor))}`;
}

function decodeCursor(cursor: string): BlockCursor {
  const prefix = "near-data:v1:";
  if (!cursor.startsWith(prefix))
    throw new NearDataProviderError(
      "cursor-corruption",
      "Unknown NEAR Data cursor format",
    );
  try {
    const parsed: unknown = JSON.parse(
      BufferlessBase64.decode(cursor.slice(prefix.length)),
    );
    const value = record(parsed, "cursor");
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.logOffset) ||
      Number(value.logOffset) < 0 ||
      (value.currentBlockHash === null && Number(value.logOffset) !== 0) ||
      (value.currentBlockHash !== null && Number(value.logOffset) === 0)
    )
      throw new Error("invalid");
    const previousBlockHash =
      value.previousBlockHash === null
        ? null
        : nonEmptyString(value.previousBlockHash, "cursor previous block hash");
    const currentBlockHash =
      value.currentBlockHash === null
        ? null
        : nonEmptyString(value.currentBlockHash, "cursor current block hash");
    return {
      version: 1,
      nextBlockHeight: parseHeight(
        value.nextBlockHeight,
        "cursor block height",
      ).toString(),
      logOffset: Number(value.logOffset),
      previousBlockHash,
      currentBlockHash,
    };
  } catch {
    throw new NearDataProviderError(
      "cursor-corruption",
      "Invalid NEAR Data cursor",
    );
  }
}

function parseHeight(value: unknown, label: string): bigint {
  if (typeof value !== "string" && typeof value !== "number")
    throw new NearDataProviderError(
      "malformed",
      `NEAR Data ${label} is invalid`,
    );
  const text = String(value);
  if (!/^\d+$/.test(text))
    throw new NearDataProviderError(
      "malformed",
      `NEAR Data ${label} is invalid`,
    );
  try {
    const height = BigInt(text);
    if (height > 18_446_744_073_709_551_615n) throw new Error("too large");
    return height;
  } catch {
    throw new NearDataProviderError(
      "malformed",
      `NEAR Data ${label} is outside u64 range`,
    );
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new NearDataProviderError(
      "malformed",
      `NEAR Data ${label} is not an object`,
    );
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value))
    throw new NearDataProviderError(
      "malformed",
      `NEAR Data ${label} is not an array`,
    );
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new NearDataProviderError(
      "malformed",
      `NEAR Data ${label} is missing`,
    );
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Small base64url codec avoids adding a dependency to the execution package. */
const BufferlessBase64 = {
  encode(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
  },
  decode(value: string): string {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(
      normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
    );
    return new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  },
};
