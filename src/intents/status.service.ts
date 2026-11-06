import { PrismaClient } from '@prisma/client';
import type { IntentsProvider } from './provider.interface.js';
import { SettlementService } from '../payouts/settlement.service.js';

/** Reads authoritative provider state and atomically applies it. Read/timeout errors preserve exposure and current state. */
export class StatusService {
  private readonly settlement:SettlementService;
  constructor(private readonly db:PrismaClient,private readonly provider:IntentsProvider){this.settlement=new SettlementService(db);}
  async refresh(payoutId:string):Promise<void>{
    const payout=await this.db.payout.findUniqueOrThrow({where:{id:payoutId},include:{attempts:{orderBy:{attemptNo:'desc'},take:1}}});
    const attempt=payout.attempts[0];if(!attempt?.depositAddress)throw new Error('Payout attempt has no committed deposit address');
    // A thrown timeout/status error deliberately makes no state or ledger change.
    const status=await this.provider.status(attempt.depositAddress,attempt.depositMemo);
    await this.settlement.apply(payoutId,status);
  }
  async refreshAllUnresolved():Promise<Array<{payoutId:string;error?:string}>>{
    const payouts=await this.db.payout.findMany({where:{status:{in:['RESERVED','COMMITTED','AWAITING_DEPOSIT','PROCESSING','UNKNOWN','REFUND_PENDING']}},select:{id:true}});
    const results:Array<{payoutId:string;error?:string}>=[];
    for(const p of payouts){try{await this.refresh(p.id);results.push({payoutId:p.id});}catch{results.push({payoutId:p.id,error:'Provider status unavailable or invalid; exposure retained'});}}
    return results;
  }
}
