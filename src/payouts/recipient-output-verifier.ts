import { decodeEventLog, getAddress, type Address, type Hex } from 'viem';
import type { StatusResult } from '../intents/provider.interface.js';
import type { EvmChainAdapter, EvmTokenConfig } from '../funding-control/evm/evm-chain-adapter.js';
import { erc20FundingAbi } from '../funding-control/evm/erc20.js';

export interface RecipientOutputEvidence {
  readonly chain:string;
  readonly assetId:string;
  readonly recipient:string;
  readonly amount:bigint;
  readonly transactionHash:string;
  readonly blockNumber:bigint;
  readonly blockHash:string;
}
export interface RecipientOutputVerifier {
  verify(input:{chain:string;assetId:string;recipient:string;amount:bigint;provider:StatusResult}):Promise<RecipientOutputEvidence>;
}

/** EVM-only output verifier. Exactly one provider-reported tx and one matching standard ERC-20 Transfer event are required. */
export class EvmRecipientOutputVerifier implements RecipientOutputVerifier {
  constructor(private readonly configured:EvmTokenConfig,private readonly chain:EvmChainAdapter,private readonly confirmations:bigint){if(confirmations<1n)throw new Error('At least one confirmation is required');}
  async verify(input:{chain:string;assetId:string;recipient:string;amount:bigint;provider:StatusResult}):Promise<RecipientOutputEvidence>{
    if(input.chain!==this.configured.sourceChain||input.assetId!==this.configured.assetId||input.provider.outputAssetId!==input.assetId||input.provider.recipient!==input.recipient)throw new Error('Provider output instructions do not match configured output verifier');
    if(input.provider.destinationTxHashes.length!==1)throw new Error('Exactly one destination transaction is required for independent output verification');
    await this.chain.assertChainAndToken();
    const hash=input.provider.destinationTxHashes[0] as Hex;
    const tx=await this.chain.publicClient.getTransaction({hash});const receipt=await this.chain.publicClient.getTransactionReceipt({hash});
    if(tx.chainId!==this.configured.chainId||!tx.to||getAddress(tx.to)!==getAddress(this.configured.tokenAddress)||tx.value!==0n||receipt.status!=='success')throw new Error('Destination transaction does not match the configured output token or successful receipt');
    const transfers=receipt.logs.filter(log=>getAddress(log.address)===getAddress(this.configured.tokenAddress)).flatMap(log=>{try{const event=decodeEventLog({abi:erc20FundingAbi,eventName:'Transfer',data:log.data,topics:log.topics});return event.args.to&&event.args.value!==undefined?[event.args]:[];}catch{return[];}});
    if(transfers.length!==1||getAddress(transfers[0]!.to)!==getAddress(input.recipient)||transfers[0]!.value!==input.amount)throw new Error('Destination receipt does not prove the exact promised recipient output');
    const block=await this.chain.publicClient.getBlock({blockNumber:receipt.blockNumber});if(block.hash!==receipt.blockHash)throw new Error('Destination receipt block is not canonical');
    if(await this.chain.publicClient.getBlockNumber()-receipt.blockNumber+1n<this.confirmations)throw new Error('Destination output has not reached configured confirmation depth');
    return{chain:input.chain,assetId:input.assetId,recipient:getAddress(input.recipient),amount:input.amount,transactionHash:hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash};
  }
}
