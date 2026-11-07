import type { RawNearEvent } from "./events.ts";

/** Implementations must return finalized events in deterministic chain order and replay all gaps. */
export interface NearEventSource {
  readAfter(cursor: string | null, limit: number): Promise<NearEventPage>;
  readFrom(startPosition: string, limit: number): Promise<NearEventPage>;
}

export interface NearEventPage {
  readonly events: readonly RawNearEvent[];
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

  private page(index: number, limit: number): NearEventPage {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error("Page limit must be positive");
    const events = this.entries.slice(index, index + limit);
    return {
      events,
      nextCursor: events.at(-1)?.cursor ?? null,
      hasMore: index + events.length < this.entries.length,
    };
  }
}
