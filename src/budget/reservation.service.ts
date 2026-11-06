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
      const [reservations,entries]=await Promise.all([
        tx.reservation.findMany({where:{campaignId,status:'ACTIVE'},select:{payoutId:true,amount:true}}),
        tx.ledgerEntry.findMany({where:{campaignId,type:{in:['DEPOSIT_OBSERVED','SETTLEMENT_CONFIRMED','REFUND_CONFIRMED']}},select:{payoutId:true,type:true,amount:true}})
      ]);
      const groups=new Map<string,{reserved:bigint;deposited:bigint;settled:bigint;refunded:bigint}>();
      const group=(key:string)=>{let g=groups.get(key);if(!g){g={reserved:0n,deposited:0n,settled:0n,refunded:0n};groups.set(key,g);}return g;};
      for(const r of reservations)group(r.payoutId??'__campaign__').reserved+=r.amount;
      for(const e of entries){const g=group(e.payoutId??'__campaign__');if(e.type==='DEPOSIT_OBSERVED')g.deposited+=e.amount;else if(e.type==='SETTLEMENT_CONFIRMED')g.settled+=e.amount;else g.refunded+=e.amount;}
      let committed=0n;
      for(const g of groups.values()){
        const gross=g.deposited>0n?g.deposited:(g.settled>g.refunded?g.settled:g.refunded);
        if(g.refunded>gross)throw new Error('Confirmed refunds exceed recorded source outflow');
        const net=gross-g.refunded;committed+=g.reserved>net?g.reserved:net;
      }
      if(committed+amount>campaign.budget)throw new Error('Reservation exceeds remaining budget after settlements and unresolved deposits');
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
