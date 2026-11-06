import { PrismaClient } from '@prisma/client';

/** PostgreSQL serializable transaction. DB uniqueness plus locked aggregate check is the concurrency boundary. */
export class ReservationService {
  constructor(private readonly db:PrismaClient){}
  async reserve(campaignId:string,payoutId:string,reservationId:string,amount:bigint):Promise<void>{
    if(amount<=0n)throw new Error('Reservation amount must be positive');
    await this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{budget:bigint;assetId:string;status:string}>>`SELECT "budget", "assetId", "status" FROM "Campaign" WHERE "id"=${campaignId} FOR UPDATE`;
      const campaign=rows[0]; if(!campaign||campaign.status!=='APPROVED')throw new Error('Campaign is not approved');
      const totals=await tx.reservation.aggregate({where:{campaignId,status:'ACTIVE'},_sum:{amount:true}});
      const active=totals._sum.amount??0n; if(active+amount>campaign.budget)throw new Error('Insufficient campaign budget');
      await tx.reservation.create({data:{id:reservationId,campaignId,payoutId,amount,status:'ACTIVE'}});
      await tx.ledgerEntry.create({data:{campaignId,payoutId,type:'RESERVED',amount,assetId:campaign.assetId,externalRef:`reserve:${reservationId}`}});
      await tx.payout.update({where:{id:payoutId},data:{activeExposure:amount,status:'RESERVED'}});
      await tx.payoutEvent.create({data:{payoutId,fromStatus:'QUOTED',toStatus:'RESERVED',note:'Maximum input reserved'}});
    },{isolationLevel:'Serializable'});
  }
  async release(reservationId:string,reason:string):Promise<void>{
    await this.db.$transaction(async tx=>{
      const r=await tx.reservation.findUnique({where:{id:reservationId}}); if(!r||r.status!=='ACTIVE')return;
      await tx.reservation.update({where:{id:reservationId},data:{status:'RELEASED',releasedAt:new Date()}});
      const campaign=await tx.campaign.findUniqueOrThrow({where:{id:r.campaignId}});
      await tx.ledgerEntry.create({data:{campaignId:r.campaignId,payoutId:r.payoutId,type:'RELEASED',amount:r.amount,assetId:campaign.assetId,externalRef:`release:${reservationId}`,reason}});
      await tx.payout.update({where:{id:r.payoutId},data:{activeExposure:0n}});
    },{isolationLevel:'Serializable'});
  }
}
