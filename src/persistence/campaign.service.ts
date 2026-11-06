import { PrismaClient } from '@prisma/client';
import { calculateExposure } from '../budget/budget-calculator.js';
import type { Amount, Asset } from '../domain/money.js';
export interface RecipientSpec { id:string; address:string; amount:bigint; quotedOutput:bigint; outputAssetId:string; outputChain:string; maximumInput:bigint; inputAsset:Asset; quoteId:string; expiresAt:Date; timeWhenInactive?:Date; depositAddress:string; depositMemo?:string|null; rawQuote?:object }
export class CampaignService {
  constructor(private readonly db:PrismaClient,private readonly now:()=>Date=()=>new Date()){}
  async createAndApprove(input:{id:string;idempotencyKey:string;budget:bigint;budgetAsset:Asset;recipients:RecipientSpec[];separatelyPayableFees?:Amount[]}):Promise<bigint>{
    if(!input.id.trim()||!input.idempotencyKey.trim())throw new Error('Campaign ID and idempotency key are required');
    if(input.recipients.length===0)throw new Error('Campaign requires recipients');
    for(const r of input.recipients){if(r.amount<=0n||r.maximumInput<=0n||r.quotedOutput!==r.amount||!r.quoteId||!r.depositAddress)throw new Error('Recipient quote is incomplete or does not guarantee promised output');if(r.expiresAt<=this.now()||r.timeWhenInactive&&r.timeWhenInactive<=this.now())throw new Error('Expired quote cannot be approved');}
    const fees=input.separatelyPayableFees??[];
    const exposure=calculateExposure({approved:input.budget,denomination:input.budgetAsset,quotes:input.recipients.map(r=>({atomic:r.maximumInput,asset:r.inputAsset})),separatelyPayableFees:fees});
    await this.db.$transaction(async tx=>{
      await tx.campaign.create({data:{id:input.id,idempotencyKey:input.idempotencyKey,budget:input.budget,assetId:input.budgetAsset.assetId,decimals:input.budgetAsset.decimals,status:'APPROVED',payouts:{create:input.recipients.map(r=>({id:`${input.id}:${r.id}`,recipientId:r.id,recipientAddress:r.address,promisedAmount:r.amount,outputAssetId:r.outputAssetId,outputChain:r.outputChain}))}}});
      await tx.ledgerEntry.create({data:{campaignId:input.id,type:'BUDGET_APPROVED',amount:input.budget,assetId:input.budgetAsset.assetId,externalRef:`budget:${input.id}`}});
      for(const r of input.recipients){
        const payoutId=`${input.id}:${r.id}`,attemptId=`${payoutId}:attempt:1`,reservationId=`${payoutId}:reservation:1`;
        await tx.attempt.create({data:{id:attemptId,payoutId,attemptNo:1,quoteId:r.quoteId,maxAmountIn:r.maximumInput,inputAssetId:r.inputAsset.assetId,inputChain:r.inputAsset.chain,outputAmount:r.amount,expiresAt:r.expiresAt,timeWhenInactive:r.timeWhenInactive??null,depositAddress:r.depositAddress,depositMemo:r.depositMemo??null,status:'COMMITTED',...(r.rawQuote?{providerJson:r.rawQuote}:{})}});
        await tx.payout.update({where:{id:payoutId},data:{status:'QUOTED'}});
        await tx.payoutEvent.create({data:{payoutId,fromStatus:'CREATED',toStatus:'QUOTED',note:'Provider quote validated',providerRef:r.quoteId}});
        await tx.reservation.create({data:{id:reservationId,campaignId:input.id,payoutId,attemptId,amount:r.maximumInput,remainingAmount:r.maximumInput,status:'ACTIVE'}});
        await tx.ledgerEntry.create({data:{campaignId:input.id,payoutId,type:'RESERVED',amount:r.maximumInput,assetId:r.inputAsset.assetId,externalRef:`reserve:${reservationId}`}});
        await tx.payout.update({where:{id:payoutId},data:{status:'RESERVED',activeExposure:r.maximumInput}});
        await tx.payoutEvent.create({data:{payoutId,fromStatus:'QUOTED',toStatus:'RESERVED',note:'Maximum input reserved for committed quote',providerRef:r.quoteId}});
        await tx.payout.update({where:{id:payoutId},data:{status:'COMMITTED'}});
        await tx.payoutEvent.create({data:{payoutId,fromStatus:'RESERVED',toStatus:'COMMITTED',note:'Committed quote address persisted; no deposit submitted',providerRef:r.quoteId}});
      }
      const feeTotal=fees.reduce((sum,f)=>sum+f.atomic,0n);
      if(feeTotal>0n){
        const reservationId=`${input.id}:fees:reservation`;
        await tx.reservation.create({data:{id:reservationId,campaignId:input.id,payoutId:null,attemptId:null,amount:feeTotal,remainingAmount:feeTotal,status:'ACTIVE'}});
        await tx.ledgerEntry.create({data:{campaignId:input.id,type:'RESERVED',amount:feeTotal,assetId:input.budgetAsset.assetId,externalRef:`reserve:${reservationId}`,reason:'Separately payable fees'}});
      }
    },{isolationLevel:'Serializable'});
    return exposure;
  }
}
