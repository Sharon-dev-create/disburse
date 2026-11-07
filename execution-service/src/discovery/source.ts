import type { RawNearEvent } from "./events.ts";
import type { DiscoveryBlockObservation } from "./repository.ts";

/** Implementations must return finalized events in deterministic chain order and replay all gaps. */
export interface NearEventSource {
  readonly providerId: string;
  readAfter(cursor: string | null, limit: number): Promise<NearEventPage>;
  readFrom(startPosition: string, limit: number): Promise<NearEventPage>;
  readRange(
    startBlockHeight: string,
    endBlockHeight: string,
    cursor: string | null,
    limit: number,
  ): Promise<NearEventPage>;
}

export interface NearEventPage {
  readonly events: readonly RawNearEvent[];
  readonly blocks: readonly DiscoveryBlockObservation[];
  /**
   * Source checkpoint after the page, including scanned positions without events.
   * It must not pass an event omitted from this page and is committed only after
   * all returned events commit.
   */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** Deterministic event provider for tests and local pipeline development. */
export class MockNearEventSource implements NearEventSource {
  readonly providerId = "deterministic-mock";
  private readonly entries: readonly RawNearEvent[];

  constructor(events: readonly RawNearEvent[]) {
    this.entries = [...events];
  }

  async readAfter(
    cursor: string | null,
    limit: number,
  ): Promise<NearEventPage> {
    let index = 0;
    if (cursor !== null) {
      const cursorIndex = this.entries.findIndex(
        (event) => event.cursor === cursor,
      );
      if (cursorIndex < 0) throw new Error("Unknown event cursor");
      index = cursorIndex + 1;
    }
    const page = this.page(index, limit);
    return page.events.length === 0 ? { ...page, nextCursor: cursor } : page;
  }

  async readFrom(startPosition: string, limit: number): Promise<NearEventPage> {
    const index = this.entries.findIndex(
      (event) => event.cursor === startPosition,
    );
    if (index < 0) throw new Error("Unknown historical start position");
    return this.page(index, limit);
  }

  async readRange(
    startBlockHeight: string,
    endBlockHeight: string,
    cursor: string | null,
    limit: number,
  ): Promise<NearEventPage> {
    const start = BigInt(startBlockHeight);
    const end = BigInt(endBlockHeight);
    if (end < start) throw new Error("Recovery range end precedes start");
    let index = cursor === null ? 0 : this.entries.findIndex((event) => event.cursor === cursor) + 1;
    if (cursor !== null && index === 0) throw new Error("Unknown recovery cursor");
    while (index < this.entries.length && BigInt(this.entries[index]!.identity.blockHeight) < start) index += 1;
    const selected: RawNearEvent[] = [];
    while (index < this.entries.length && selected.length < limit) {
      const event = this.entries[index]!;
      if (BigInt(event.identity.blockHeight) > end) break;
      selected.push(event);
      index += 1;
    }
    const nextCursor = selected.at(-1)?.cursor ?? cursor;
    return {
      events: selected,
      blocks: [],
      nextCursor,
      hasMore: index < this.entries.length && BigInt(this.entries[index]!.identity.blockHeight) <= end,
    };
  }

  private page(index: number, limit: number): NearEventPage {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error("Page limit must be positive");
    const events = this.entries.slice(index, index + limit);
    return {
      events,
      blocks: [],
      nextCursor: events.at(-1)?.cursor ?? null,
      hasMore: index + events.length < this.entries.length,
    };
  }
}
