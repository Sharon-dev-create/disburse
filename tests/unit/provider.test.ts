import { describe,it,expect } from 'vitest';
import { OneClickClient } from '../../src/intents/oneclick.client.js';

const req={dry:true,swapType:'EXACT_OUTPUT' as const,originAsset:'asset:in',destinationAsset:'asset:out',amount:'500',recipient:'dest-address',refundTo:'refund-address'};
const quoteBody={correlationId:'quote-1',timestamp:'2026-01-01T00:00:00.000Z',quoteRequest:req,quote:{amountIn:'520',minAmountIn:'510',maxAmountIn:'550',amountOut:'500',deadline:'2026-01-01T00:10:00.000Z'}};
function fetchWith(body:unknown):typeof fetch{return (async()=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})) as typeof fetch;}

describe('1Click response boundary',()=>{
 it('validates EXACT_OUTPUT and extracts max input using provider field names',async()=>{const c=new OneClickClient({fetchImpl:fetchWith(quoteBody)});const q=await c.quote(req);expect(q.maxAmountIn).toBe(550n);expect(q.amountOut).toBe(500n);});
 it('rejects mismatched output promise and missing max input',async()=>{const c=new OneClickClient({fetchImpl:fetchWith({...quoteBody,quote:{...quoteBody.quote,amountOut:'499'}})});await expect(c.quote(req)).rejects.toThrow('differs from promised');const bad={...quoteBody,quote:{...quoteBody.quote,maxAmountIn:undefined}};await expect(new OneClickClient({fetchImpl:fetchWith(bad)}).quote(req)).rejects.toThrow();});
 it('validates status details and binds refunds to origin asset echoed in quote',async()=>{const body={correlationId:'status-1',status:'REFUNDED',updatedAt:'2026-01-01T00:05:00.000Z',quoteResponse:quoteBody,swapDetails:{refundedAmount:'520',originChainTxHashes:[{hash:'simulated-refund-hash'}],destinationChainTxHashes:[]}};const status=await new OneClickClient({fetchImpl:fetchWith(body)}).status('sim-deposit');expect(status.refundedAmount).toBe(520n);expect(status.refundAssetId).toBe('asset:in');expect(status.originTxHashes).toEqual(['simulated-refund-hash']);});
 it('labels preview and committed quote differences from response fields',async()=>{const committed={...quoteBody,quoteRequest:{...req,dry:false},quote:{...quoteBody.quote,depositAddress:'sim-deposit',depositMemo:null}};const c=new OneClickClient({fetchImpl:fetchWith(committed)});const q=await c.quote({...req,dry:false});expect(q.depositAddress).toBe('sim-deposit');});
});
