import { PrismaClient } from '@prisma/client';

/** PostgreSQL serializable transaction. DB uniqueness plus locked aggregate check is the concurrency boundary. */
export class ReservationService {
  constructor(private readonly db:PrismaClient){}
  async reserve(campaignId:string,payoutId:string,reservationId:string,amount:bigint):Promise<void>{
    if(amount<=0n)throw new Error('Reservation amount must be positive');
    await this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{budget:bigint;assetId:string;status:string}>>`SELECT "budget", "assetId", "status" FROM "Campaign" WHERE "id"=${campaignId} FOR UPDATE`;
      const campaign=rows[0]; if(!campaign||campaign.status!=='APPROVED')throw new Error('Campaign is not approved');
      const attempt=await tx.attempt.findFirst({where:{payoutId},orderBy:{attemptNo:'desc'}}); if(!attempt)throw new Error('Payout has no persisted quote attempt');
      const existing=await tx.reservation.findFirst({where:{attemptId:attempt.id,status:'ACTIVE'}}); if(existing)throw new Error('Attempt already has an active reservation');
      const totals=await tx.reservation.aggregate({where:{campaignId,status:'ACTIVE'},_sum:{amount:true}});
      const active=totals._sum.amount??0n; if(active+amount>campaign.budget)throw new Error('Insufficient campaign budget');
      const [spent,refunds]=await Promise.all([
        tx.ledgerEntry.aggregate({where:{campaignId,type:'SETTLEMENT_CONFIRMED'},_sum:{amount:true}}),
        tx.ledgerEntry.aggregate({where:{campaignId,type:'REFUND_CONFIRMED'},_sum:{amount:true}})
      ]);
      const netSpent=(spent._sum.amount??0n)-(refunds._sum.amount??0n);
      if(netSpent<0n)throw new Error('Confirmed refunds exceed recorded settlement expenditure');
      if(active+netSpent+amount>campaign.budget)throw new Error('Reservation exceeds remaining budget after settlements');
      await tx.reservation.create({data:{id:reservationId,campaignId,payoutId,attemptId:attempt.id,amount,status:'ACTIVE'}});
      await tx.ledgerEntry.create({data:{campaignId,payoutId,type:'RESERVED',amount,assetId:campaign.assetId,externalRef:`reserve:${reservationId}`}});
      await tx.payout.update({where:{id:payoutId},data:{activeExposure:{increment:amount},status:'RESERVED'}});
      await tx.payoutEvent.create({data:{payoutId,fromStatus:'QUOTED',toStatus:'RESERVED',note:'Maximum input reserved'}});
    },{isolationLevel:'Serializable'});
  }
  async release(reservationId:string,reason:string,evidence:'PROVIDER_TERMINAL_NO_DEPOSIT'|'MANUAL_RECONCILIATION'):Promise<void>{
    await this.db.$transaction(async tx=>{
      const r=await tx.reservation.findUnique({where:{id:reservationId}}); if(!r||r.status!=='ACTIVE')return;
      if(!r.payoutId)throw new Error('Campaign-level fee reservations require manual reconciliation');
      const payout=await tx.payout.findUniqueOrThrow({where:{id:r.payoutId}});
      const deposits=await tx.ledgerEntry.count({where:{payoutId:r.payoutId,type:'DEPOSIT_OBSERVED'}});
      if(evidence==='PROVIDER_TERMINAL_NO_DEPOSIT'&&(!['FAILED','EXPIRED'].includes(payout.status)||deposits>0))throw new Error('Provider terminal no-deposit evidence required before release');
      if(evidence==='MANUAL_RECONCILIATION'&&reason.trim().length<12)throw new Error('Manual release requires an audited reason');
      await tx.reservation.update({where:{id:reservationId},data:{status:'RELEASED',releasedAt:new Date()}});
      const campaign=await tx.campaign.findUniqueOrThrow({where:{id:r.campaignId}});
      await tx.ledgerEntry.create({data:{campaignId:r.campaignId,payoutId:r.payoutId,type:'RELEASED',amount:r.amount,assetId:campaign.assetId,externalRef:`release:${reservationId}`,reason}});
      await tx.payout.update({where:{id:r.payoutId},data:{activeExposure:{decrement:r.amount}}});
    },{isolationLevel:'Serializable'});
  }
}
