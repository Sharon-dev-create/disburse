import { Prisma, PrismaClient, type PayoutStatus } from '@prisma/client';
import type { StatusResult } from '../intents/provider.interface.js';
import { reconcile } from './recovery.service.js';
import { canTransition, assertTransition, type PayoutStatus as DomainStatus } from '../domain/payout.js';

/** Applies provider snapshots atomically. Ledger amounts are positive cumulative deltas per attempt. */
export class SettlementService {
  constructor(private readonly db:PrismaClient,private readonly now:()=>Date=()=>new Date()){}
  private async serializable<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
    for(let attempt=0;attempt<10;attempt++){
      try{return await this.db.$transaction(work,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
      catch(error){
        const metaCode=error instanceof Prisma.PrismaClientKnownRequestError?String(error.meta?.code??''):'';
        const message=error instanceof Error?error.message:'';
        const retryable=error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2034'||error.code==='P2010'&&['40001','40P01'].includes(metaCode))||/could not serialize access|deadlock detected/i.test(message);
        if(!retryable||attempt===9)throw error;
        await new Promise(resolve=>setTimeout(resolve,Math.min(20*(attempt+1),200)));
      }
    }
    throw new Error('Serializable transaction retry exhausted');
  }
  async apply(payoutId:string,result:StatusResult):Promise<void>{
    await this.serializable(async tx=>{
      const ownership=await tx.payout.findUniqueOrThrow({where:{id:payoutId},select:{campaignId:true}});
      await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id"=${ownership.campaignId} FOR UPDATE`;
      const payout=await tx.payout.findUniqueOrThrow({where:{id:payoutId},include:{attempts:{orderBy:{attemptNo:'desc'},take:1}}});
      const attempt=payout.attempts[0];if(!attempt?.quoteId||!attempt.maxAmountIn||!attempt.inputAssetId)throw new Error('Attempt missing provider quote, source asset or reserved maximum');
      if(result.refundAssetId!==attempt.inputAssetId||result.outputAssetId!==payout.outputAssetId||result.recipient!==payout.recipientAddress)throw new Error('Provider status asset or recipient does not match persisted payout');
      if(attempt.providerStatusUpdatedAt&&result.updatedAt<attempt.providerStatusUpdatedAt)return;
      if(result.depositedAmount!==undefined){
        const old=attempt.providerDepositedAmount;
        if(old!==null&&result.depositedAmount<old)throw new Error('Provider cumulative deposit decreased; manual reconciliation required');
        const prior=(await tx.ledgerEntry.aggregate({where:{attemptId:attempt.id,type:'DEPOSIT_OBSERVED'},_sum:{amount:true}}))._sum.amount??0n;
        if(result.depositedAmount<prior)throw new Error('Provider deposit snapshot is below persisted ledger total');
        const delta=result.depositedAmount-prior;
        if(delta>0n)await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,attemptId:attempt.id,type:'DEPOSIT_OBSERVED',amount:delta,assetId:attempt.inputAssetId,externalRef:`provider:${attempt.quoteId}:deposit-total:${result.depositedAmount}`}});
      }
      if(result.status==='SUCCESS'&&(result.amountOut!==payout.promisedAmount||!result.amountIn||result.amountIn>attempt.maxAmountIn||result.depositedAmount!==undefined&&result.amountIn>result.depositedAmount)||result.status==='REFUNDED'&&result.depositedAmount!==undefined&&result.refundedAmount!==undefined&&result.refundedAmount>result.depositedAmount){
        await tx.attempt.update({where:{id:attempt.id},data:{providerStatus:result.status,providerStatusUpdatedAt:result.updatedAt,...(result.depositedAmount!==undefined?{providerDepositedAmount:result.depositedAmount}:{})}});
        if(payout.status!=='UNKNOWN'&&canTransition(payout.status as DomainStatus,'UNKNOWN')){
          await tx.payout.update({where:{id:payoutId},data:{status:'UNKNOWN'}});
          await tx.payoutEvent.create({data:{payoutId,fromStatus:payout.status,toStatus:'UNKNOWN',note:'Provider success response conflicts with persisted quote; exposure retained for reconciliation',providerRef:attempt.quoteId,txHash:result.destinationTxHashes[0]??null}});
        }
        return;
      }
      const mapped=reconcile({status:payout.status as PayoutStatus,promisedOutput:payout.promisedAmount,outputAssetId:payout.outputAssetId,inputAssetId:attempt.inputAssetId,reserved:attempt.maxAmountIn},result);
      if(mapped.status==='SUCCESS'&&(!result.amountIn||result.amountIn>attempt.maxAmountIn))throw new Error('Successful settlement input is missing or exceeds persisted quote maximum');
      if(mapped.confirmedRefund!==undefined){
        const prior=(await tx.ledgerEntry.aggregate({where:{attemptId:attempt.id,type:'REFUND_CONFIRMED'},_sum:{amount:true}}))._sum.amount??0n;
        if(mapped.confirmedRefund<prior)throw new Error('Provider cumulative refund decreased; manual reconciliation required');
        const delta=mapped.confirmedRefund-prior;
        if(delta>0n)await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,attemptId:attempt.id,type:'REFUND_CONFIRMED',amount:delta,assetId:attempt.inputAssetId,externalRef:`provider:${attempt.quoteId}:refund-total:${mapped.confirmedRefund}`,metadata:{originTxHashes:result.originTxHashes}}});
      }
      await tx.attempt.update({where:{id:attempt.id},data:{providerStatus:result.status,providerStatusUpdatedAt:result.updatedAt,...(result.depositedAmount!==undefined?{providerDepositedAmount:result.depositedAmount}:{})}});

      const ext=`provider:${attempt.quoteId}:${mapped.status}`;
      const exists=await tx.ledgerEntry.findUnique({where:{externalRef:ext}});
      if(!exists){
        if(mapped.status==='SUCCESS'){
          const existing=await tx.ledgerEntry.findFirst({where:{attemptId:attempt.id,type:'SETTLEMENT_CONFIRMED'}});
          if(existing&&existing.amount!==mapped.settledInput)throw new Error('Provider settlement amount changed; manual reconciliation required');
          if(!existing)await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,attemptId:attempt.id,type:'SETTLEMENT_CONFIRMED',amount:mapped.settledInput!,assetId:attempt.inputAssetId,externalRef:ext,metadata:{txHashes:mapped.txHashes}}});
        }else if(mapped.status==='FAILED'){
          await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,attemptId:attempt.id,type:'FAILED',amount:0n,assetId:attempt.inputAssetId,externalRef:ext}});
        }
      }

      const path:DomainStatus[]=[];let cursor=payout.status as DomainStatus;
      if(cursor!==mapped.status&&!exists){
        for(let guard=0;cursor!==mapped.status&&guard<5;guard++){
          if(canTransition(cursor,mapped.status)){path.push(mapped.status);cursor=mapped.status;break;}
          const intermediate:DomainStatus|undefined=cursor==='RESERVED'?'COMMITTED':cursor==='COMMITTED'||cursor==='AWAITING_DEPOSIT'?'PROCESSING':undefined;
          if(!intermediate||!canTransition(cursor,intermediate))throw new Error(`Unsafe provider status regression ${cursor} -> ${mapped.status}`);
          assertTransition(cursor,intermediate);path.push(intermediate);cursor=intermediate;
        }
        if(cursor!==mapped.status)throw new Error(`Unable to reach provider status ${mapped.status}`);
      }

      if((mapped.status==='SUCCESS'||mapped.status==='REFUNDED')&&result.depositedAmount!==undefined){
        const deposited=(await tx.ledgerEntry.aggregate({where:{attemptId:attempt.id,type:'DEPOSIT_OBSERVED'},_sum:{amount:true}}))._sum.amount??0n;
        const settled=(await tx.ledgerEntry.aggregate({where:{attemptId:attempt.id,type:'SETTLEMENT_CONFIRMED'},_sum:{amount:true}}))._sum.amount??0n;
        const refunded=(await tx.ledgerEntry.aggregate({where:{attemptId:attempt.id,type:'REFUND_CONFIRMED'},_sum:{amount:true}}))._sum.amount??0n;
        if(settled+refunded>deposited)throw new Error('Confirmed settlement and refunds exceed authoritative deposit');
        const unresolved=deposited-settled-refunded;
        const reservation=await tx.reservation.findFirst({where:{attemptId:attempt.id,status:'ACTIVE'}});
        if(reservation&&reservation.remainingAmount>unresolved){
          const delta=reservation.remainingAmount-unresolved;
          const nextRemaining=unresolved;
          const nextStatus=nextRemaining===0n?'RELEASED':'ACTIVE';
          const changed=await tx.reservation.updateMany({where:{id:reservation.id,status:'ACTIVE',remainingAmount:reservation.remainingAmount},data:{remainingAmount:nextRemaining,status:nextStatus,...(nextStatus==='RELEASED'?{releasedAt:this.now()}:{})}});
          if(changed.count!==1)throw new Error('Reservation changed during settlement reconciliation');
          const ref=`release:${reservation.id}:remaining:${nextRemaining}`;
          await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,attemptId:attempt.id,type:'RELEASED',amount:delta,assetId:attempt.inputAssetId,externalRef:ref,reason:'Authoritative provider deposit reconciled against confirmed settlement and refunds'}});
          const update=await tx.payout.updateMany({where:{id:payoutId,activeExposure:{gte:delta}},data:{activeExposure:{decrement:delta}}});
          if(update.count!==1)throw new Error('Payout exposure is inconsistent with reservation balance');
        }
      }
      if(path.length>0)await tx.payout.update({where:{id:payoutId},data:{status:mapped.status}});
      let from=payout.status as DomainStatus;
      for(const to of path){await tx.payoutEvent.create({data:{payoutId,fromStatus:from,toStatus:to,note:`Provider status ${result.status}`,providerRef:attempt.quoteId,txHash:mapped.txHashes[0]??null}});from=to;}
    });
  }
}
