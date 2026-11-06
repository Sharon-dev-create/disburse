export interface FundingAdapterCapabilities {
  readonly chainFamily:'EVM';
  readonly chainId:number;
  readonly sourceChain:string;
  readonly maxDepositEnforcement:'INDEPENDENT_SIGNER_POLICY'|'CONTRACT_ESCROW'|'UNAVAILABLE';
  readonly supportedAssetClass:'ALLOWLISTED_STANDARD_ERC20'|'NATIVE'|'CHAIN_SPECIFIC';
  readonly independentlyVerifiableEvidence:'TRANSACTION_AND_RECEIPT'|'CHAIN_SPECIFIC'|'NONE';
  readonly finalityModel:'CONFIRMATION_DEPTH'|'CHAIN_FINALITY'|'CHAIN_SPECIFIC';
  readonly productionReady:boolean;
}

/** Capabilities for this proof only; never infer EVM-wide or production support from it. */
export function localAnvilCapabilities(chainId:number,sourceChain:string):FundingAdapterCapabilities {
  return{chainFamily:'EVM',chainId,sourceChain,maxDepositEnforcement:'INDEPENDENT_SIGNER_POLICY',supportedAssetClass:'ALLOWLISTED_STANDARD_ERC20',independentlyVerifiableEvidence:'TRANSACTION_AND_RECEIPT',finalityModel:'CONFIRMATION_DEPTH',productionReady:false};
}
