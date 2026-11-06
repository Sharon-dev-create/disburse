import 'dotenv/config';
import { beforeAll,afterAll,it,expect,describe } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ReservationService } from '../../src/budget/reservation.service.js';

const enabled=Boolean(process.env.DATABASE_URL);
describe.skipIf(!enabled)('PostgreSQL reservation concurrency',()=>{
 const db=new PrismaClient(); const service=new ReservationService(db); const id=`concurrency-${Date.now()}`;
 beforeAll(async()=>{
   await db.campaign.create({data:{id,idempotencyKey:id,budget:100n,assetId:'usdc:test',decimals:6,status:'APPROVED',payouts:{create:[{id:`${id}:a`,recipientId:'a',recipientAddress:'sim-a',promisedAmount:1n,outputAssetId:'out',outputChain:'sim',status:'QUOTED',attempts:{create:{id:`${id}:a:attempt:1`,attemptNo:1,quoteId:`${id}:quote-a`,maxAmountIn:70n,inputAssetId:'usdc:test',status:'QUOTED'}}},{id:`${id}:b`,recipientId:'b',recipientAddress:'sim-b',promisedAmount:1n,outputAssetId:'out',outputChain:'sim',status:'QUOTED',attempts:{create:{id:`${id}:b:attempt:1`,attemptNo:1,quoteId:`${id}:quote-b`,maxAmountIn:70n,inputAssetId:'usdc:test',status:'QUOTED'}}}]}}});
 });
 afterAll(async()=>{await db.$disconnect();});
 it('allows only one of two concurrent 70-unit reservations against 100',async()=>{
   const results=await Promise.allSettled([service.reserve(id,`${id}:a`,`${id}:ra`,70n),service.reserve(id,`${id}:b`,`${id}:rb`,70n)]);
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
   const reservations=await db.reservation.aggregate({where:{campaignId:id,status:'ACTIVE'},_sum:{amount:true}});
   expect(reservations._sum.amount).toBe(70n);
 });
});
