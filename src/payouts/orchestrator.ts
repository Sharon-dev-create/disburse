import type { IntentsProvider, QuoteRequest } from '../intents/provider.interface.js';
import type { PayoutStatus } from '../domain/payout.js';
import { assertTransition } from '../domain/payout.js';
import { ReservationService } from '../budget/reservation.service.js';
import { PrismaClient } from '@prisma/client';
export class PayoutOrchestrator {
  constructor(private readonly db:PrismaClient,private readonly provider:IntentsProvider,private readonly reservations:ReservationService,private readonly now:()=>Date=()=>new Date()){}
  async createCommittedQuote(payoutId:string,request:QuoteRequest,retryKey:string,sourceChain?:string):Promise<string>{
    if(!retryKey.trim())throw new Error('Retry idempotency key is required');
    const prior=await this.db.attempt.findUnique({where:{retryKey}});
    if(prior){if(prior.payoutId!==payoutId||!prior.quoteId)throw new Error('Retry key belongs to another payout or incomplete attempt');return prior.quoteId;}
    const payout=await this.db.payout.findUniqueOrThrow({where:{id:payoutId}});
    const campaign=await this.db.campaign.findUniqueOrThrow({where:{id:payout.campaignId}});
    if(!['CREATED','FAILED','EXPIRED','REFUNDED'].includes(payout.status)||payout.activeExposure!==0n)throw new Error('Payout is not safely retryable; unresolved exposure remains');
    if(campaign.status!=='APPROVED'||request.originAsset!==campaign.assetId||request.destinationAsset!==payout.outputAssetId||request.amount!==payout.promisedAmount.toString()||request.recipient!==payout.recipientAddress||request.swapType!=='EXACT_OUTPUT'||request.dry)throw new Error('Quote request does not match the approved campaign and payout');
    const quote=await this.provider.quote({...request,dry:false});
    if(!quote.deadline||quote.deadline<=this.now()||!quote.depositAddress||quote.amountIn<quote.minAmountIn||quote.maxAmountIn!==quote.amountIn)throw new Error('Committed quote omitted valid deadline, deposit instructions, or input bounds');
    if(quote.amountOut!==payout.promisedAmount)throw new Error('Quote amount differs from promise');
    const current=payout.status as PayoutStatus; assertTransition(current,'QUOTED');
    const attemptNo=await this.db.attempt.count({where:{payoutId}})+1;
    await this.db.$transaction(async tx=>{
      await tx.attempt.create({data:{id:`${payoutId}:attempt:${attemptNo}`,payoutId,attemptNo,retryKey,quoteId:quote.correlationId,maxAmountIn:quote.maxAmountIn,inputAssetId:request.originAsset,...(sourceChain?{inputChain:sourceChain}:{}),outputAmount:quote.amountOut,expiresAt:quote.deadline!,timeWhenInactive:quote.timeWhenInactive??null,depositAddress:quote.depositAddress,depositMemo:quote.depositMemo??null,status:'QUOTED',providerJson:quote.rawSanitized as object}});
      await tx.payout.update({where:{id:payoutId},data:{status:'QUOTED'}});
      await tx.payoutEvent.create({data:{payoutId,fromStatus:current,toStatus:'QUOTED',note:'Committed quote obtained; no deposit submitted',providerRef:quote.correlationId}});
    });
    return quote.correlationId;
  }
  async reserve(payoutId:string,reservationId:string):Promise<void>{
    const payout=await this.db.payout.findUniqueOrThrow({where:{id:payoutId}}); const attempt=await this.db.attempt.findFirstOrThrow({where:{payoutId},orderBy:{attemptNo:'desc'}});
    if(!attempt.maxAmountIn||!attempt.expiresAt||attempt.expiresAt<=this.now()||attempt.timeWhenInactive&&attempt.timeWhenInactive<=this.now())throw new Error('Missing or expired max input quote');
    await this.reservations.reserve(payout.campaignId,payoutId,attempt.id,reservationId,attempt.maxAmountIn);
  }
}
