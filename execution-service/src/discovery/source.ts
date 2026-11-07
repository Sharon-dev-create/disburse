import type { RawNearEvent } from "./events.ts";

export interface NearEventSource {
  readAfter(cursor: string | null, limit: number): Promise<NearEventPage>;
  readFrom(startPosition: string, limit: number): Promise<NearEventPage>;
}

export interface NearEventPage {
  readonly events: readonly RawNearEvent[];
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
    const index =
      cursor === null
        ? 0
        : this.entries.findIndex((event) => event.cursor === cursor) + 1;
    if (index < 0) throw new Error("Unknown event cursor");
    return this.page(index, limit);
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
