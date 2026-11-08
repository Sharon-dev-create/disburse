export type NetworkKind = "evm" | "near";

export interface SupportedNetwork {
  readonly networkId: string;
  readonly kind: NetworkKind;
  readonly chainId: string | null;
  readonly providerNetworkId: string;
  readonly environment: "mainnet" | "testnet";
  /** Address format support does not mean a provider route is enabled. */
  readonly recipientFormatSupported: boolean;
  readonly executionEnabled: false;
}

export const SUPPORTED_NETWORKS: Readonly<Record<string, SupportedNetwork>> =
  Object.freeze({
    "eip155:1": Object.freeze({
      networkId: "eip155:1",
      kind: "evm",
      chainId: "1",
      providerNetworkId: "eth",
      environment: "mainnet",
      recipientFormatSupported: true,
      executionEnabled: false,
    }),
    "eip155:8453": Object.freeze({
      networkId: "eip155:8453",
      kind: "evm",
      chainId: "8453",
      providerNetworkId: "base",
      environment: "mainnet",
      recipientFormatSupported: true,
      executionEnabled: false,
    }),
    "near:mainnet": Object.freeze({
      networkId: "near:mainnet",
      kind: "near",
      chainId: null,
      providerNetworkId: "near",
      environment: "mainnet",
      recipientFormatSupported: true,
      executionEnabled: false,
    }),
    "near:testnet": Object.freeze({
      networkId: "near:testnet",
      kind: "near",
      chainId: null,
      providerNetworkId: "near-testnet",
      environment: "testnet",
      recipientFormatSupported: true,
      executionEnabled: false,
    }),
  });

export function getSupportedNetwork(
  networkId: string,
): SupportedNetwork | null {
  return SUPPORTED_NETWORKS[networkId] ?? null;
}
