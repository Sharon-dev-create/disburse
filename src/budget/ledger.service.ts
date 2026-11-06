export interface LedgerLine { type:'APPROVED'|'RESERVED'|'RELEASED'|'DEPOSITED'|'DEPOSIT_REVERSED'|'SETTLED'|'REFUND_PENDING'|'REFUNDED'|'FAILED'|'ADJUSTMENT'; amount:bigint; reference:string; confirmed:boolean; direction?:'IN'|'OUT'; payoutId?:string; attemptId?:string }
export interface Balances { approved:bigint; reserved:bigint; deposited:bigint; settled:bigint; refunded:bigint; unresolved:bigint; available:bigint }
export function balances(lines:LedgerLine[]):Balances {
  const sum=(...types:LedgerLine['type'][])=>(lines.filter(l=>types.includes(l.type)&&l.confirmed).reduce((s,l)=>s+l.amount,0n));
  const approved=sum('APPROVED')+lines.filter(l=>l.type==='ADJUSTMENT'&&l.confirmed&&l.direction!=='OUT').reduce((s,l)=>s+l.amount,0n)-lines.filter(l=>l.type==='ADJUSTMENT'&&l.confirmed&&l.direction==='OUT').reduce((s,l)=>s+l.amount,0n);
  const groups=new Map<string,{reserved:bigint;deposited:bigint;reversed:bigint;settled:bigint;refunded:bigint;hasDeposit:boolean}>();
  const group=(id:string)=>{let g=groups.get(id);if(!g){g={reserved:0n,deposited:0n,reversed:0n,settled:0n,refunded:0n,hasDeposit:false};groups.set(id,g);}return g;};
  for(const l of lines){if(!l.confirmed)continue;const g=group(l.attemptId??l.payoutId??'__campaign__');if(l.type==='RESERVED')g.reserved+=l.amount;else if(l.type==='RELEASED')g.reserved-=l.amount;else if(l.type==='DEPOSITED'){g.deposited+=l.amount;g.hasDeposit=true;}else if(l.type==='DEPOSIT_REVERSED')g.reversed+=l.amount;else if(l.type==='SETTLED')g.settled+=l.amount;else if(l.type==='REFUNDED')g.refunded+=l.amount;}
  let reserved=0n,deposited=0n,settled=0n,refunded=0n,exposure=0n,unresolved=0n;
  for(const g of groups.values()){
    if(g.reversed>g.deposited)throw new Error('Reversed deposits exceed observed deposits');
    const netDeposit=g.deposited-g.reversed;const gross=g.hasDeposit?netDeposit:(g.settled>g.refunded?g.settled:g.refunded);const net=gross-g.refunded;
    if(g.reserved<0n||net<0n)throw new Error('Confirmed release or refund exceeds its recorded exposure');
    const payoutExposure=g.reserved>net?g.reserved:net;reserved+=g.reserved;deposited+=g.deposited;settled+=g.settled;refunded+=g.refunded;exposure+=payoutExposure;
    unresolved+=payoutExposure>g.settled?payoutExposure-g.settled:0n;
  }
  const available=approved-exposure;
  if(approved<=0n||available<0n||unresolved<0n)throw new Error('Ledger does not reconcile');
  return {approved,reserved,deposited,settled,refunded,unresolved,available};
}

import { PrismaClient } from '@prisma/client';
import { calculateAuthorizedExposure, type ExposureEntry } from './exposure.js';
export class LedgerService {
  constructor(private readonly db:PrismaClient){}
  async manualAdjustment(args:{campaignId:string;amount:bigint;direction:'IN'|'OUT';reason:string;actor:string;externalRef:string}):Promise<void>{
    if(args.amount<=0n||args.reason.trim().length<12||!args.actor.trim()||!args.externalRef.trim())throw new Error('Adjustment amount, audit reason, actor, and reference are required');
    await this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{budget:bigint;assetId:string}>>`SELECT "budget", "assetId" FROM "Campaign" WHERE "id"=${args.campaignId} FOR UPDATE`;
      const c=rows[0];if(!c)throw new Error('Campaign not found');
      const [active,entries]=await Promise.all([
        tx.reservation.findMany({where:{campaignId:args.campaignId,status:'ACTIVE'},select:{attemptId:true,payoutId:true,remainingAmount:true}}),
        tx.ledgerEntry.findMany({where:{campaignId:args.campaignId,type:{in:['DEPOSIT_OBSERVED','DEPOSIT_REVERSED','SETTLEMENT_CONFIRMED','REFUND_CONFIRMED']}},select:{attemptId:true,payoutId:true,type:true,amount:true}})
      ]);
      const delta=args.direction==='IN'?args.amount:-args.amount;
      const next=c.budget+delta;
      const committed=calculateAuthorizedExposure(active,entries as ExposureEntry[]);
      if(next<=0n||next<committed)throw new Error('Adjustment would put approved budget below authorized exposure');
      await tx.campaign.update({where:{id:args.campaignId},data:{budget:next}});
      await tx.ledgerEntry.create({data:{campaignId:args.campaignId,type:'ADJUSTMENT',amount:args.amount,direction:args.direction,assetId:c.assetId,externalRef:args.externalRef,reason:args.reason,metadata:{actor:args.actor}}});
    },{isolationLevel:'Serializable'});
  }
}
