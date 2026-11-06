import { PrismaClient, type PayoutStatus } from '@prisma/client';
import type { StatusResult } from '../intents/provider.interface.js';
import { reconcile } from './recovery.service.js';
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
      if(mapped.status==='SUCCESS'){
        await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,type:'SETTLEMENT_CONFIRMED',amount:mapped.settledInput!,assetId:attempt.inputAssetId,externalRef:ext,metadata:{txHashes:mapped.txHashes}}});
      } else if(mapped.status==='REFUNDED'){
        await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,type:'REFUND_CONFIRMED',amount:mapped.confirmedRefund!,assetId:attempt.inputAssetId,externalRef:ext,metadata:{txHashes:mapped.txHashes}}});
      } else if(mapped.status==='FAILED'){
        await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,type:'FAILED',amount:0n,assetId:attempt.inputAssetId,externalRef:ext}});
      }
      if(terminal){
        const active=await tx.reservation.findUnique({where:{payoutId}});
        if(active?.status==='ACTIVE'){
          await tx.reservation.update({where:{payoutId},data:{status:'RELEASED',releasedAt:new Date()}});
          await tx.ledgerEntry.create({data:{campaignId:payout.campaignId,payoutId,type:'RELEASED',amount:active.amount,assetId:attempt.inputAssetId,externalRef:`release:${active.id}`,reason:'Provider terminal result; actual expenditure/refund recorded separately'}});
        }
      }
      await tx.payout.update({where:{id:payoutId},data:{status:mapped.status,activeExposure:terminal?0n:payout.activeExposure}});
      await tx.payoutEvent.create({data:{payoutId,fromStatus:payout.status,toStatus:mapped.status,note:`Provider status ${result.status}`,providerRef:attempt.quoteId,txHash:mapped.txHashes[0]??null}});
    },{isolationLevel:'Serializable'});
  }
}
