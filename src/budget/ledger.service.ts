export interface LedgerLine { type:'APPROVED'|'RESERVED'|'RELEASED'|'DEPOSITED'|'SETTLED'|'REFUND_PENDING'|'REFUNDED'|'FAILED'|'ADJUSTMENT'; amount:bigint; reference:string; confirmed:boolean; direction?:'IN'|'OUT' }
export interface Balances { approved:bigint; reserved:bigint; deposited:bigint; settled:bigint; refunded:bigint; unresolved:bigint; available:bigint }
export function balances(lines:LedgerLine[]):Balances {
  const sum=(...types:LedgerLine['type'][])=>(lines.filter(l=>types.includes(l.type)&&l.confirmed).reduce((s,l)=>s+l.amount,0n));
  const approved=sum('APPROVED')+lines.filter(l=>l.type==='ADJUSTMENT'&&l.confirmed&&l.direction!=='OUT').reduce((s,l)=>s+l.amount,0n)-lines.filter(l=>l.type==='ADJUSTMENT'&&l.confirmed&&l.direction==='OUT').reduce((s,l)=>s+l.amount,0n);
  const reserved=sum('RESERVED')-sum('RELEASED');
  const deposited=sum('DEPOSITED'); const settled=sum('SETTLED'); const refunded=sum('REFUNDED');
  const observedResidual=deposited-settled-refunded;
  // During execution the active reservation and observed deposit describe overlapping exposure; retain the larger.
  const unresolved=reserved>observedResidual?reserved:observedResidual;
  const available=approved-reserved-settled+refunded;
  if(approved<=0n||reserved<0n||available<0n||unresolved<0n)throw new Error('Ledger does not reconcile');
  return {approved,reserved,deposited,settled,refunded,unresolved,available};
}

import { PrismaClient } from '@prisma/client';
export class LedgerService {
  constructor(private readonly db:PrismaClient){}
  async manualAdjustment(args:{campaignId:string;amount:bigint;direction:'IN'|'OUT';reason:string;actor:string;externalRef:string}):Promise<void>{
    if(args.amount<=0n||args.reason.trim().length<12||!args.actor.trim()||!args.externalRef.trim())throw new Error('Adjustment amount, audit reason, actor, and reference are required');
    await this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{budget:bigint;assetId:string}>>`SELECT "budget", "assetId" FROM "Campaign" WHERE "id"=${args.campaignId} FOR UPDATE`;
      const c=rows[0];if(!c)throw new Error('Campaign not found');
      const active=await tx.reservation.aggregate({where:{campaignId:args.campaignId,status:'ACTIVE'},_sum:{amount:true}});
      const spent=await tx.ledgerEntry.aggregate({where:{campaignId:args.campaignId,type:'SETTLEMENT_CONFIRMED'},_sum:{amount:true}});
      const refunds=await tx.ledgerEntry.aggregate({where:{campaignId:args.campaignId,type:'REFUND_CONFIRMED'},_sum:{amount:true}});
      if((refunds._sum.amount??0n)>(spent._sum.amount??0n))throw new Error('Confirmed refunds exceed recorded settlement expenditure');
      const delta=args.direction==='IN'?args.amount:-args.amount;
      const next=c.budget+delta;
      const committed=(active._sum.amount??0n)+(spent._sum.amount??0n)-(refunds._sum.amount??0n);
      if(next<=0n||next<committed)throw new Error('Adjustment would put approved budget below authorized exposure');
      await tx.campaign.update({where:{id:args.campaignId},data:{budget:next}});
      await tx.ledgerEntry.create({data:{campaignId:args.campaignId,type:'ADJUSTMENT',amount:args.amount,direction:args.direction,assetId:c.assetId,externalRef:args.externalRef,reason:args.reason,metadata:{actor:args.actor}}});
    },{isolationLevel:'Serializable'});
  }
}
