import { afterEach, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createApiServer } from '../../src/api/server.js';

const servers:Array<ReturnType<typeof createApiServer>>=[];
async function start(){const db={payout:{findUnique:async()=>null}} as unknown as PrismaClient;const server=createApiServer(db);servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('API server did not bind');return`http://127.0.0.1:${address.port}`;}
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>s.close(()=>resolve()))));});

it('requires idempotency keys for campaign creation',async()=>{const base=await start();const response=await fetch(`${base}/campaigns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'c',budgetAtomic:'10',assetId:'asset',sourceChain:'ANVIL',decimals:6})});expect(response.status).toBe(400);expect((await response.json()).error).toMatch(/Idempotency-Key/);});
it('rejects malformed atomic values before persistence',async()=>{const base=await start();const response=await fetch(`${base}/campaigns`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'campaign-1'},body:JSON.stringify({id:'c',budgetAtomic:'1.2',assetId:'asset',sourceChain:'ANVIL',decimals:6})});expect(response.status).toBe(400);});
it('returns not found for an unknown payout',async()=>{const base=await start();const response=await fetch(`${base}/payouts/missing`);expect(response.status).toBe(404);});
