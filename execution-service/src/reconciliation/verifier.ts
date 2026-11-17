import { NearRpcError } from "../near/errors.ts";
import { withAbort } from "../near/http.ts";
import {
  assertReceiptGraph,
  graphLimits,
  mapBounded,
  type GraphLimits,
} from "./limits.ts";
import {
  bindingDigest,
  canonical,
  digest,
  object,
  text,
  uint,
  trust,
  validateIdentity,
  type AttemptIdentity,
  type JsonRecord,
  type TransactionLocator,
  type Verification,
} from "./evidence.ts";
import { viewAt, type EvidenceRpc } from "./rpc.ts";

export interface EvidencePolicy {
  readonly limits?: Partial<GraphLimits>;
  readonly contractCodeHashes: readonly string[];
  readonly atomicTokenCodeHashes: readonly string[];
}
export interface EvidenceBundle {
  readonly sourceId: string;
  readonly endpoint: string;
  readonly observedAt: string;
  readonly chainId: string;
  readonly locator: TransactionLocator;
  readonly head: unknown;
  readonly native: unknown;
  readonly attempt: unknown;
  readonly authorization: unknown;
  readonly payout: unknown;
  readonly accounting: unknown;
  readonly execution: unknown;
  readonly transaction: unknown;
  readonly receipts: readonly unknown[];
  readonly blocks: readonly {
    readonly header: unknown;
    readonly canonicalHeader: unknown;
  }[];
}
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error("Missing receipt graph");
  return v;
};
const same = (a: unknown, b: unknown) => {
  if (canonical(a) !== canonical(b))
    throw new Error("Evidence binding mismatch");
};
const callbackArgs = (i: AttemptIdentity) => ({
  payout_id: i.payoutId,
  authorization_id: i.authorizationId,
  attempt_id: i.attemptId,
});
function normalizeArgs(v: JsonRecord): JsonRecord {
  const r = { ...v };
  for (const k of ["payout_id", "attempt_id"]) if (k in r) r[k] = uint(r[k]);
  return r;
}
function call(receipt: JsonRecord, method: string): JsonRecord {
  const actions = list(object(object(receipt.receipt).Action).actions);
  if (actions.length !== 1) throw new Error("Unexpected receipt action batch");
  const f = object(object(actions[0]).FunctionCall);
  if (f.method_name !== method) throw new Error("Wrong method");
  return f;
}
function args(f: JsonRecord): JsonRecord {
  const encoded = text(f.args);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || bytes.length > 4096)
    throw new Error("Invalid action args");
  // IDs are preserved before JSON decoding, including unsigned u64 above JS safe range.
  return normalizeArgs(object(exactActionJson(bytes.toString("utf8"))));
}
import { exactJson as exactActionJson } from "./evidence.ts";
function succeeded(status: unknown): boolean {
  const s = object(status);
  return (
    Object.keys(s).length === 1 &&
    ("SuccessValue" in s || "SuccessReceiptId" in s)
  );
}
function code(outcome: JsonRecord, allowed: readonly string[]): void {
  const cs = list(object(outcome.metadata).contracts);
  if (cs.length !== 1 || !allowed.includes(text(object(cs[0]).local)))
    throw new Error("Unreviewed executed code");
}
/** Pure validation. Output is a trusted-RPC observation, never contract settlement authority. */
export function verifyBundle(
  i: AttemptIdentity,
  b: EvidenceBundle,
  policy: EvidencePolicy,
): Verification {
  try {
    validateIdentity(i);
    const limits = graphLimits(policy.limits);
    same(b.chainId, i.chainId);
    const n = object(b.native),
      binding = object(n.binding),
      at = object(b.attempt),
      auth = object(b.authorization),
      p = object(b.payout);
    same(bindingDigest(binding), i.bindingHash);
    same(n.binding_hash, i.bindingHash);
    for (const [k, v] of Object.entries({
      contract_id: i.contractId,
      token_id: i.tokenId,
      recipient_id: i.recipientId,
      amount: i.amount,
      network: "near:testnet",
      domain: "disburse/native-nep141/v1",
    }))
      same(binding[k], v);
    same(uint(binding.version), "1");
    same(uint(binding.decimals), "6");
    same(uint(binding.campaign_id), i.campaignId);
    same(uint(binding.payout_id), i.payoutId);
    same(uint(n.current_attempt_id), i.attemptId);
    same(n.current_authorization_id, i.authorizationId);
    for (const v of [at, auth]) {
      same(v.binding_hash, i.bindingHash);
      same(uint(v.attempt_id), i.attemptId);
      same(v.authorization_id, i.authorizationId);
      same(uint(v.version), "1");
    }
    same(auth.binding, binding);
    same(auth.status, "Consumed");
    same(at.executor_id, i.executorId);
    same(uint(at.campaign_id), i.campaignId);
    same(uint(at.payout_id), i.payoutId);
    same(at.status, n.status);
    if (
      auth.approver_id === i.executorId ||
      auth.approver_id === binding.reservation_actor
    )
      throw new Error("Non-independent approval");
    same(uint(p.id), i.payoutId);
    same(uint(p.campaign_id), i.campaignId);
    same(p.recipient_near_account_id, i.recipientId);
    same(object(p.destination).chain_id, "near:testnet");
    same(object(p.destination).recipient_address, i.recipientId);
    for (const a of [
      object(p.input_amount),
      object(p.expected_output_amount),
    ]) {
      same(a.token_id, { Near: i.tokenId });
      same(uint(a.atomic_amount, 128), i.amount);
      same(uint(a.decimals), "6");
    }
    const execution = object(b.execution);
    for (const [k, v] of Object.entries({
      authorization_id: i.authorizationId,
      binding_hash: i.bindingHash,
    }))
      same(execution[k], v);
    same(uint(execution.campaign_id), i.campaignId);
    same(uint(execution.payout_id), i.payoutId);
    same(uint(execution.attempt_id), i.attemptId);
    const expectedKind: Record<string, string> = {
      Succeeded: "TransferSucceeded",
      TransferPending: "TransferScheduled",
      AttemptFailed: "TransferReceiptFailed",
      ManualReview: "UnexpectedTransferResult",
    };
    same(execution.kind, expectedKind[String(n.status)] ?? "UNSUPPORTED");
    const memo = `disburse:native:v1:${i.payoutId}:${i.attemptId}`;
    same(execution.memo, memo);
    same(p.execution_reference, memo);
    const ac = object(b.accounting);
    same(uint(ac.campaign_id), i.campaignId);
    const [budget, funded, reserved, spent, available] = [
      ac.budget,
      ac.funded,
      ac.reserved,
      ac.spent,
      ac.available,
    ].map((x) => BigInt(uint(x, 128)));
    if (
      funded! > budget! ||
      reserved! + spent! > funded! ||
      available! + reserved! + spent! !== funded
    )
      throw new Error("Accounting invariant violation");
    const tx = object(b.transaction);
    assertReceiptGraph(tx, limits);
    same(tx.final_execution_status, "FINAL");
    const transaction = object(tx.transaction);
    same(transaction.hash, b.locator.transactionHash);
    same(transaction.signer_id, b.locator.senderId);
    same(transaction.signer_id, i.executorId);
    same(transaction.receiver_id, i.contractId);
    const entry = call(
      { receipt: { Action: { actions: transaction.actions } } },
      "begin_native_preflight",
    );
    same(args(entry), callbackArgs(i));
    same(entry.deposit, "0");
    const root = object(tx.transaction_outcome);
    same(root.id, b.locator.transactionHash);
    const rows = list(tx.receipts_outcome);
    if (
      rows.length < 4 ||
      rows.length > limits.nodes ||
      b.receipts.length !== rows.length
    )
      throw new Error("Incomplete/oversized graph");
    const outcomes = new Map<string, JsonRecord>();
    const receipts = new Map<string, JsonRecord>();
    for (const row of rows) {
      const r = object(row);
      const id = text(r.id);
      if (outcomes.has(id)) throw new Error("Duplicate receipt outcome");
      outcomes.set(id, r);
    }
    for (const raw of b.receipts) {
      const r = object(raw),
        id = text(r.receipt_id);
      if (receipts.has(id) || !outcomes.has(id))
        throw new Error("Foreign/duplicate receipt");
      receipts.set(id, r);
    }
    const head = object(b.head);
    const finalHeight = BigInt(uint(head.height));
    const blockHashes = new Set<string>();
    for (const pair of b.blocks) {
      const h = object(pair.header),
        c = object(pair.canonicalHeader);
      same(h.hash, c.hash);
      same(uint(h.height), uint(c.height));
      if (BigInt(uint(h.height)) > finalHeight)
        throw new Error("Unfinalized outcome");
      blockHashes.add(text(h.hash));
    }
    for (const r of [root, ...outcomes.values()])
      if (!blockHashes.has(text(r.block_hash)))
        throw new Error("Unverified canonical outcome block");
    const parents = new Map<string, string>();
    const seen = new Set<string>();
    const walk = (row: JsonRecord, id: string) => {
      if (seen.has(id)) throw new Error("Cycle/duplicate parent");
      seen.add(id);
      const o = object(row.outcome);
      const st = object(o.status);
      if (
        "SuccessReceiptId" in st &&
        !list(o.receipt_ids).includes(st.SuccessReceiptId)
      )
        throw new Error("Unlinked returned promise");
      for (const child of list(o.receipt_ids)) {
        const childId = text(child);
        const r = outcomes.get(childId);
        if (!r) throw new Error("Missing receipt outcome");
        parents.set(childId, id);
        walk(r, childId);
      }
    };
    walk(root, text(root.id));
    if (seen.size !== outcomes.size + 1)
      throw new Error("Disconnected receipt graph");
    for (const [id, r] of receipts) {
      same(object(outcomes.get(id)!.outcome).executor_id, r.receiver_id);
    }
    const select = (method: string, receiver: string) => {
      const found = [...receipts.entries()].filter(
        ([, r]) =>
          r.receiver_id === receiver &&
          list(object(object(r.receipt).Action).actions).some(
            (a) => object(object(a).FunctionCall ?? {}).method_name === method,
          ),
      );
      if (found.length !== 1) throw new Error(`Expected one ${method} receipt`);
      return found[0]!;
    };
    const [entryId, er] = select("begin_native_preflight", i.contractId);
    same(parents.get(entryId), root.id);
    same(er.predecessor_id, i.executorId);
    same(args(call(er, "begin_native_preflight")), callbackArgs(i));
    same(call(er, "begin_native_preflight").deposit, "0");
    const eo = object(outcomes.get(entryId)!.outcome);
    if (!succeeded(eo.status)) throw new Error("Entry did not commit");
    code(eo, policy.contractCodeHashes);
    const [storageId, sr] = select("storage_balance_of", i.tokenId);
    same(sr.predecessor_id, i.contractId);
    same(parents.get(storageId), entryId);
    same(args(call(sr, "storage_balance_of")), { account_id: i.recipientId });
    same(call(sr, "storage_balance_of").deposit, "0");
    const [preId, pr] = select("on_native_storage_checked", i.contractId);
    same(parents.get(preId), entryId);
    same(pr.predecessor_id, i.contractId);
    same(args(call(pr, "on_native_storage_checked")), callbackArgs(i));
    const po = object(outcomes.get(preId)!.outcome);
    if (!succeeded(po.status)) throw new Error("Dispatch did not commit");
    code(po, policy.contractCodeHashes);
    const [ftId, fr] = select("ft_transfer", i.tokenId);
    same(parents.get(ftId), preId);
    same(fr.predecessor_id, i.contractId);
    const f = call(fr, "ft_transfer");
    same(f.deposit, "1");
    same(args(f), { receiver_id: i.recipientId, amount: i.amount, memo });
    const [cbId, cr] = select("on_native_transfer_result", i.contractId);
    same(parents.get(cbId), preId);
    same(cr.predecessor_id, i.contractId);
    same(args(call(cr, "on_native_transfer_result")), callbackArgs(i));
    const link = (from: JsonRecord, to: JsonRecord) => {
      const a = object(object(from.receipt).Action),
        z = object(object(to.receipt).Action);
      const inputs = list(z.input_data_ids);
      const outputs = list(a.output_data_receivers)
        .map(object)
        .filter((r) => r.receiver_id === i.contractId)
        .map((r) => r.data_id);
      if (
        inputs.length !== 1 ||
        outputs.filter((x) => x === inputs[0]).length !== 1
      )
        throw new Error("Wrong callback dependency");
    };
    link(sr, pr);
    link(fr, cr);
    const fo = object(outcomes.get(ftId)!.outcome),
      co = object(outcomes.get(cbId)!.outcome);
    code(fo, policy.atomicTokenCodeHashes);
    const status = object(fo.status);
    let classification: Verification["classification"];
    if ("Failure" in status && Object.keys(status).length === 1) {
      if (
        n.status !== "AttemptFailed" ||
        p.status !== "Failed" ||
        reserved! < BigInt(i.amount)
      )
        throw new Error("Failed transfer/state mismatch");
      classification = "ObservedTransferFailed";
    } else if (
      Object.keys(status).length === 1 &&
      typeof status.SuccessValue === "string" &&
      ["", "bnVsbA=="].includes(status.SuccessValue)
    ) {
      // A committed standard-token event supplements exact action/outcome validation; event text alone is insufficient.
      const matches = list(fo.logs).filter((log) => {
        try {
          const e = object(JSON.parse(String(log).replace(/^EVENT_JSON:/, "")));
          return (
            e.standard === "nep141" &&
            e.version === "1.0.0" &&
            e.event === "ft_transfer" &&
            canonical(e.data) ===
              canonical([
                {
                  old_owner_id: i.contractId,
                  new_owner_id: i.recipientId,
                  amount: i.amount,
                  memo,
                },
              ])
          );
        } catch {
          return false;
        }
      });
      if (matches.length !== 1)
        throw new Error("Missing committed matching token event");
      if (
        n.status === "Succeeded" &&
        p.status === "Succeeded" &&
        succeeded(co.status)
      ) {
        code(co, policy.contractCodeHashes);
        if (spent! < BigInt(i.amount))
          throw new Error("Missing settled accounting");
        classification = "ObservedSucceededSettled";
      } else if (
        n.status === "TransferPending" &&
        p.status === "Executing" &&
        "Failure" in object(co.status) &&
        reserved! >= BigInt(i.amount)
      )
        classification = "ObservedSucceededSettlementPending";
      else throw new Error("Transfer/callback/state mismatch");
    } else throw new Error("Unknown token result or promise indirection");
    const semanticDigest = digest({
      identity: i,
      transactionHash: b.locator.transactionHash,
      transferReceiptId: ftId,
      transferBlock: outcomes.get(ftId)!.block_hash,
      transferStatus: status,
      graph: [...outcomes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, r]) => ({
          id,
          block_hash: r.block_hash,
          outcome: {
            executor_id: object(r.outcome).executor_id,
            receipt_ids: object(r.outcome).receipt_ids,
            status: object(r.outcome).status,
          },
          receipt: receipts.get(id),
        })),
    });
    return {
      classification,
      reason:
        "Finalized canonical graph and immutable bindings match reviewed atomic token policy",
      transferReceiptId: ftId,
      callbackReceiptId: cbId,
      semanticDigest,
      trust,
    };
  } catch (error) {
    return {
      classification: "ManualReview",
      reason: error instanceof Error ? error.message : "Invalid evidence",
      transferReceiptId: null,
      callbackReceiptId: null,
      semanticDigest: null,
      trust,
    };
  }
}
async function collectBoundedBundle(
  rpc: EvidenceRpc,
  i: AttemptIdentity,
  locator: TransactionLocator,
  limits: GraphLimits,
): Promise<EvidenceBundle> {
  validateIdentity(i);
  if (locator.senderId !== i.executorId)
    throw new Error("Wrong transaction signer");
  const status = object(await rpc.read("status", []));
  if (status.chain_id !== i.chainId)
    throw new NearRpcError("network-mismatch", "Wrong RPC network");
  const tx = object(
    await rpc.read("tx_status", {
      tx_hash: text(locator.transactionHash),
      sender_account_id: locator.senderId,
      wait_until: "FINAL",
    }),
  );
  if (tx.final_execution_status !== "FINAL")
    throw new NearRpcError("finality-uncertain", "Transaction not final");
  assertReceiptGraph(tx, limits);
  const head = object(
    object(await rpc.read("block", { finality: "final" })).header,
  );
  const hash = text(head.hash);
  const [native, attempt, authorization, payout, accounting, execution] =
    await mapBounded(
      [
        () =>
          viewAt(
            rpc,
            i.contractId,
            "get_native_payout",
            { payout_id: i.payoutId },
            hash,
          ),
        () =>
          viewAt(
            rpc,
            i.contractId,
            "get_native_attempt",
            { payout_id: i.payoutId, attempt_id: i.attemptId },
            hash,
          ),
        () =>
          viewAt(
            rpc,
            i.contractId,
            "get_native_authorization",
            { authorization_id: i.authorizationId },
            hash,
          ),
        () =>
          viewAt(
            rpc,
            i.contractId,
            "get_payout",
            { payout_id: i.payoutId },
            hash,
          ),
        () =>
          viewAt(
            rpc,
            i.contractId,
            "get_campaign_payout_accounting",
            { campaign_id: i.campaignId },
            hash,
          ),
        () =>
          viewAt(
            rpc,
            i.contractId,
            "get_native_execution_outcome",
            { payout_id: i.payoutId, attempt_id: i.attemptId },
            hash,
          ),
      ],
      limits.concurrency,
      (work) => work(),
    );
  const rows = list(tx.receipts_outcome);
  if (rows.length > limits.nodes) throw new Error("Oversized receipt graph");
  const receipts = await mapBounded(rows, limits.concurrency, (r) =>
    rpc.read("EXPERIMENTAL_receipt", { receipt_id: text(object(r).id) }),
  );
  const hashes = [
    ...new Set(
      [object(tx.transaction_outcome), ...rows.map(object)].map((r) =>
        text(r.block_hash),
      ),
    ),
  ];
  const blocks = await mapBounded(
    hashes,
    limits.concurrency,
    async (blockHash) => {
      const header = object(
        object(await rpc.read("block", { block_id: blockHash })).header,
      );
      const canonicalHeader = object(
        object(
          await rpc.read("block", { block_id: Number(uint(header.height)) }),
        ).header,
      );
      if (!Number.isSafeInteger(Number(header.height)))
        throw new Error("Unsafe block height");
      return { header, canonicalHeader };
    },
  );
  return {
    sourceId: rpc.sourceId,
    endpoint: rpc.endpoint,
    observedAt: new Date().toISOString(),
    chainId: text(status.chain_id),
    locator,
    head,
    native,
    attempt,
    authorization,
    payout,
    accounting,
    execution,
    transaction: tx,
    receipts,
    blocks,
  };
}

