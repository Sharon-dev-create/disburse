export interface RecipientValidationResult {
  readonly valid: boolean;
  readonly networkId: string;
  readonly normalizedAddress: string | null;
  readonly reason: string | null;
}

export interface RecipientValidationOptions {
  readonly strictChecksum?: boolean;
}

const EVM_NETWORK_PREFIXES = new Set([
  "eth:",
  "eip155:",
  "base:",
  "arbitrum:",
  "optimism:",
  "polygon:",
]);

export function validateRecipient(
  networkId: string,
  address: string,
  options: RecipientValidationOptions = {},
): RecipientValidationResult {
  const strictChecksum = options.strictChecksum ?? false;
  const trimmedNetwork = networkId.trim();
  const trimmedAddress = address.trim();

  if (!trimmedNetwork) {
    return invalid(trimmedNetwork, "Network identifier is required");
  }
  if (!trimmedAddress) {
    return invalid(trimmedNetwork, "Recipient address is required");
  }

  if (trimmedNetwork === "near" || trimmedNetwork.startsWith("near:")) {
    return validateNearRecipient(trimmedNetwork, trimmedAddress);
  }

  if (
    isEvmNetworkId(trimmedNetwork) ||
    trimmedNetwork.startsWith("0x")
  ) {
    return validateEvmRecipient(trimmedNetwork, trimmedAddress, strictChecksum);
  }

  return invalid(
    trimmedNetwork,
    "Unsupported destination network identifier",
  );
}

export function validateNearRecipient(
  networkId: string,
  address: string,
): RecipientValidationResult {
  const trimmed = address.trim();
  if (trimmed.length === 0 || trimmed.length > 256) {
    return invalid(networkId, "NEAR account IDs must be 1-256 characters");
  }
  if (trimmed.includes(" ")) {
    return invalid(networkId, "NEAR account IDs cannot contain whitespace");
  }
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    return invalid(networkId, "NEAR account IDs must not start or end with a dot");
  }
  return {
    valid: true,
    networkId,
    normalizedAddress: trimmed,
    reason: null,
  };
}

export function validateEvmRecipient(
  networkId: string,
  address: string,
  strictChecksum = false,
): RecipientValidationResult {
  const trimmed = address.trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return invalid(networkId, "EVM recipient must be a 0x-prefixed 40-byte hex address");
  }
  if (trimmed.toLowerCase() === "0x" + "0".repeat(40)) {
    return invalid(networkId, "Zero address is not allowed as a payout recipient");
  }
  if (!isSupportedNetworkId(networkId)) {
    return invalid(networkId, "Unsupported EVM destination network");
  }
  if (!isValidEvmSyntax(trimmed, strictChecksum)) {
    return invalid(networkId, "EVM address checksum or hexadecimal encoding is invalid");
  }

  return {
    valid: true,
    networkId,
    normalizedAddress: trimmed.toLowerCase(),
    reason: null,
  };
}

function isValidEvmSyntax(address: string, strictChecksum: boolean): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const lower = address.toLowerCase();
  const upper = address.toUpperCase();
  if (lower === address || upper === address) {
    return !strictChecksum || lower !== address || upper === address;
  }

  if (!strictChecksum) {
    return true;
  }

  const body = address.slice(2);
  const hasUpper = /[A-F]/.test(body);
  const hasLower = /[a-f]/.test(body);
  return hasUpper && hasLower;
}

function invalid(networkId: string, reason: string): RecipientValidationResult {
  return {
    valid: false,
    networkId,
    normalizedAddress: null,
    reason,
  };
}

function isEvmNetworkId(networkId: string): boolean {
  for (const prefix of EVM_NETWORK_PREFIXES) {
    if (networkId.startsWith(prefix)) return true;
  }
  return false;
}

function isSupportedNetworkId(networkId: string): boolean {
  return isEvmNetworkId(networkId) || networkId === "near" || networkId.startsWith("near:");
}

export function normalizeRecipientAddress(
  networkId: string,
  address: string,
): string | null {
  const result = validateRecipient(networkId, address);
  return result.valid ? result.normalizedAddress : null;
}
