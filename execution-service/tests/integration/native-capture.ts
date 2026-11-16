/** Explicit local-only capture; not part of host startup or PostgreSQL integration glob. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ReadOnlyEvidenceRpc } from "../../src/reconciliation/rpc.ts";
import {
  collectBundle,
  verifyBundle,
} from "../../src/reconciliation/verifier.ts";
import {
  object,
  uint,
  text,
  type AttemptIdentity,
} from "../../src/reconciliation/evidence.ts";
const base = new URL("../../../docs/evidence/milestone-5/", import.meta.url);
const out = new URL("m5d/sandbox/", base);
await mkdir(out, { recursive: true });
function b58(bytes: Buffer): string {
  let n = BigInt("0x" + bytes.toString("hex")),
    s = "";
  const a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    s = a[Number(n % 58n)] + s;
    n /= 58n;
  }
  return s;
}
const code = async (path: string) =>
  b58(
    createHash("sha256")
      .update(await readFile(path))
      .digest(),
  );
const policy = {
  contractCodeHashes: await Promise.all(
    [
      "/home/topg/disburse/target/near/disburse_contract.wasm",
      "/tmp/disburse-m5c-artifacts/panic-callback/disburse_contract.wasm",
      "/tmp/disburse-m5c-artifacts/oog-callback/disburse_contract.wasm",
    ].map(code),
  ),
  atomicTokenCodeHashes: [
    await code("/tmp/disburse-m5c-artifacts/token/m5c_sandbox_token.wasm"),
  ],
};
const rpc = new ReadOnlyEvidenceRpc("local-a", "http://127.0.0.1:18545");
for (const name of [
  "successful-transfer",
  "panic-callback",
  "oog-callback",
  "definitive-token-failure",
  "insufficient-token-balance",
  "delivered-but-unexpected-result",
].filter(
  (name) => process.argv.length <= 2 || process.argv.slice(2).includes(name),
)) {
  const c = object(
    JSON.parse(
      await readFile(
        new URL(
          `${name}.json`,
          process.env.DISBURSE_NATIVE_FIXTURE_ROOT
            ? new URL(process.env.DISBURSE_NATIVE_FIXTURE_ROOT)
            : new URL("m5c-independent-rereview/fresh-sandbox/sandbox/", base),
        ),
        "utf8",
      ),
    ),
  );
  const n = object(object(c.after).native),
    b = object(n.binding);
  const i: AttemptIdentity = {
    chainId: "disburse-m5c-local",
    contractId: text(b.contract_id),
    campaignId: uint(b.campaign_id),
    payoutId: uint(b.payout_id),
    attemptId: uint(n.current_attempt_id),
    authorizationId: text(n.current_authorization_id),
    bindingHash: text(n.binding_hash),
    tokenId: text(b.token_id),
    recipientId: text(b.recipient_id),
    amount: uint(b.amount, 128),
    executorId: "executor.testnet",
  };
  const tx = object(object(object(c.execution).outcome).transaction);
  const locator = {
    transactionHash: text(tx.hash),
    senderId: text(tx.signer_id),
  };
  const bundle = await collectBundle(rpc, i, locator);
  const verification = verifyBundle(i, bundle, policy);
  await writeFile(
    new URL(name + ".json", out),
    JSON.stringify(
      { identity: i, locator, policy, bundle, verification },
      null,
      2,
    ) + "\n",
  );
  console.log(name, verification.classification, verification.reason);
}
