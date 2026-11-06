import type { IntentsProvider, QuoteRequest } from '../intents/provider.interface.js';
import type { PayoutStatus } from '../domain/payout.js';
import { assertTransition } from '../domain/payout.js';
import { ReservationService } from '../budget/reservation.service.js';
import { PrismaClient } from '@prisma/client';
export class PayoutOrchestrator {
  constructor(private readonly db:PrismaClient,private readonly provider:IntentsProvider,private readonly reservations:ReservationService,private readonly now:()=>Date=()=>new Date()){}
  async createCommittedQuote(payoutId:string,request:QuoteRequest):Promise<string>{
    const payout=await this.db.payout.findUniqueOrThrow({where:{id:payoutId}});
    if(payout.status==='SUCCESS'||payout.status==='UNKNOWN'||payout.status==='PROCESSING'||payout.status==='AWAITING_DEPOSIT')throw new Error('Payout cannot be quoted while prior attempt may execute');
    const quote=await this.provider.quote({...request,dry:false});
    if(quote.deadline<=this.now())throw new Error('Quote already expired');
    if(quote.amountOut!==payout.promisedAmount)throw new Error('Quote amount differs from promise');
    const current=payout.status as PayoutStatus; assertTransition(current,'QUOTED');
    const attemptNo=await this.db.attempt.count({where:{payoutId}})+1;
    await this.db.$transaction(async tx=>{
      await tx.attempt.create({data:{id:`${payoutId}:attempt:${attemptNo}`,payoutId,attemptNo,quoteId:quote.correlationId,maxAmountIn:quote.maxAmountIn,inputAssetId:request.originAsset,outputAmount:quote.amountOut,expiresAt:quote.deadline,depositAddress:quote.depositAddress??null,depositMemo:quote.depositMemo??null,status:'QUOTED',providerJson:quote.rawSanitized as object}});
      await tx.payout.update({where:{id:payoutId},data:{status:'QUOTED'}});
      await tx.payoutEvent.create({data:{payoutId,fromStatus:current,toStatus:'QUOTED',note:'Committed quote obtained; no deposit submitted',providerRef:quote.correlationId}});
    });
    return quote.correlationId;
  }
  async reserve(payoutId:string,reservationId:string):Promise<void>{
    const payout=await this.db.payout.findUniqueOrThrow({where:{id:payoutId}}); const attempt=await this.db.attempt.findFirstOrThrow({where:{payoutId},orderBy:{attemptNo:'desc'}});
    if(!attempt.maxAmountIn||!attempt.expiresAt||attempt.expiresAt<=this.now())throw new Error('Missing or expired max input quote');
    await this.reservations.reserve(payout.campaignId,payoutId,reservationId,attempt.maxAmountIn);
  }
}
