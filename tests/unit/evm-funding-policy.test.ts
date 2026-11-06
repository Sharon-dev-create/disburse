import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { assertAuthorizedErc20Transfer, type EvmFundingOperationContext, type EvmUnsignedTransfer } from '../../src/funding-control/evm/policy.js';

const account='0x0000000000000000000000000000000000000011' as Address;
const token='0x0000000000000000000000000000000000000022' as Address;
const destination='0x0000000000000000000000000000000000000033' as Address;
const abi=parseAbi(['function transfer(address,uint256)','function approve(address,uint256)']);
const operation={id:'op',campaignId:'c',payoutId:'p',attemptId:'a',reservationId:'r',idempotencyKey:'i',quoteId:'q',chainId:31337n,sourceAssetId:'USDC',sourceChain:'ETHEREUM',sourceAddress:account.toLowerCase(),tokenAddress:token.toLowerCase(),tokenAmount:1000n,tokenDecimals:6,destinationAddress:destination,destinationMemo:null,quoteExpiresAt:new Date(Date.now()+60000),nonce:4n,gasLimit:50000n,maxFeePerGas:10n,maxPriorityFeePerGas:2n,maxGasLimit:60000n,maxFeePerGasCap:20n,maxPriorityFeePerGasCap:3n,maxNativeGasCost:1000000n,state:'AUTHORIZED',txHash:null,signedTxCiphertext:null,signedTxIv:null,signedTxAuthTag:null,failureReason:null,lastObservedBlock:null,lastObservedBlockHash:null,createdAt:new Date(),authorizedAt:new Date(),signedAt:null,broadcastAt:null,confirmedAt:null,reconciledAt:null,updatedAt:new Date()} as unknown as EvmFundingOperationContext['operation'];
const context={operation,campaign:{id:'c',assetId:'USDC',sourceChain:'ETHEREUM'},payout:{id:'p',campaignId:'c',activeExposure:1000n,status:'RESERVED'},attempt:{id:'a',payoutId:'p',quoteId:'q',inputAssetId:'USDC',inputChain:'ETHEREUM',depositAddress:destination,depositMemo:null,expiresAt:new Date(Date.now()+60000),timeWhenInactive:null},reservation:{id:'r',campaignId:'c',payoutId:'p',attemptId:'a',amount:1000n,remainingAmount:1000n,status:'ACTIVE'}} as unknown as EvmFundingOperationContext;
const tx=(overrides:Partial<EvmUnsignedTransfer>={}):EvmUnsignedTransfer=>({account,chainId:31337,to:token,data:encodeFunctionData({abi,functionName:'transfer',args:[destination,1000n]}),value:0n,nonce:4,gas:50000n,maxFeePerGas:10n,maxPriorityFeePerGas:2n,...overrides});

describe('EVM funding policy boundary',()=>{
  it('allows only the persisted exact ERC-20 amount and destination',()=>expect(()=>assertAuthorizedErc20Transfer(context,tx(),new Date())).not.toThrow());
  it('rejects an oversized transfer before signing',()=>expect(()=>assertAuthorizedErc20Transfer(context,tx({data:encodeFunctionData({abi,functionName:'transfer',args:[destination,1001n]})}),new Date())).toThrow(/recipient or amount/));
  it('rejects native value, wrong chain, token, source, and gas policy',()=>{
    for(const change of [{value:1n},{chainId:1},{to:destination},{account:destination},{gas:60001n},{maxFeePerGas:21n}])expect(()=>assertAuthorizedErc20Transfer(context,tx(change),new Date())).toThrow();
  });
  it('rejects approvals and extended transaction fields',()=>{
    const approval=tx({data:encodeFunctionData({abi,functionName:'approve',args:[destination,1000n]})});
    expect(()=>assertAuthorizedErc20Transfer(context,approval,new Date())).toThrow(/Only canonical/);
    expect(()=>assertAuthorizedErc20Transfer(context,{...tx(),accessList:[]} as unknown as EvmUnsignedTransfer,new Date())).toThrow(/Unexpected/);
  });
  it('rejects expired authorization or released reservation',()=>{
    expect(()=>assertAuthorizedErc20Transfer(context,tx(),new Date(Date.now()+120000))).toThrow(/expired/);
    expect(()=>assertAuthorizedErc20Transfer({...context,reservation:{...context.reservation,status:'RELEASED'} as never},tx(),new Date())).toThrow(/reservation/);
  });
});
