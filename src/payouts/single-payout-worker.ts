import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma, type PayoutWorkItem } from '@prisma/client';
import type { IntentsProvider, QuoteRequest, StatusResult } from '../intents/provider.interface.js';
import type { EvmFundingService } from '../funding-control/evm/evm-funding.service.js';
import { ReservationService } from '../budget/reservation.service.js';
import { PayoutOrchestrator } from './orchestrator.js';
import { SettlementService } from './settlement.service.js';
import type { RecipientOutputVerifier } from './recipient-output-verifier.js';

interface ClaimedWork {id:string;payoutId:string;payload:Prisma.JsonValue;attempts:number;maxAttempts:number;lockToken:string}
export interface WorkerTickResult {processed:boolean;payoutId?:string;state?:string;error?:string}
const quoteRequest=(payload:Prisma.JsonValue):QuoteRequest=>{
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Persisted payout quote request is invalid');
  const p=payload as Record<string,unknown>;
  const strings=['swapType','originAsset','destinationAsset','amount','recipient','refundTo','depositType','recipientType','refundType','deadline'];
  if(strings.some(key=>typeof p[key]!=='string')||typeof p.slippageTolerance!=='number'||p.swapType!=='EXACT_OUTPUT'||p.dry!==false)throw new Error('Persisted payout quote request is incomplete');
  return p as unknown as QuoteRequest;
};

/** Durable Postgres-backed single-payout worker. An expired lease is recoverable after process restart. */
export class SinglePayoutWorker {
  private readonly orchestrator:PayoutOrchestrator;
  private readonly reservations:ReservationService;
  private readonly settlement:SettlementService;
  constructor(private readonly db:PrismaClient,private readonly provider:IntentsProvider,private readonly funding:EvmFundingService,private readonly outputVerifier:RecipientOutputVerifier|undefined,private readonly sourceChain:string,private readonly now:()=>Date=()=>new Date(),private readonly leaseMs=60_000){
    this.reservations=new ReservationService(db,now);this.orchestrator=new PayoutOrchestrator(db,provider,this.reservations,now);this.settlement=new SettlementService(db,now);
  }

  async processOne():Promise<WorkerTickResult>{
    await this.markExhausted();
    const work=await this.claim();if(!work)return{processed:false};
    try{
      const result=await this.advance(work);
      if(result.done){await this.finish(work);return{processed:true,payoutId:work.payoutId,state:result.state};}
      await this.reschedule(work,result.delayMs??250);
      return{processed:true,payoutId:work.payoutId,state:result.state};
    }catch(error){
      const message=error instanceof Error?error.message:'Unknown orchestration failure';
      if(work.attempts>=work.maxAttempts){await this.manualReview(work,message);return{processed:true,payoutId:work.payoutId,state:'MANUAL_REVIEW',error:message};}
      const backoff=Math.min(1_000*2**Math.min(work.attempts-1,8),300_000);
      await this.reschedule(work,backoff,message);
      return{processed:true,payoutId:work.payoutId,state:'RETRY',error:message};
    }
  }

