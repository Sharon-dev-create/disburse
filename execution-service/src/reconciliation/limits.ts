import { NearRpcError } from "../near/errors.ts";
import { object, text } from "./evidence.ts";
export interface GraphLimits {
  readonly nodes: number;
  readonly depth: number;
  readonly calls: number;
  readonly durationMs: number;
  readonly concurrency: number;
  readonly bytes: number;
}
export const DEFAULT_GRAPH_LIMITS: GraphLimits = Object.freeze({
  nodes: 256,
  depth: 32,
  calls: 800,
  durationMs: 15000,
  concurrency: 4,
  bytes: 2 * 1024 * 1024,
});
export function graphLimits(input: Partial<GraphLimits> = {}): GraphLimits {
  const result = { ...DEFAULT_GRAPH_LIMITS, ...input };
  const caps: GraphLimits = {
    nodes: 256,
    depth: 64,
    calls: 800,
    durationMs: 60000,
    concurrency: 8,
    bytes: 3 * 1024 * 1024,
  };
  for (const key of Object.keys(caps) as (keyof GraphLimits)[])
    if (
      !Number.isSafeInteger(result[key]) ||
      result[key] < 1 ||
      result[key] > caps[key]
    )
      throw new NearRpcError("resource-limit", `Invalid graph budget: ${key}`);
  return result;
}
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  let stopped = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!stopped) {
        const index = next++;
        if (index >= items.length) return;
        try {
          result[index] = await work(items[index]!);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    }),
  );
  return result;
}
export function assertReceiptGraph(
  transaction: Record<string, unknown>,
  limits: GraphLimits,
): void {
  const raw = transaction.receipts_outcome;
  if (!Array.isArray(raw) || raw.length > limits.nodes)
    throw new NearRpcError("resource-limit", "Receipt node limit exceeded");
  const root = object(transaction.transaction_outcome);
  const nodes = new Map<string, Record<string, unknown>>();
  for (const value of raw) {
    const row = object(value),
      id = text(row.id);
    if (nodes.has(id))
      throw new NearRpcError("inconsistent", "Duplicate receipt reference");
    nodes.set(id, row);
  }
  const seen = new Set<string>();
  const queue = [{ row: root, id: text(root.id), depth: 0 }];
  while (queue.length) {
    const current = queue.pop()!;
    if (current.depth > limits.depth)
      throw new NearRpcError("resource-limit", "Receipt depth limit exceeded");
    if (seen.has(current.id))
      throw new NearRpcError(
        "inconsistent",
        "Cyclic or multiply referenced receipt",
      );
    seen.add(current.id);
    const ids = object(current.row.outcome).receipt_ids;
    if (!Array.isArray(ids) || ids.length > limits.nodes)
      throw new NearRpcError(
        "resource-limit",
        "Receipt work queue limit exceeded",
      );
    for (const child of ids) {
      const id = text(child),
        row = nodes.get(id);
      if (!row)
        throw new NearRpcError("inconsistent", "Incomplete receipt graph");
      queue.push({ row, id, depth: current.depth + 1 });
    }
    if (queue.length > limits.nodes)
      throw new NearRpcError(
        "resource-limit",
        "Receipt work queue limit exceeded",
      );
  }
  if (seen.size !== nodes.size + 1)
    throw new NearRpcError("inconsistent", "Disconnected receipt graph");
}
