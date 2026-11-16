import { object, text, uint, type AttemptIdentity } from "./evidence.ts";
import { viewAt, type EvidenceRpc } from "./rpc.ts";
export interface NativeDiscoveryPage {
  readonly blockHash: string;
  readonly nextPayoutId: string | null;
  readonly scanned: number;
  readonly attempts: readonly {
    readonly identity: AttemptIdentity;
    readonly status: string;
    readonly locatorRequired: true;
  }[];
}
/** Bounded finalized scan. Events/DB state may supply locators but cannot assert outcomes. */
export async function discoverNativeAttempts(
  rpc: EvidenceRpc,
  chainId: string,
  contractId: string,
  cursor = "0",
  limit = 25,
): Promise<NativeDiscoveryPage> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid discovery bound");
  if (object(await rpc.read("status", [])).chain_id !== chainId)
    throw new Error("Wrong discovery network");
  const head = object(
    object(await rpc.read("block", { finality: "final" })).header,
  );
  const blockHash = text(head.hash);
  // The actual ABI has no global payout-count/list view. Scan an explicit bounded ID range,
  // driven by indexed/submitted IDs; null rows never imply the end of history or non-delivery.
  const start = BigInt(uint(cursor));
  const boundary = 1n << 64n;
  const end =
    start + BigInt(limit) > boundary ? boundary : start + BigInt(limit);
  const attempts: NativeDiscoveryPage["attempts"][number][] = [];
  for (let id = start; id < end; id++) {
    const raw = await viewAt(
      rpc,
      contractId,
      "get_native_payout",
      { payout_id: String(id) },
      blockHash,
    );
    if (raw === null) continue;
    const n = object(raw);
    if (
      ![
        "PreflightPending",
        "TransferPending",
        "ManualReview",
        "AttemptFailed",
      ].includes(String(n.status))
    )
      continue;
    const b = object(n.binding);
    const attemptId = uint(n.current_attempt_id);
    const a = object(
      await viewAt(
        rpc,
        contractId,
        "get_native_attempt",
        { payout_id: String(id), attempt_id: attemptId },
        blockHash,
      ),
    );
    const identity: AttemptIdentity = {
      chainId,
      contractId,
      campaignId: uint(b.campaign_id),
      payoutId: uint(b.payout_id),
      attemptId,
      authorizationId: text(n.current_authorization_id),
      bindingHash: text(n.binding_hash),
      tokenId: text(b.token_id),
      recipientId: text(b.recipient_id),
      amount: uint(b.amount, 128),
      executorId: text(a.executor_id),
    };
    if (identity.payoutId !== String(id) || b.contract_id !== contractId)
      throw new Error("Discovery identity mismatch");
    attempts.push({ identity, status: text(n.status), locatorRequired: true });
  }
  return {
    blockHash,
    nextPayoutId: end === boundary ? null : String(end),
    scanned: Number(end - start),
    attempts,
  };
}
