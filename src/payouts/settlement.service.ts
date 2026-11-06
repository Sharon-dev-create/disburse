import { PrismaClient, type PayoutStatus } from '@prisma/client';
import type { StatusResult } from '../intents/provider.interface.js';
import { reconcile } from './recovery.service.js';
import { canTransition, assertTransition, type PayoutStatus as DomainStatus } from '../domain/payout.js';
/** Applies authoritative provider status and ledger changes atomically. External refs make repeated polls idempotent. */
export class SettlementService {
  constructor(private readonly db:PrismaClient){}
  async apply(payoutId:string,result:StatusResult):Promise<void>{
    await this.db.$transaction(async tx=>{
      const payout=await tx.payout.findUniqueOrThrow({where:{id:payoutId},include:{attempts:{orderBy:{attemptNo:'desc'},take:1}}});
      const attempt=payout.attempts[0]; if(!attempt?.maxAmountIn||!attempt.inputAssetId) throw new Error('Attempt missing source asset or reserved maximum');
      const mapped=reconcile({status:payout.status as PayoutStatus,promisedOutput:payout.promisedAmount,outputAssetId:payout.outputAssetId,inputAssetId:attempt.inputAssetId,reserved:payout.activeExposure},result);
      const terminal=mapped.status==='SUCCESS'||mapped.status==='REFUNDED';
      const ext=`provider:${attempt.quoteId}:${mapped.status}`;
      const exists=await tx.ledgerEntry.findUnique({where:{externalRef:ext}}); if(exists)return;
      const path:DomainStatus[]=[];let cursor=payout.status as DomainStatus;
      for(let guard=0;cursor!==mapped.status&&guard<5;guard++){
        if(canTransition(cursor,mapped.status)){path.push(mapped.status);cursor=mapped.status;break;}
        const intermediate:DomainStatus|undefined=cursor==='RESERVED'?'COMMITTED':cursor==='COMMITTED'||cursor==='AWAITING_DEPOSIT'?'PROCESSING':undefined;
        if(!intermediate||!canTransition(cursor,intermediate))throw new Error(`Unsafe provider status regression ${cursor} -> ${mapped.status}`);
        assertTransition(cursor,intermediate);path.push(intermediate);cursor=intermediate;
      }
      if(cursor!==mapped.status)throw new Error(`Unable to reach provider status ${mapped.status}`);
      if(mapped.status==='SUCCESS'){
        await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,type:'SETTLEMENT_CONFIRMED',amount:mapped.settledInput!,assetId:attempt.inputAssetId,externalRef:ext,metadata:{txHashes:mapped.txHashes}}});
      } else if(mapped.status==='REFUNDED'){
        await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,type:'REFUND_CONFIRMED',amount:mapped.confirmedRefund!,assetId:attempt.inputAssetId,externalRef:ext,metadata:{txHashes:mapped.txHashes}}});
      } else if(mapped.status==='FAILED'){
        await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,type:'FAILED',amount:0n,assetId:attempt.inputAssetId,externalRef:ext}});
      }
      if(terminal){
        const active=await tx.reservation.findFirst({where:{attemptId:attempt.id,status:'ACTIVE'}});
        if(active?.status==='ACTIVE'){
          await tx.reservation.update({where:{id:active.id},data:{status:'RELEASED',releasedAt:new Date()}});
          await tx.payout.update({where:{id:payoutId},data:{activeExposure:{decrement:active.amount}}});
          await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,type:'RELEASED',amount:active.amount,assetId:attempt.inputAssetId,externalRef:`release:${active.id}`,reason:'Provider terminal result; actual expenditure/refund recorded separately'}});
        }
      }
      if(path.length>0)await tx.payout.update({where:{id:payoutId},data:{status:mapped.status}});
      let from=payout.status as DomainStatus;
      for(const to of path){await tx.payoutEvent.create({data:{payoutId,fromStatus:from,toStatus:to,note:`Provider status ${result.status}`,providerRef:attempt.quoteId,txHash:mapped.txHashes[0]??null}});from=to;}
    },{isolationLevel:'Serializable'});
  }
}
