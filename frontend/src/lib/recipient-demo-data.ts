import { getDemoCampaign } from "./campaign-demo-data";

export type RecipientNetwork = "NEAR" | "Ethereum" | "Polygon" | "Base";
export type RecipientStatus = "Active" | "Invited" | "Inactive";
export type PayoutReadiness = "Ready" | "Needs attention" | "Incomplete";

export type Recipient = {
  id: string;
  fullName: string;
  email: string;
  walletAddress: string;
  destinationNetwork: RecipientNetwork;
  preferredToken: string;
  associatedCampaignIds: readonly string[];
  status: RecipientStatus;
  payoutReadiness: PayoutReadiness;
  createdAt: string;
  configurationIssues: readonly string[];
};

export const DESTINATION_NETWORKS: readonly RecipientNetwork[] = [
  "NEAR",
  "Ethereum",
  "Polygon",
  "Base",
];

export const PAYOUT_TOKENS_BY_NETWORK: Record<RecipientNetwork, readonly string[]> = {
  NEAR: ["USDC"],
  Ethereum: ["USDC"],
  Polygon: ["USDC"],
  Base: ["USDC"],
};

export const demoRecipients: readonly Recipient[] = [
  {
    id: "REC-101",
    fullName: "Avery Morgan",
    email: "avery.morgan@example.com",
    walletAddress: "avery-morgan.near",
    destinationNetwork: "NEAR",
    preferredToken: "USDC",
    associatedCampaignIds: ["CAM-042"],
    status: "Active",
    payoutReadiness: "Ready",
    createdAt: "2026-10-24",
    configurationIssues: [],
  },
  {
    id: "REC-102",
    fullName: "Jordan Lee",
    email: "jordan.lee@example.com",
    walletAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    destinationNetwork: "Ethereum",
    preferredToken: "USDC",
    associatedCampaignIds: ["CAM-041", "CAM-037"],
    status: "Active",
    payoutReadiness: "Ready",
    createdAt: "2026-10-18",
    configurationIssues: [],
  },
  {
    id: "REC-103",
    fullName: "Sam Kim",
    email: "sam.kim@example.com",
    walletAddress: "0x8ba1f109551bd432",
    destinationNetwork: "Polygon",
    preferredToken: "USDC",
    associatedCampaignIds: ["CAM-042"],
    status: "Active",
    payoutReadiness: "Needs attention",
    createdAt: "2026-10-15",
    configurationIssues: ["The wallet address does not match the expected format for Polygon."],
  },
  {
    id: "REC-104",
    fullName: "Casey Patel",
    email: "casey.patel@example.com",
    walletAddress: "",
    destinationNetwork: "Base",
    preferredToken: "USDC",
    associatedCampaignIds: ["CAM-038"],
    status: "Invited",
    payoutReadiness: "Incomplete",
    createdAt: "2026-11-02",
    configurationIssues: ["A destination wallet/account address has not been provided."],
  },
  {
    id: "REC-105",
    fullName: "Taylor Reed",
    email: "taylor.reed@example.com",
    walletAddress: "taylor-reed.near",
    destinationNetwork: "NEAR",
    preferredToken: "USDC",
    associatedCampaignIds: ["CAM-039"],
    status: "Inactive",
    payoutReadiness: "Needs attention",
    createdAt: "2026-09-20",
    configurationIssues: ["This recipient is inactive and requires review before future use."],
  },
  {
    id: "REC-106",
    fullName: "Morgan Chen",
    email: "morgan.chen@example.com",
    walletAddress: "0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db",
    destinationNetwork: "Base",
    preferredToken: "USDC",
    associatedCampaignIds: ["CAM-042", "CAM-041"],
    status: "Active",
    payoutReadiness: "Ready",
    createdAt: "2026-11-05",
    configurationIssues: [],
  },
];

const EVM_NETWORKS: readonly RecipientNetwork[] = ["Ethereum", "Polygon", "Base"];

export function isRecipientNetwork(value: string): value is RecipientNetwork {
  return DESTINATION_NETWORKS.includes(value as RecipientNetwork);
}

export function validateWalletAddress(network: RecipientNetwork, address: string): string | undefined {
  const value = address.trim();

  if (!value) return "Enter a destination wallet/account address.";

  if (network === "NEAR") {
    const isImplicitAccount = /^[a-f0-9]{64}$/.test(value);
    const isNamedAccount =
      value.length >= 2 &&
      value.length <= 64 &&
      /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value);

    return isImplicitAccount || isNamedAccount
      ? undefined
      : "Enter a valid NEAR account ID (2–64 lowercase letters, digits, dots, hyphens, or underscores) or 64-character implicit account.";
  }

  if (EVM_NETWORKS.includes(network)) {
    return /^0x[a-fA-F0-9]{40}$/.test(value)
      ? undefined
      : `Enter a valid ${network} address in 0x-prefixed 40-hex-character format.`;
  }

  return "Select a supported destination network.";
}

export function getRecipientById(recipientId: string): Recipient | undefined {
  return demoRecipients.find((recipient) => recipient.id === recipientId);
}

export function getCampaignsForRecipient(recipient: Recipient) {
  return recipient.associatedCampaignIds.flatMap((id) => {
    const campaign = getDemoCampaign(id);
    return campaign ? [campaign] : [];
  });
}

export function isRecipientPayoutReady(recipient: Recipient): boolean {
  return recipient.status === "Active" && recipient.payoutReadiness === "Ready";
}

export function needsRecipientAttention(recipient: Recipient): boolean {
  return !isRecipientPayoutReady(recipient);
}

export function findRecipientByEmail(email: string): Recipient | undefined {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return undefined;
  return demoRecipients.find((recipient) => recipient.email.toLowerCase() === normalizedEmail);
}

export function findRecipientByAddress(
  network: RecipientNetwork,
  address: string,
): Recipient | undefined {
  const normalizedAddress = address.trim().toLowerCase();
  if (!normalizedAddress) return undefined;
  return demoRecipients.find(
    (recipient) =>
      recipient.destinationNetwork === network &&
      recipient.walletAddress.toLowerCase() === normalizedAddress,
  );
}

export function shortenWalletAddress(address: string): string {
  if (address.length <= 18) return address || "Not provided";
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

export function formatRecipientDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
