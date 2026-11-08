import { getSupportedNetwork } from "./networks.ts";

export interface RecipientValidationResult {
  readonly valid: boolean;
  readonly networkId: string;
  readonly normalizedAddress: string | null;
  readonly reason: string | null;
  readonly code: "valid" | "unsupported-network" | "invalid-address" | "checksum-unverified";
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const NEAR_IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;
const NEAR_NAMED_ACCOUNT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function validateRecipient(
  networkId: string,
  address: string,
): RecipientValidationResult {
  if (typeof networkId !== "string" || getSupportedNetwork(networkId) === null) {
    return invalid(networkId, "unsupported-network", "Unsupported or non-canonical network identifier");
  }
  if (typeof address !== "string" || address.length === 0 || address.length > 128 || address !== address.trim()) {
    return invalid(networkId, "invalid-address", "Recipient must be non-empty, trimmed, and at most 128 characters");
  }

  const network = getSupportedNetwork(networkId)!;
  if (network.kind === "near") return validateNearRecipient(networkId, address);
  return validateEvmRecipient(networkId, address);
}

export function validateNearRecipient(
  networkId: string,
  address: string,
): RecipientValidationResult {
  if (getSupportedNetwork(networkId)?.kind !== "near") {
    return invalid(networkId, "unsupported-network", "NEAR network must be near:mainnet or near:testnet");
  }
  if (address.length < 2 || address.length > 64) {
    return invalid(networkId, "invalid-address", "NEAR account IDs must contain 2 to 64 characters");
  }
  if (NEAR_IMPLICIT_ACCOUNT.test(address)) return valid(networkId, address);
  if (!NEAR_NAMED_ACCOUNT.test(address)) {
    return invalid(networkId, "invalid-address", "Invalid NEAR named account syntax");
  }
  return valid(networkId, address);
}

export function validateEvmRecipient(
  networkId: string,
  address: string,
): RecipientValidationResult {
  const network = getSupportedNetwork(networkId);
  if (!network || network.kind !== "evm") {
    return invalid(networkId, "unsupported-network", "EVM network must use an explicitly supported EIP-155 identifier");
  }
  if (!EVM_ADDRESS.test(address)) {
    return invalid(networkId, "invalid-address", "EVM recipient must be a 0x-prefixed 20-byte hexadecimal address");
  }
  if (address.toLowerCase() === ZERO_ADDRESS) {
    return invalid(networkId, "invalid-address", "Zero address is not allowed as a payout recipient");
  }
  const body = address.slice(2);
  const hasLower = /[a-f]/.test(body);
  const hasUpper = /[A-F]/.test(body);
  if (hasLower && hasUpper) {
    return invalid(networkId, "checksum-unverified", "Mixed-case EVM checksum cannot be verified: install and use an audited Keccak/EIP-55 library before accepting it");
  }
  // Uniform-case input is accepted as unchecksummed input. Comparison is canonical lowercase.
  return valid(networkId, address.toLowerCase());
}

export function normalizeRecipientAddress(
  networkId: string,
  address: string,
): string | null {
  const result = validateRecipient(networkId, address);
  return result.valid ? result.normalizedAddress : null;
}

function valid(networkId: string, normalizedAddress: string): RecipientValidationResult {
  return { valid: true, networkId, normalizedAddress, reason: null, code: "valid" };
}

function invalid(
  networkId: string,
  code: RecipientValidationResult["code"],
  reason: string,
): RecipientValidationResult {
  return { valid: false, networkId, normalizedAddress: null, reason, code };
}
