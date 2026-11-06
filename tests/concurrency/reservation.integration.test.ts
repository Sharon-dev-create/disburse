import 'dotenv/config';
import { beforeAll,afterAll,beforeEach,afterEach,it,expect,describe } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ReservationService } from '../../src/budget/reservation.service.js';
import { SettlementService } from '../../src/payouts/settlement.service.js';

describe('PostgreSQL financial integrity',()=>{
  const db=new PrismaClient();
  const reservations=new ReservationService(db);
  const settlements=new SettlementService(db);
  let seq=0;
  let campaignIds:string[]=[];
  let fixture:{id:string;payoutIds:string[];attemptIds:string[]};
  const makeFixture=async(count=2,budget=100n,each=70n)=>{
    const id=`financial-${Date.now()}-${++seq}`;
    const payoutIds=Array.from({length:count},(_,i)=>`${id}:p${i}`);
    const attemptIds=payoutIds.map((p,i)=>`${p}:a${i}`);
    campaignIds.push(id);
    await db.campaign.create({data:{id,idempotencyKey:id,budget,assetId:'usdc:test',decimals:6,status:'APPROVED',payouts:{create:payoutIds.map((p,i)=>({id:p,recipientId:`r${i}`,recipientAddress:`addr-${i}`,promisedAmount:1n,outputAssetId:'out:test',outputChain:'test',status:'QUOTED',attempts:{create:{id:attemptIds[i]!,attemptNo:1,quoteId:`${p}:quote`,maxAmountIn:each,inputAssetId:'usdc:test',expiresAt:new Date(Date.now()+60_000),timeWhenInactive:new Date(Date.now()+50_000),depositAddress:`deposit-${i}`,status:'QUOTED'}}}))}}});
    return {id,payoutIds,attemptIds};
  };
  const reserve=async(index:number,amount=70n,reservationId=`${fixture.id}:res${index}`)=>reservations.reserve(fixture.id,fixture.payoutIds[index]!,fixture.attemptIds[index]!,reservationId,amount);
  beforeAll(async()=>{if(!process.env.DATABASE_URL)throw new Error('PostgreSQL integration tests require DATABASE_URL');await db.$connect();});
  beforeEach(async()=>{campaignIds=[];fixture=await makeFixture();});
  afterEach(async()=>{
    for(const id of campaignIds){
      await db.ledgerEntry.deleteMany({where:{campaignId:id}});
      await db.payoutEvent.deleteMany({where:{payout:{campaignId:id}}});
      await db.reservation.deleteMany({where:{campaignId:id}});
      await db.attempt.deleteMany({where:{payout:{campaignId:id}}});
      await db.payout.deleteMany({where:{campaignId:id}});
      await db.campaign.deleteMany({where:{id}});
    }
  });
  afterAll(async()=>db.$disconnect());

  it('allows only one of two concurrent 70-unit reservations against 100',async()=>{
    const results=await Promise.allSettled([reserve(0),reserve(1,70n,`${fixture.id}:res1`)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const rows=await db.reservation.findMany({where:{campaignId:fixture.id,status:'ACTIVE'}});
    expect(rows.reduce((sum,r)=>sum+r.remainingAmount,0n)).toBe(70n);
  });

  it('rejects simultaneous reservations whose combined amount exceeds budget',async()=>{
    fixture=await makeFixture(3,100n,40n);
    const outcomes=await Promise.allSettled([reserve(0,40n),reserve(1,40n),reserve(2,40n)]);
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(2);
    expect((await db.reservation.aggregate({where:{campaignId:fixture.id,status:'ACTIVE'},_sum:{remainingAmount:true}}))._sum.remainingAmount).toBe(80n);
  });

  it('rejects a payout belonging to a different campaign',async()=>{
    const other=await makeFixture(1,100n,70n);
    await expect(reservations.reserve(fixture.id,other.payoutIds[0]!,other.attemptIds[0]!,`${fixture.id}:bad`,70n)).rejects.toThrow(/does not belong/);
  });

  it('rejects an attempt belonging to a different payout',async()=>{
    await expect(reservations.reserve(fixture.id,fixture.payoutIds[0]!,fixture.attemptIds[1]!,`${fixture.id}:bad`,70n)).rejects.toThrow(/does not belong/);
  });

  it('requires reservation to equal the persisted quote maximum',async()=>{
    await expect(reserve(0,69n)).rejects.toThrow(/must equal/);
    await expect(reserve(0,71n)).rejects.toThrow(/must equal/);
    await expect(reserve(0,0n)).rejects.toThrow(/positive/);
  });

  it('rejects expired attempts',async()=>{
    await db.attempt.update({where:{id:fixture.attemptIds[0]!},data:{expiresAt:new Date(Date.now()-1)}});
    await expect(reserve(0)).rejects.toThrow(/expired/);
  });

  it('concurrent and repeated release calls decrement exposure exactly once',async()=>{
    await reserve(0);
    const evidence={source:'MANUAL_RECONCILIATION' as const,actor:'integration-test',reason:'Verified no remaining funds in the controlled fixture'};
    await Promise.all([reservations.release(`${fixture.id}:res0`,evidence),reservations.release(`${fixture.id}:res0`,evidence)]);
    await reservations.release(`${fixture.id}:res0`,evidence);
    const payout=await db.payout.findUniqueOrThrow({where:{id:fixture.payoutIds[0]!}});
    const row=await db.reservation.findUniqueOrThrow({where:{id:`${fixture.id}:res0`}});
    expect(payout.activeExposure).toBe(0n);
    expect(row.status).toBe('RELEASED');
    expect(row.remainingAmount).toBe(0n);
    expect(await db.ledgerEntry.count({where:{externalRef:`release:${fixture.id}:res0`}})).toBe(1);
  });

  it('safely serializes many simultaneous reservations at the exact budget limit',async()=>{
    fixture=await makeFixture(10,100n,10n);
    const outcomes=await Promise.allSettled(fixture.payoutIds.map((_,i)=>reserve(i,10n,`${fixture.id}:r${i}`)));
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(10);
    expect((await db.reservation.aggregate({where:{campaignId:fixture.id,status:'ACTIVE'},_sum:{remainingAmount:true}}))._sum.remainingAmount).toBe(100n);
    expect(await db.ledgerEntry.count({where:{campaignId:fixture.id,type:'RESERVED'}})).toBe(10);
  });

  it('does not double-count a deposit when it becomes a settlement',async()=>{
    await reserve(0);
    await settlements.apply(fixture.payoutIds[0]!,{status:'SUCCESS',updatedAt:new Date(),amountIn:50n,amountOut:1n,depositedAmount:70n,refundAssetId:'usdc:test',outputAssetId:'out:test',recipient:'addr-0',originTxHashes:['origin'],destinationTxHashes:['destination'],rawSanitized:{}});
    const reservation=await db.reservation.findUniqueOrThrow({where:{id:`${fixture.id}:res0`}});
    const payout=await db.payout.findUniqueOrThrow({where:{id:fixture.payoutIds[0]!}});
    expect(reservation.remainingAmount).toBe(20n);
    expect(payout.activeExposure).toBe(20n);
    expect(await db.ledgerEntry.count({where:{attemptId:fixture.attemptIds[0]!,type:'SETTLEMENT_CONFIRMED'}})).toBe(1);
  });

  it('reduces exposure only by confirmed partial refund amounts',async()=>{
    await reserve(0);
    await settlements.apply(fixture.payoutIds[0]!,{status:'SUCCESS',updatedAt:new Date(),amountIn:50n,amountOut:1n,depositedAmount:70n,refundedAmount:10n,refundAssetId:'usdc:test',outputAssetId:'out:test',recipient:'addr-0',originTxHashes:['origin'],destinationTxHashes:['destination'],rawSanitized:{}});
    const reservation=await db.reservation.findUniqueOrThrow({where:{id:`${fixture.id}:res0`}});
    expect(reservation.remainingAmount).toBe(10n);
    expect((await db.payout.findUniqueOrThrow({where:{id:fixture.payoutIds[0]!}})).activeExposure).toBe(10n);
  });

  it('retains exposure when deposits remain unresolved',async()=>{
    await reserve(0);
    await settlements.apply(fixture.payoutIds[0]!,{status:'PROCESSING',updatedAt:new Date(),depositedAmount:70n,refundAssetId:'usdc:test',outputAssetId:'out:test',recipient:'addr-0',originTxHashes:['origin'],destinationTxHashes:[],rawSanitized:{}});
    await expect(reservations.release(`${fixture.id}:res0`,{source:'PROVIDER_TERMINAL_NO_DEPOSIT',actor:'provider',reason:'Provider reported terminal no deposit'})).rejects.toThrow(/evidence/);
    expect((await db.payout.findUniqueOrThrow({where:{id:fixture.payoutIds[0]!}})).activeExposure).toBe(70n);
  });

  it('retains exposure for failed attempts with unknown provider deposit amount',async()=>{
    await reserve(0);
    await settlements.apply(fixture.payoutIds[0]!,{status:'FAILED',updatedAt:new Date(),refundAssetId:'usdc:test',outputAssetId:'out:test',recipient:'addr-0',originTxHashes:[],destinationTxHashes:[],rawSanitized:{}});
    await expect(reservations.release(`${fixture.id}:res0`,{source:'PROVIDER_TERMINAL_NO_DEPOSIT',actor:'provider',reason:'Provider reported terminal no deposit'})).rejects.toThrow(/evidence/);
    expect((await db.payout.findUniqueOrThrow({where:{id:fixture.payoutIds[0]!}})).activeExposure).toBe(70n);
  });
});
