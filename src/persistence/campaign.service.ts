import { PrismaClient } from '@prisma/client';
import { calculateExposure } from '../budget/budget-calculator.js';
import type { Amount, Asset } from '../domain/money.js';
import type { QuoteRequest } from '../intents/provider.interface.js';
export interface RecipientSpec { id:string; address:string; amount:bigint; quotedOutput:bigint; outputAssetId:string; outputChain:string; maximumInput:bigint; inputAsset:Asset; quoteId:string; expiresAt:Date; timeWhenInactive?:Date; depositAddress:string; depositMemo?:string|null; rawQuote?:object }
export class CampaignService {
  constructor(private readonly db:PrismaClient,private readonly now:()=>Date=()=>new Date()){}

  async createDraft(input:{id:string;idempotencyKey:string;budget:bigint;budgetAsset:Asset}):Promise<{id:string;status:string}>{
    if(!input.id.trim()||!input.idempotencyKey.trim()||input.budget<=0n||input.budgetAsset.decimals<0||input.budgetAsset.decimals>30)throw new Error('Campaign identity, positive budget, and valid asset precision are required');
    const existing=await this.db.campaign.findUnique({where:{idempotencyKey:input.idempotencyKey}});
    if(existing){if(existing.id!==input.id||existing.budget!==input.budget||existing.assetId!==input.budgetAsset.assetId||existing.decimals!==input.budgetAsset.decimals)throw new Error('Campaign idempotency key conflicts with another request');return{id:existing.id,status:existing.status};}
    const campaign=await this.db.campaign.create({data:{id:input.id,idempotencyKey:input.idempotencyKey,budget:input.budget,assetId:input.budgetAsset.assetId,decimals:input.budgetAsset.decimals,status:'DRAFT'}});
    return{id:campaign.id,status:campaign.status};
  }

  async approveCampaign(id:string):Promise<void>{
    await this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{id:string;budget:bigint;assetId:string;status:string}>>`SELECT "id","budget","assetId","status" FROM "Campaign" WHERE "id"=${id} FOR UPDATE`;
      const campaign=rows[0];if(!campaign)throw new Error('Campaign not found');if(campaign.status==='APPROVED')return;if(campaign.status!=='DRAFT')throw new Error('Only a draft campaign can be approved');
      await tx.campaign.update({where:{id},data:{status:'APPROVED'}});
      await tx.ledgerEntry.create({data:{campaignId:id,type:'BUDGET_APPROVED',amount:campaign.budget,assetId:campaign.assetId,externalRef:`budget:${id}`}});
    },{isolationLevel:'Serializable'});
  }

  async createPayout(input:{campaignId:string;idempotencyKey:string;recipientId:string;recipientAddress:string;amount:bigint;outputAssetId:string;outputChain:string;quote:Omit<QuoteRequest,'dry'|'amount'|'originAsset'|'destinationAsset'|'recipient'>}):Promise<{id:string;status:string}>{
    if(!input.idempotencyKey.trim()||!input.recipientId.trim()||!input.recipientAddress.trim()||input.amount<=0n||!input.outputAssetId.trim()||!input.outputChain.trim())throw new Error('Payout identity, recipient, amount, output asset, and chain are required');
    const existing=await this.db.payout.findUnique({where:{idempotencyKey:input.idempotencyKey},include:{campaign:true,workItems:true}});
    if(existing){const expected={...input.quote,dry:false,originAsset:existing.campaign.assetId,destinationAsset:input.outputAssetId,amount:input.amount.toString(),recipient:input.recipientAddress};const persisted=existing.workItems.find(x=>x.kind==='SINGLE_PAYOUT')?.payload;if(existing.campaignId!==input.campaignId||existing.recipientId!==input.recipientId||existing.recipientAddress!==input.recipientAddress||existing.promisedAmount!==input.amount||existing.outputAssetId!==input.outputAssetId||existing.outputChain!==input.outputChain||JSON.stringify(persisted)!==JSON.stringify(expected))throw new Error('Payout idempotency key conflicts with another request');return{id:existing.id,status:existing.status};}
    const campaign=await this.db.campaign.findUniqueOrThrow({where:{id:input.campaignId}});if(campaign.status!=='APPROVED')throw new Error('Payouts can only be created in approved campaigns');
    if(!input.quote.refundTo.trim())throw new Error('Quote request requires a refund address');
    const payload={...input.quote,dry:false,originAsset:campaign.assetId,destinationAsset:input.outputAssetId,amount:input.amount.toString(),recipient:input.recipientAddress} satisfies QuoteRequest;
    const id=`${input.campaignId}:${input.recipientId}`;
    const payout=await this.db.payout.create({data:{id,idempotencyKey:input.idempotencyKey,campaignId:campaign.id,recipientId:input.recipientId,recipientAddress:input.recipientAddress,promisedAmount:input.amount,outputAssetId:input.outputAssetId,outputChain:input.outputChain,status:'CREATED',workItems:{create:{kind:'SINGLE_PAYOUT',payload}}}});
    return{id:payout.id,status:payout.status};
  }

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
        await tx.ledgerEntry.create({data:{campaignId:input.id,payoutId,attemptId,type:'RESERVED',amount:r.maximumInput,assetId:r.inputAsset.assetId,externalRef:`reserve:${reservationId}`}});
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
