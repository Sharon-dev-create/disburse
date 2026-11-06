import { Prisma, PrismaClient } from '@prisma/client';
import { calculateAuthorizedExposure, type ExposureEntry } from './exposure.js';

export type ReleaseEvidence =
  | {source:'PROVIDER_TERMINAL_NO_DEPOSIT';actor:string;reason:string}
  | {source:'MANUAL_RECONCILIATION';actor:string;reason:string};

export class ReservationService {
  constructor(private readonly db:PrismaClient,private readonly now:()=>Date=()=>new Date()){}

  private async serializable<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
    let last:unknown;
    for(let attempt=0;attempt<10;attempt++){
      try{return await this.db.$transaction(work,{isolationLevel:'Serializable'});}
      catch(error){
        last=error;
        const metaCode=error instanceof Prisma.PrismaClientKnownRequestError?String(error.meta?.code??''):'';
        const message=error instanceof Error?error.message:'';
        const retryable=error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2034'||error.code==='P2010'&&['40001','40P01'].includes(metaCode))||/could not serialize access|deadlock detected/i.test(message);
        if(!retryable||attempt===9)throw error;
        await new Promise(resolve=>setTimeout(resolve,Math.min(20*(attempt+1),200)));
      }
    }
    throw last;
  }

  async reserve(campaignId:string,payoutId:string,attemptId:string,reservationId:string,amount:bigint):Promise<void>{
    if(amount<=0n)throw new Error('Reservation amount must be positive');
    await this.serializable(async tx=>{
      const rows=await tx.$queryRaw<Array<{budget:bigint;assetId:string;status:string}>>`SELECT "budget", "assetId", "status" FROM "Campaign" WHERE "id"=${campaignId} FOR UPDATE`;
      const campaign=rows[0];if(!campaign||campaign.status!=='APPROVED')throw new Error('Campaign is not approved');
      const payout=await tx.payout.findUnique({where:{id:payoutId}});
      if(!payout||payout.campaignId!==campaignId)throw new Error('Payout does not belong to supplied campaign');
      if(payout.status!=='QUOTED')throw new Error('Payout is not in a reservable quoted state');
      const attempt=await tx.attempt.findUnique({where:{id:attemptId}});
      if(!attempt||attempt.payoutId!==payoutId)throw new Error('Selected attempt does not belong to payout');
      if(!['QUOTED','COMMITTED'].includes(attempt.status)||!attempt.maxAmountIn||!attempt.inputAssetId||attempt.inputAssetId!==campaign.assetId||!attempt.depositAddress||attempt.outputAmount!==payout.promisedAmount)throw new Error('Attempt is not eligible for reservation or does not match campaign denomination/payout promise');
      if(!attempt.expiresAt||attempt.expiresAt<=this.now()||attempt.timeWhenInactive&&attempt.timeWhenInactive<=this.now())throw new Error('Attempt quote has expired or is missing an expiry');
      if(amount!==attempt.maxAmountIn)throw new Error('Reservation must equal persisted quote maximum input');
      const existingById=await tx.reservation.findUnique({where:{id:reservationId}});
      if(existingById){if(existingById.campaignId===campaignId&&existingById.payoutId===payoutId&&existingById.attemptId===attemptId&&existingById.amount===amount&&existingById.status==='ACTIVE')return;throw new Error('Reservation id already exists with different or released data');}
      const activeForAttempt=await tx.reservation.findFirst({where:{attemptId,status:'ACTIVE'}});
      if(activeForAttempt)throw new Error('Attempt already has an active reservation');
      if(payout.activeExposure!==0n)throw new Error('Payout has unresolved exposure from another attempt');
      const [reservations,entries]=await Promise.all([
        tx.reservation.findMany({where:{campaignId,status:'ACTIVE'},select:{attemptId:true,payoutId:true,remainingAmount:true}}),
        tx.ledgerEntry.findMany({where:{campaignId,type:{in:['DEPOSIT_OBSERVED','SETTLEMENT_CONFIRMED','REFUND_CONFIRMED']}},select:{attemptId:true,payoutId:true,type:true,amount:true}})
      ]);
      const committed=calculateAuthorizedExposure(reservations,entries as ExposureEntry[]);
      if(committed+amount>campaign.budget)throw new Error('Reservation exceeds remaining approved campaign budget');
      await tx.reservation.create({data:{id:reservationId,campaignId,payoutId,attemptId,amount,remainingAmount:amount,status:'ACTIVE'}});
      await tx.ledgerEntry.create({data:{campaignId,payoutId,attemptId,type:'RESERVED',amount,assetId:campaign.assetId,externalRef:`reserve:${reservationId}`}});
      await tx.payout.update({where:{id:payoutId},data:{activeExposure:{increment:amount},status:'RESERVED'}});
      await tx.payoutEvent.create({data:{payoutId,fromStatus:payout.status,toStatus:'RESERVED',note:'Persisted quote maximum input reserved'}});
    });
  }

  async release(reservationId:string,evidence:ReleaseEvidence):Promise<void>{
    if(!evidence.actor.trim()||evidence.reason.trim().length<12)throw new Error('Release requires an auditable actor and reason');
    await this.serializable(async tx=>{
      const initial=await tx.reservation.findUnique({where:{id:reservationId}});if(!initial)return;
      await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id"=${initial.campaignId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id"=${reservationId} FOR UPDATE`;
      const r=await tx.reservation.findUnique({where:{id:reservationId}});if(!r||r.status!=='ACTIVE'||r.remainingAmount===0n)return;
      let payout=null;
      if(r.payoutId){payout=await tx.payout.findUnique({where:{id:r.payoutId}});if(!payout||payout.campaignId!==r.campaignId)throw new Error('Reservation payout/campaign ownership mismatch');}
      if(evidence.source==='PROVIDER_TERMINAL_NO_DEPOSIT'){
        if(!r.attemptId||!payout)throw new Error('Provider evidence cannot release campaign-level reservations');
        const attempt=await tx.attempt.findUnique({where:{id:r.attemptId}});
        if(!attempt||attempt.payoutId!==payout.id||!['FAILED','INCOMPLETE_DEPOSIT'].includes(attempt.providerStatus??'')||attempt.providerDepositedAmount!==0n||!['FAILED','EXPIRED'].includes(payout.status))throw new Error('Authoritative terminal no-deposit evidence is not present');
      }
      const releaseAmount=r.remainingAmount;
      const changed=await tx.reservation.updateMany({where:{id:reservationId,status:'ACTIVE',remainingAmount:releaseAmount},data:{status:'RELEASED',remainingAmount:0n,releasedAt:this.now()}});
      if(changed.count===0)return;
      const campaign=await tx.campaign.findUniqueOrThrow({where:{id:r.campaignId}});
      await tx.ledgerEntry.create({data:{campaignId:r.campaignId,payoutId:r.payoutId,attemptId:r.attemptId,type:'RELEASED',amount:releaseAmount,assetId:campaign.assetId,externalRef:`release:${reservationId}`,reason:evidence.reason,metadata:{actor:evidence.actor,source:evidence.source}}});
      if(r.payoutId){
        const updated=await tx.payout.updateMany({where:{id:r.payoutId,activeExposure:{gte:releaseAmount}},data:{activeExposure:{decrement:releaseAmount}}});
        if(updated.count!==1)throw new Error('Payout exposure is inconsistent with active reservation');
      }
    });
  }
}