  private async claim():Promise<ClaimedWork|null>{
    const token=randomUUID();const now=this.now();
    return this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<ClaimedWork[]>`WITH candidate AS (
        SELECT "id" FROM "PayoutWorkItem"
        WHERE "attempts" < "maxAttempts" AND (("state"='READY' AND "availableAt"<=${now}) OR ("state"='LEASED' AND "leaseUntil"<=${now}))
        ORDER BY "availableAt","createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE "PayoutWorkItem" w SET "state"='LEASED',"lockToken"=${token},"leaseUntil"=${new Date(now.getTime()+this.leaseMs)},"attempts"=w."attempts"+1,"updatedAt"=${now}
      FROM candidate c WHERE w."id"=c."id" RETURNING w."id",w."payoutId",w."payload",w."attempts",w."maxAttempts",w."lockToken"`;
      return rows[0]??null;
    });
  }

  private async markExhausted():Promise<void>{
    const now=this.now();
    const items=await this.db.$queryRaw<Array<{id:string;payoutId:string}>>`UPDATE "PayoutWorkItem" SET "state"='MANUAL_REVIEW',"lockToken"=NULL,"leaseUntil"=NULL,"lastError"=COALESCE("lastError",'Bounded retry limit reached'),"updatedAt"=${now}
      WHERE "attempts">="maxAttempts" AND (("state"='READY' AND "availableAt"<=${now}) OR ("state"='LEASED' AND "leaseUntil"<=${now})) RETURNING "id","payoutId"`;
    for(const item of items)await this.markPayoutManual(item.payoutId,'Bounded retry limit reached');
  }

  private async advance(work:ClaimedWork):Promise<{done:boolean;state:string;delayMs?:number}>{
    const payout=await this.db.payout.findUniqueOrThrow({where:{id:work.payoutId},include:{campaign:true,attempts:{orderBy:{attemptNo:'desc'},take:1},reservations:{orderBy:{createdAt:'desc'},take:1},evmFundingOperations:{orderBy:{createdAt:'desc'},take:1}}});
    if(payout.status==='SUCCESS')return{done:true,state:'SUCCESS'};
    if(payout.status==='FAILED'||payout.status==='EXPIRED')return{done:false,state:payout.status,delayMs:300_000};
    let attempt=payout.attempts[0];
    if(!attempt){
      const request=quoteRequest(work.payload);
      await this.orchestrator.createCommittedQuote(payout.id,request,`work:${work.id}`,this.sourceChain);
      return{done:false,state:'QUOTED'};
    }
    if(attempt.inputAssetId!==payout.campaign.assetId||attempt.outputAmount!==payout.promisedAmount||requestRecipient(work.payload)!==payout.recipientAddress)throw new Error('Persisted quote attempt no longer matches campaign payout');
    if(!attempt.quoteId||!attempt.depositAddress||!attempt.expiresAt||attempt.expiresAt<=this.now()||attempt.timeWhenInactive&&attempt.timeWhenInactive<=this.now()){
      if(!payout.reservations.some(r=>r.status==='ACTIVE')){
        await this.db.$transaction(async tx=>{await tx.attempt.update({where:{id:attempt!.id},data:{status:'EXPIRED'}});await tx.payout.update({where:{id:payout.id},data:{status:'EXPIRED'}});await tx.payoutEvent.create({data:{payoutId:payout.id,fromStatus:payout.status,toStatus:'EXPIRED',note:'Quote expired before reservation or funding',providerRef:attempt!.quoteId}});});
        return{done:false,state:'EXPIRED',delayMs:300_000};
      }
      throw new Error('Quote expired while financial exposure remains; manual reconciliation required');
    }
    if(attempt.depositMemo!==null)throw new Error('Provider quote requires a memo that the EVM ERC-20 transfer adapter cannot encode');
    if(!payout.reservations.length){
      await this.orchestrator.reserve(payout.id,`${payout.id}:reservation:${attempt.attemptNo}`);
      return{done:false,state:'RESERVED'};
    }
    const reservation=payout.reservations[0]!;
    if(reservation.status!=='ACTIVE'||reservation.remainingAmount!==reservation.amount)throw new Error('Payout reservation is not active at its original authorized amount');
    let funding=payout.evmFundingOperations[0];
    if(!funding){
      await this.funding.authorizeAndSubmit({reservationId:reservation.id,idempotencyKey:`evm:${attempt.id}`});
      if(payout.status==='RESERVED')await this.transitionToCommitted(payout.id,attempt.quoteId);
      return{done:false,state:'FUNDING_SUBMITTED'};
    }
    if(funding.attemptId!==attempt.id||funding.quoteId!==attempt.quoteId||funding.reservationId!==reservation.id||funding.tokenAmount!==reservation.amount)throw new Error('Funding operation does not match the active payout attempt and quote');
    if(payout.status==='RESERVED')await this.transitionToCommitted(payout.id,attempt.quoteId);
    if(funding.state==='CONFIRMED'&&payout.status==='COMMITTED')await this.transition(payout.id,'COMMITTED','AWAITING_DEPOSIT','Source-chain transfer independently confirmed; waiting for provider observation',attempt.quoteId,funding.txHash);
    if(funding.state!=='CONFIRMED'){
      const result=await this.funding.reconcile(funding.id);
      if(result.state!=='CONFIRMED')return{done:false,state:`FUNDING_${result.state}`,delayMs:1_000};
      funding=await this.db.evmFundingOperation.findUniqueOrThrow({where:{id:funding.id}});
      const current=await this.db.payout.findUniqueOrThrow({where:{id:payout.id}});
      if(current.status==='COMMITTED')await this.transition(payout.id,current.status,'AWAITING_DEPOSIT','Source-chain transfer independently confirmed; waiting for provider observation',attempt.quoteId,funding.txHash);
      return{done:false,state:'SOURCE_CONFIRMED'};
    }
    const status=await this.provider.status(attempt.depositAddress,attempt.depositMemo);
    let evidence;
    if(status.status==='SUCCESS'){
      if(!this.outputVerifier){await this.markOutputPending(payout.id);await this.settlement.apply(payout.id,status);return{done:false,state:'OUTPUT_UNVERIFIED',delayMs:5_000};}
      try{evidence=await this.outputVerifier.verify({chain:payout.outputChain,assetId:payout.outputAssetId,recipient:payout.recipientAddress,amount:payout.promisedAmount,provider:status});}
      catch(error){
        const message=error instanceof Error?error.message:'Output proof unavailable';
        const pending=/confirmation depth|not found|timeout|temporar/i.test(message);
        await this.markOutputState(payout.id,pending?'PENDING':'MISMATCH');
        await this.settlement.apply(payout.id,status);
        if(!pending)throw new Error(`Recipient output evidence mismatch: ${message}`);
        return{done:false,state:'OUTPUT_UNVERIFIED',delayMs:2_000};
      }
    }
    await this.settlement.apply(payout.id,status,evidence);
    const updated=await this.db.payout.findUniqueOrThrow({where:{id:payout.id}});
    if(updated.status==='SUCCESS'&&updated.recipientOutputState==='VERIFIED')return{done:true,state:'SUCCESS'};
    if(['FAILED','REFUNDED'].includes(status.status))throw new Error(`Provider reached ${status.status}; exposure requires independent refund/no-spend reconciliation`);
    return{done:false,state:updated.status,delayMs:2_000};
  }

  private async transition(payoutId:string,from:string,to:'AWAITING_DEPOSIT',note:string,providerRef:string,txHash:string|null):Promise<void>{
    await this.db.$transaction(async tx=>{const current=await tx.payout.findUniqueOrThrow({where:{id:payoutId}});if(current.status!==from)return;await tx.payout.update({where:{id:payoutId},data:{status:to}});await tx.payoutEvent.create({data:{payoutId,fromStatus:from as never,toStatus:to,note,providerRef,txHash}});});
  }
  private async transitionToCommitted(payoutId:string,providerRef:string):Promise<void>{await this.db.$transaction(async tx=>{const p=await tx.payout.findUniqueOrThrow({where:{id:payoutId}});if(p.status!=='RESERVED')return;await tx.payout.update({where:{id:payoutId},data:{status:'COMMITTED'}});await tx.payoutEvent.create({data:{payoutId,fromStatus:'RESERVED',toStatus:'COMMITTED',note:'Funding operation authorized and persisted',providerRef}});});}
  private async markOutputPending(payoutId:string):Promise<void>{await this.markOutputState(payoutId,'PENDING');}
  private async markOutputState(payoutId:string,state:'PENDING'|'MISMATCH'):Promise<void>{await this.db.payout.update({where:{id:payoutId},data:{recipientOutputState:state}});}
  private async finish(work:ClaimedWork):Promise<void>{await this.db.payoutWorkItem.updateMany({where:{id:work.id,state:'LEASED',lockToken:work.lockToken},data:{state:'DONE',leaseUntil:null,lockToken:null,lastError:null}});}
  private async reschedule(work:ClaimedWork,delayMs:number,error?:string):Promise<void>{await this.db.payoutWorkItem.updateMany({where:{id:work.id,state:'LEASED',lockToken:work.lockToken},data:{state:'READY',availableAt:new Date(this.now().getTime()+delayMs),leaseUntil:null,lockToken:null,lastError:error??null}});}
  private async manualReview(work:ClaimedWork,error:string):Promise<void>{await this.db.payoutWorkItem.updateMany({where:{id:work.id,state:'LEASED',lockToken:work.lockToken},data:{state:'MANUAL_REVIEW',leaseUntil:null,lockToken:null,lastError:error}});await this.markPayoutManual(work.payoutId,error);}
  private async markPayoutManual(payoutId:string,error:string):Promise<void>{await this.db.$transaction(async tx=>{const p=await tx.payout.findUnique({where:{id:payoutId}});if(!p)return;await tx.payout.update({where:{id:payoutId},data:{recipientOutputState:'MANUAL_REVIEW',...(p.status!=='SUCCESS'&&p.status!=='UNKNOWN'?{status:'UNKNOWN'}:{})}});if(p.status!=='SUCCESS'&&p.status!=='UNKNOWN')await tx.payoutEvent.create({data:{payoutId,fromStatus:p.status,toStatus:'UNKNOWN',note:`Worker stopped after bounded retries: ${error.slice(0,300)}`}});});}
}

function requestRecipient(payload:Prisma.JsonValue):string {return String((payload as Record<string,unknown>).recipient??'');}
