import { decodeFunctionData, encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import type { EvmFundingOperation, Campaign, Payout, Attempt, Reservation } from '@prisma/client';
import { erc20FundingAbi } from './erc20.js';

export interface EvmUnsignedTransfer {
  readonly account:Address;
  readonly chainId:number;
  readonly to:Address;
  readonly data:Hex;
  readonly value:bigint;
  readonly nonce:number;
  readonly gas:bigint;
  readonly maxFeePerGas:bigint;
  readonly maxPriorityFeePerGas:bigint;
}

export interface EvmFundingOperationContext {
  readonly operation:EvmFundingOperation;
  readonly campaign:Campaign;
  readonly reservation:Reservation;
  readonly attempt:Attempt;
  readonly payout:Payout;
}

/** Decode and validate the final EVM transaction immediately before the signer boundary. */
export function assertAuthorizedErc20Transfer(context:EvmFundingOperationContext,tx:EvmUnsignedTransfer,now:Date):void {
  const {operation:op,reservation,attempt,payout}=context;
  if(!['AUTHORIZED','SIGNED','UNKNOWN','BROADCAST','CONFIRMING'].includes(op.state))throw new Error('Funding operation is not in a signable or recoverable state');
  if(reservation.id!==op.reservationId||reservation.campaignId!==op.campaignId||reservation.payoutId!==op.payoutId||reservation.attemptId!==op.attemptId||reservation.status!=='ACTIVE'||reservation.remainingAmount!==op.tokenAmount||reservation.amount!==op.tokenAmount)throw new Error('Funding operation reservation is missing, released, or mismatched');
  if(context.campaign.id!==op.campaignId||context.campaign.assetId!==op.sourceAssetId||payout.id!==op.payoutId||payout.campaignId!==op.campaignId||attempt.id!==op.attemptId||attempt.payoutId!==op.payoutId||attempt.inputAssetId!==op.sourceAssetId||attempt.inputChain!==op.sourceChain||attempt.depositAddress!==op.destinationAddress)throw new Error('Funding operation campaign, payout, attempt, asset, chain, or destination association is invalid');
  if(!attempt.expiresAt||attempt.expiresAt<=now||attempt.timeWhenInactive&&attempt.timeWhenInactive<=now)throw new Error('Funding authorization is expired');
  if(payout.activeExposure<op.tokenAmount||!['RESERVED','COMMITTED'].includes(payout.status))throw new Error('Payout has no active funding exposure');
  const allowedKeys=['account','chainId','to','data','value','nonce','gas','maxFeePerGas','maxPriorityFeePerGas'];
  if(Object.keys(tx).some(key=>!allowedKeys.includes(key))||Object.keys(tx).length!==allowedKeys.length)throw new Error('Unexpected EVM transaction fields');
  if(tx.chainId!==Number(op.chainId)||getAddress(tx.account)!==getAddress(op.sourceAddress)||getAddress(tx.to)!==getAddress(op.tokenAddress))throw new Error('Transaction chain, source, or token contract is unauthorized');
  if(tx.nonce!==Number(op.nonce)||tx.value!==0n)throw new Error('Transaction nonce or native value is unauthorized');
  if(tx.gas<=0n||tx.gas>op.maxGasLimit||tx.maxFeePerGas<0n||tx.maxFeePerGas>op.maxFeePerGasCap||tx.maxPriorityFeePerGas<0n||tx.maxPriorityFeePerGas>op.maxPriorityFeePerGasCap||tx.maxPriorityFeePerGas>tx.maxFeePerGas)throw new Error('Transaction gas policy is exceeded');
  if(tx.gas*tx.maxFeePerGas>op.maxNativeGasCost)throw new Error('Maximum native gas expenditure is exceeded');
  let decoded;
  try{decoded=decodeFunctionData({abi:erc20FundingAbi,data:tx.data});}catch{throw new Error('Only canonical ERC-20 transfer calls are allowed');}
  if(decoded.functionName!=='transfer')throw new Error('Only ERC-20 transfer is allowed; approvals and other calls are rejected');
  const [recipient,amount]=decoded.args;
  if(!recipient||amount===undefined||getAddress(recipient)!==getAddress(op.destinationAddress)||amount!==op.tokenAmount)throw new Error('ERC-20 transfer recipient or amount does not match authorized operation');
  const canonical=encodeFunctionData({abi:erc20FundingAbi,functionName:'transfer',args:[recipient,amount]});
  if(canonical.toLowerCase()!==tx.data.toLowerCase())throw new Error('Noncanonical ERC-20 calldata is rejected');
}
