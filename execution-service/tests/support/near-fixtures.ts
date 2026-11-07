import type { NearPayoutView } from "../../src/near/clients.ts";
import type { RawNearEvent } from "../../src/discovery/events.ts";

export function makePayout(overrides: Partial<NearPayoutView> = {}): NearPayoutView {
  return {
    id: "42",
    campaignId: "7",
    recipientNearAccountId: null,
    inputAmount: { tokenId: { Near: "token.testnet" }, atomicAmount: "100", decimals: 6 },
    destination: { chainId: "evm:11155111", recipientAddress: "0xabc123" },
    expectedOutputAmount: { tokenId: { External: "erc20:0x123" }, atomicAmount: "90", decimals: 18 },
    status: "Reserved",
    createdAtNs: "1700000000000000000",
    executionReference: null,
    settlementEvidenceReference: null,
    lifecycleReason: null,
    failureEvidence: null,
    settlementEvidence: null,
    resolutionEvidence: [],
    ...overrides,
  };
}

export function makeRawEvent(
  name: string,
  cursor: string,
  eventIndex = 0,
  overrides: { readonly payoutId?: string; readonly campaignId?: string; readonly fields?: Readonly<Record<string, unknown>> } = {},
): RawNearEvent {
  const payoutId = overrides.payoutId ?? "42";
  const campaignId = overrides.campaignId ?? "7";
  const defaultFields: Record<string, unknown> = {
    payout_id: Number(payoutId),
    campaign_id: Number(campaignId),
    actor_id: "operator.testnet",
    input_token_id: "token.testnet",
    input_amount: "100",
    expected_output_token_id: "erc20:0x123",
    expected_output_amount: "90",
    status: "Reserved",
  };
  const fields = { ...defaultFields, ...overrides.fields };
  return {
    identity: {
      networkId: "testnet",
      contractId: "disburse.testnet",
      blockHeight: "100",
      blockHash: "block-hash-100",
      transactionHash: "transaction-hash-100",
      receiptId: "receipt-id-1",
      eventIndex,
    },
    log: `EVENT_JSON:${JSON.stringify({ standard: "disburse", version: "1.0.0", event: name, data: [fields] })}`,
    cursor,
  };
}
