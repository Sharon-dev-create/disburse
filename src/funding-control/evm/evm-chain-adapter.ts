import { createPublicClient, defineChain, encodeFunctionData, http, type Address, type Chain, type Hex, type PublicClient } from 'viem';
import { erc20FundingAbi } from './erc20.js';
import type { EvmUnsignedTransfer } from './policy.js';

export interface EvmTokenConfig {
  readonly assetId:string;
  readonly sourceChain:string;
  readonly chainId:number;
  readonly tokenAddress:Address;
  readonly decimals:number;
}

export interface EvmGasPolicy {
  readonly maxGasLimit:bigint;
  readonly maxFeePerGas:bigint;
  readonly maxPriorityFeePerGas:bigint;
  readonly maxNativeGasCost:bigint;
}

export const LOCAL_ANVIL_CHAIN_ID=31337;

export function anvilChain(chainId:number,rpcUrl:string):Chain {
  return defineChain({id:chainId,name:'Local Anvil',nativeCurrency:{name:'Anvil Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpcUrl]}}});
}

export class EvmChainAdapter {
  readonly publicClient:PublicClient;
  constructor(readonly chain:Chain,readonly token:EvmTokenConfig,rpcUrl:string){
    this.publicClient=createPublicClient({chain,transport:http(rpcUrl)});
  }

  async assertChainAndToken():Promise<void>{
    if(this.token.chainId!==LOCAL_ANVIL_CHAIN_ID||await this.publicClient.getChainId()!==LOCAL_ANVIL_CHAIN_ID||this.chain.id!==LOCAL_ANVIL_CHAIN_ID)throw new Error('EVM funding spike is restricted to local Anvil chain ID 31337');
    const decimals=await this.publicClient.readContract({address:this.token.tokenAddress,abi:erc20FundingAbi,functionName:'decimals'});
    if(Number(decimals)!==this.token.decimals)throw new Error('ERC-20 decimals do not match approved token configuration');
  }

  async getTokenBalance(account:Address):Promise<bigint>{return this.publicClient.readContract({address:this.token.tokenAddress,abi:erc20FundingAbi,functionName:'balanceOf',args:[account]});}
  async getPendingNonce(account:Address):Promise<number>{return this.publicClient.getTransactionCount({address:account,blockTag:'pending'});}

  async buildUnsignedTransfer(args:{from:Address;to:Address;amount:bigint;nonce:number;gasPolicy:EvmGasPolicy}):Promise<EvmUnsignedTransfer>{
    await this.assertChainAndToken();
    if(args.amount<=0n)throw new Error('ERC-20 transfer amount must be positive');
    const data=encodeFunctionData({abi:erc20FundingAbi,functionName:'transfer',args:[args.to,args.amount]});
    const estimate=await this.publicClient.estimateGas({account:args.from,to:this.token.tokenAddress,data,value:0n});
    const gas=(estimate*120n+99n)/100n;
    if(gas>args.gasPolicy.maxGasLimit)throw new Error('Estimated gas exceeds configured maximum');
    const latest=await this.publicClient.getBlock({blockTag:'latest'});
    const baseFee=latest.baseFeePerGas??await this.publicClient.getGasPrice();
    const priority=args.gasPolicy.maxPriorityFeePerGas;
    const suggested=baseFee*2n+priority;
    const maxFeePerGas=suggested<args.gasPolicy.maxFeePerGas?suggested:args.gasPolicy.maxFeePerGas;
    if(maxFeePerGas<baseFee+priority)throw new Error('Configured maximum fee cannot cover current base fee and priority fee');
    if(gas*maxFeePerGas>args.gasPolicy.maxNativeGasCost)throw new Error('Maximum native gas expenditure exceeds policy');
    if(await this.getTokenBalance(args.from)<args.amount)throw new Error('Source account has insufficient ERC-20 balance');
    if(await this.publicClient.getBalance({address:args.from})<gas*maxFeePerGas)throw new Error('Source account has insufficient native gas balance');
    return {account:args.from,chainId:this.token.chainId,to:this.token.tokenAddress,data,value:0n,nonce:args.nonce,gas,maxFeePerGas,maxPriorityFeePerGas:priority};
  }

  async signThroughUnlockedLocalNode(tx:EvmUnsignedTransfer):Promise<Hex>{
    // Anvil handles the disposable private key. This method is for local testing only.
    const request={from:tx.account,to:tx.to,data:tx.data,value:toRpcHex(tx.value),gas:toRpcHex(tx.gas),nonce:toRpcHex(BigInt(tx.nonce)),chainId:toRpcHex(BigInt(tx.chainId)),maxFeePerGas:toRpcHex(tx.maxFeePerGas),maxPriorityFeePerGas:toRpcHex(tx.maxPriorityFeePerGas),type:'0x2'};
    const rpcRequest=this.publicClient.transport.request as unknown as (args:{method:string;params:unknown[]})=>Promise<unknown>;
    const result=await rpcRequest({method:'eth_signTransaction',params:[request]});
    if(typeof result!=='string'||!/^0x[0-9a-f]+$/i.test(result))throw new Error('Local Anvil signer returned an invalid serialized transaction');
    return result as Hex;
  }

  async broadcast(signedTransaction:Hex):Promise<Hex>{return this.publicClient.sendRawTransaction({serializedTransaction:signedTransaction});}
}

function toRpcHex(value:bigint):Hex{return `0x${value.toString(16)}` as Hex;}
