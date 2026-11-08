import { getSupportedNetwork } from "./networks.ts";

export interface RecipientValidationResult {
  readonly valid: boolean;
  readonly networkId: string;
  readonly normalizedAddress: string | null;
  readonly reason: string | null;
  readonly code:
    "valid" | "unsupported-network" | "invalid-address" | "checksum-unverified";
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const NEAR_IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;
const NEAR_NAMED_ACCOUNT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function validateRecipient(
  networkId: string,
  address: string,
): RecipientValidationResult {
  if (
    typeof networkId !== "string" ||
    getSupportedNetwork(networkId) === null
  ) {
    return invalid(
      networkId,
      "unsupported-network",
      "Unsupported or non-canonical network identifier",
    );
  }
  if (
    typeof address !== "string" ||
    address.length === 0 ||
    address.length > 128 ||
    address !== address.trim()
  ) {
    return invalid(
      networkId,
      "invalid-address",
      "Recipient must be non-empty, trimmed, and at most 128 characters",
    );
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
    return invalid(
      networkId,
      "unsupported-network",
      "NEAR network must be near:mainnet or near:testnet",
    );
  }
  if (address.length < 2 || address.length > 64) {
    return invalid(
      networkId,
      "invalid-address",
      "NEAR account IDs must contain 2 to 64 characters",
    );
  }
  if (NEAR_IMPLICIT_ACCOUNT.test(address)) return valid(networkId, address);
  if (!NEAR_NAMED_ACCOUNT.test(address)) {
    return invalid(
      networkId,
      "invalid-address",
      "Invalid NEAR named account syntax",
    );
  }
  return valid(networkId, address);
}

export function validateEvmRecipient(
  networkId: string,
  address: string,
): RecipientValidationResult {
  const network = getSupportedNetwork(networkId);
  if (!network || network.kind !== "evm") {
    return invalid(
      networkId,
      "unsupported-network",
      "EVM network must use an explicitly supported EIP-155 identifier",
    );
  }
  if (!EVM_ADDRESS.test(address)) {
    return invalid(
      networkId,
      "invalid-address",
      "EVM recipient must be a 0x-prefixed 20-byte hexadecimal address",
    );
  }
  if (address.toLowerCase() === ZERO_ADDRESS) {
    return invalid(
      networkId,
      "invalid-address",
      "Zero address is not allowed as a payout recipient",
    );
  }
  const body = address.slice(2);
  const hasLower = /[a-f]/.test(body);
  const hasUpper = /[A-F]/.test(body);
  if (hasLower && hasUpper) {
    if (toEip55(address) !== address) {
      return invalid(
        networkId,
        "invalid-address",
        "Mixed-case EVM address has an invalid EIP-55 checksum",
      );
    }
  }
  // Uniform-case input is accepted as unchecksummed input. Comparison is canonical lowercase.
  return valid(networkId, address.toLowerCase());
}

function toEip55(address: string): string {
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256Hex(lower);
  let checksummed = "0x";
  for (let index = 0; index < lower.length; index += 1) {
    const character = lower[index]!;
    checksummed +=
      Number.parseInt(hash[index]!, 16) >= 8
        ? character.toUpperCase()
        : character;
  }
  return checksummed;
}

// Keccak-256 (Ethereum padding), used only for EIP-55 address checksums.
function keccak256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const rate = 136;
  const paddedLength = Math.ceil((bytes.length + 1) / rate) * rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] = padded[padded.length - 1]! | 0x80;
  const state = Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let index = 0; index < rate; index += 1) {
      state[Math.floor(index / 8)]! ^=
        BigInt(padded[offset + index]!) << BigInt((index % 8) * 8);
    }
    keccakPermutation(state);
  }
  let result = "";
  for (let index = 0; index < 32; index += 1) {
    const byte = Number(
      (state[Math.floor(index / 8)]! >> BigInt((index % 8) * 8)) & 0xffn,
    );
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

function keccakPermutation(state: bigint[]): void {
  const mask = (1n << 64n) - 1n;
  const rotations = [
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8,
    18, 2, 61, 56, 14,
  ];
  const roundConstants = [
    0x0000000000000001n,
    0x0000000000008082n,
    0x800000000000808an,
    0x8000000080008000n,
    0x000000000000808bn,
    0x0000000080000001n,
    0x8000000080008081n,
    0x8000000000008009n,
    0x000000000000008an,
    0x0000000000000088n,
    0x0000000080008009n,
    0x000000008000000an,
    0x000000008000808bn,
    0x800000000000008bn,
    0x8000000000008089n,
    0x8000000000008003n,
    0x8000000000008002n,
    0x8000000000000080n,
    0x000000000000800an,
    0x800000008000000an,
    0x8000000080008081n,
    0x8000000000008080n,
    0x0000000080000001n,
    0x8000000080008008n,
  ];
  const rotate = (value: bigint, amount: number): bigint => {
    if (amount === 0) return value & mask;
    const shift = BigInt(amount);
    return ((value << shift) | (value >> (64n - shift))) & mask;
  };
  for (const roundConstant of roundConstants) {
    const columns = Array<bigint>(5).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) columns[x]! ^= state[x + 5 * y]!;
    }
    const deltas = columns.map(
      (_, x) => columns[(x + 4) % 5]! ^ rotate(columns[(x + 1) % 5]!, 1),
    );
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) state[x + 5 * y]! ^= deltas[x]!;
    }
    const moved = Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(
          state[x + 5 * y]!,
          rotations[x + 5 * y]!,
        );
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] =
          moved[x + 5 * y]! ^
          (~moved[((x + 1) % 5) + 5 * y]! & moved[((x + 2) % 5) + 5 * y]!);
      }
    }
    state[0] = state[0]! ^ roundConstant;
  }
}

export function normalizeRecipientAddress(
  networkId: string,
  address: string,
): string | null {
  const result = validateRecipient(networkId, address);
  return result.valid ? result.normalizedAddress : null;
}

function valid(
  networkId: string,
  normalizedAddress: string,
): RecipientValidationResult {
  return {
    valid: true,
    networkId,
    normalizedAddress,
    reason: null,
    code: "valid",
  };
}

function invalid(
  networkId: string,
  code: RecipientValidationResult["code"],
  reason: string,
): RecipientValidationResult {
  return { valid: false, networkId, normalizedAddress: null, reason, code };
}
