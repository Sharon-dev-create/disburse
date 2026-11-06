import type { PayoutStatus } from '../domain/payout.js';
import type { StatusResult } from '../intents/provider.interface.js';
export interface PayoutFacts { status:PayoutStatus; promisedOutput:bigint; outputAssetId:string; inputAssetId:string; reserved:bigint }
export function reconcile(facts:PayoutFacts,result:StatusResult):{status:PayoutStatus;releaseExposure:boolean;settledInput?:bigint;confirmedRefund?:bigint;txHashes:string[]}{
  if(result.status==='SUCCESS'){
    if(result.amountOut!==facts.promisedOutput)throw new Error('Settlement output does not equal promise');
    if(!result.amountIn)throw new Error('Successful settlement missing actual input amount');
    if(result.amountIn>facts.reserved)throw new Error('Actual settlement input exceeds reserved maximum');
    return {status:'SUCCESS',releaseExposure:true,settledInput:result.amountIn,txHashes:result.destinationTxHashes};
  }
  if(result.status==='REFUNDED'){
    if(!result.refundedAmount||result.refundAssetId&&result.refundAssetId!==facts.inputAssetId)throw new Error('Refund amount or asset is not validated');
    if(result.refundedAmount>facts.reserved)throw new Error('Refund exceeds reserved input');
    return {status:'REFUNDED',releaseExposure:true,confirmedRefund:result.refundedAmount,txHashes:result.originTxHashes};
  }
  if(result.status==='FAILED'||result.status==='INCOMPLETE_DEPOSIT')return {status:'FAILED',releaseExposure:false,txHashes:result.originTxHashes};
  if(result.status==='PENDING_DEPOSIT')return {status:'AWAITING_DEPOSIT',releaseExposure:false,txHashes:[]};
  return {status:'PROCESSING',releaseExposure:false,txHashes:result.originTxHashes};
}
