import type { NearContractReader } from "./rpc.ts";

// Reviewed deployment identities; deliberately not environment-overridable.
export const ACTIVE_TESTNET = Object.freeze({
  networkId: "testnet",
  contractId: "disburse-test-contract.testnet",
  codeHash: "CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf",
  ownerId: "disburse-topg.testnet",
  tokenId: "usdc.tidepool-sandbox.testnet",
  operatorId: "disburse-op-b966e36d.testnet",
});

export function assertActiveTestnetIdentity(
  network: string,
  contract: string,
): void {
  if (
    network !== ACTIVE_TESTNET.networkId ||
    contract !== ACTIVE_TESTNET.contractId
  ) {
    throw new Error(
      "Active Testnet read-only mode requires the approved isolated Testnet contract.",
    );
  }
}

export async function readContractStatus(reader: NearContractReader) {
  const [codeHash, ownerId, paused, campaignCount] = await Promise.all([
    reader.getCodeHash(),
    reader.getOwner(),
    reader.isPaused(),
    reader.getCampaignCount(),
  ]);
  return {
    networkId: reader.config.networkId,
    contractId: reader.config.contractId,
    codeHash,
    ownerId,
    paused,
    campaignCount,
    // No payout count ABI exists. With this code, payouts require a campaign and
    // campaigns cannot be deleted; otherwise a total cannot be established here.
    payoutCount:
      campaignCount === "0" && codeHash === ACTIVE_TESTNET.codeHash
        ? "0"
        : null,
    payoutCountSource: "inferred_from_zero_campaigns",
    readOnly: true,
  };
}

export async function verifyActiveTestnet(
  reader: NearContractReader,
  verifyPermissions = true,
) {
  assertActiveTestnetIdentity(
    reader.config.networkId,
    reader.config.contractId,
  );
  if (verifyPermissions) await reader.verifyNetwork();
  const status = await readContractStatus(reader);
  if (
    status.codeHash !== ACTIVE_TESTNET.codeHash ||
    status.ownerId !== ACTIVE_TESTNET.ownerId
  ) {
    throw new Error(
      "Active Testnet contract code hash or owner verification failed.",
    );
  }
  if (!verifyPermissions) return status;
  const [accepted, operator] = await Promise.all([
    reader.isAcceptedToken(ACTIVE_TESTNET.tokenId),
    reader.hasRole(ACTIVE_TESTNET.operatorId, "Operator"),
  ]);
  if (!accepted || !operator)
    throw new Error(
      "Active Testnet contract token or Operator verification failed.",
    );
  return {
    ...status,
    acceptedToken: ACTIVE_TESTNET.tokenId,
    operatorId: ACTIVE_TESTNET.operatorId,
  };
}