/** One bounded observation traversal; unknown/incomplete evidence cannot authorize recovery. */
export async function collectBundle(
  rpc: EvidenceRpc,
  identity: AttemptIdentity,
  locator: TransactionLocator,
  options: Partial<GraphLimits> = {},
  external?: AbortSignal,
): Promise<EvidenceBundle> {
  const limits = graphLimits(options),
    controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new NearRpcError(
          "resource-limit",
          "Receipt traversal deadline exceeded",
        ),
      ),
    limits.durationMs,
  );
  const cancel = () =>
    controller.abort(
      new NearRpcError("cancelled", "Receipt traversal cancelled"),
    );
  external?.addEventListener("abort", cancel, { once: true });
  if (external?.aborted) cancel();
  let calls = 0,
    bytes = 0;
  const bounded: EvidenceRpc = {
    sourceId: rpc.sourceId,
    endpoint: rpc.endpoint,
    read: async (method, params) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (++calls > limits.calls)
        throw new NearRpcError(
          "resource-limit",
          "Receipt RPC call limit exceeded",
        );
      const result = await withAbort(
        rpc.read(method, params, controller.signal),
        controller.signal,
      );
      bytes += Buffer.byteLength(JSON.stringify(result));
      if (bytes > limits.bytes)
        throw new NearRpcError(
          "resource-limit",
          "Receipt observation byte limit exceeded",
        );
      return result;
    },
  };
  try {
    return await collectBoundedBundle(bounded, identity, locator, limits);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", cancel);
    controller.abort();
  }
}
