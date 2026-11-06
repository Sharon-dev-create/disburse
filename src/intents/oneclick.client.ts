import { z } from 'zod';
import type { IntentsProvider, QuoteRequest, ValidatedQuote, StatusResult, ProviderStatus } from './provider.interface.js';

const quoteSchema=z.object({correlationId:z.string().min(1),timestamp:z.string(),quoteRequest:z.record(z.unknown()),quote:z.object({amountIn:z.string(),minAmountIn:z.string().optional(),maxAmountIn:z.string(),amountOut:z.string(),deadline:z.string(),depositAddress:z.string().optional(),depositMemo:z.string().nullable().optional()}).passthrough()}).passthrough();
const statusSchema=z.object({correlationId:z.string(),status:z.enum(['PENDING_DEPOSIT','KNOWN_DEPOSIT_TX','PROCESSING','SUCCESS','INCOMPLETE_DEPOSIT','REFUNDED','FAILED']),updatedAt:z.string(),swapDetails:z.object({amountIn:z.string().optional(),amountOut:z.string().optional(),depositedAmount:z.string().optional(),refundedAmount:z.string().optional(),originChainTxHashes:z.array(z.object({hash:z.string()}).passthrough()).optional(),destinationChainTxHashes:z.array(z.object({hash:z.string()}).passthrough()).optional()}).passthrough(),quoteResponse:z.unknown()}).passthrough();
const positive=(s:string)=>{if(!/^[1-9]\d*$/.test(s))throw new Error('Provider returned invalid atomic amount');return BigInt(s)};
function sanitize(v:unknown):unknown { if(Array.isArray(v))return v.map(sanitize); if(v&&typeof v==='object'){const out:Record<string,unknown>={}; for(const [k,val] of Object.entries(v)) out[k]=/authorization|token|secret|key/i.test(k)?'[REDACTED]':sanitize(val); return out;} return v; }
export class OneClickClient implements IntentsProvider {
  constructor(private readonly config:{baseUrl?:string;jwt?:string;fetchImpl?:typeof fetch}={}){}
  private get base(){return (this.config.baseUrl??'https://1click.chaindefuser.com').replace(/\/$/,'');}
  private get fetcher(){return this.config.fetchImpl??fetch;}
  async quote(request:QuoteRequest):Promise<ValidatedQuote>{
    if(request.swapType!=='EXACT_OUTPUT')throw new Error('Only EXACT_OUTPUT is supported');
    const headers:Record<string,string>={'content-type':'application/json'}; if(this.config.jwt)headers.Authorization=`Bearer ${this.config.jwt}`;
    const res=await this.fetcher(`${this.base}/v0/quote`,{method:'POST',headers,body:JSON.stringify(request)}); if(!res.ok)throw new Error(`1Click quote HTTP ${res.status}`);
    const parsed=quoteSchema.safeParse(await res.json()); if(!parsed.success)throw new Error(`Invalid 1Click quote response: ${parsed.error.message}`);
    const q=parsed.data.quote; const min=q.minAmountIn??q.amountIn; const deadline=new Date(q.deadline); if(!Number.isFinite(deadline.getTime()))throw new Error('Invalid provider deadline');
    if(parsed.data.quoteRequest.swapType!=='EXACT_OUTPUT'||parsed.data.quoteRequest.amount!==request.amount)throw new Error('Provider quote does not match exact-output request');
    if(BigInt(q.amountOut)!==BigInt(request.amount))throw new Error('Provider output amount differs from promised amount');
    if(BigInt(q.maxAmountIn)<BigInt(q.amountIn)||BigInt(q.maxAmountIn)<BigInt(min))throw new Error('Provider maxAmountIn is inconsistent');
    if(!request.dry&&!q.depositAddress)throw new Error('Committed quote omitted depositAddress');
    return {correlationId:parsed.data.correlationId,amountIn:positive(q.amountIn),minAmountIn:positive(min),maxAmountIn:positive(q.maxAmountIn),amountOut:positive(q.amountOut),deadline,...(q.depositAddress?{depositAddress:q.depositAddress}:{}),...(q.depositMemo!==undefined?{depositMemo:q.depositMemo}:{}),rawSanitized:sanitize(parsed.data)};
  }
  async status(depositAddress:string):Promise<StatusResult>{
    const u=new URL(`${this.base}/v0/status`); u.searchParams.set('depositAddress',depositAddress);
    const res=await this.fetcher(u,{headers:this.config.jwt?{Authorization:`Bearer ${this.config.jwt}`}:{}}); if(!res.ok)throw new Error(`1Click status HTTP ${res.status}`);
    const d=statusSchema.parse(await res.json()); const s=d.swapDetails; const optional=(x?:string)=>x===undefined?undefined:positive(x);
    const amountIn=optional(s.amountIn),amountOut=optional(s.amountOut),depositedAmount=optional(s.depositedAmount),refundedAmount=optional(s.refundedAmount);
    return {status:d.status as ProviderStatus,updatedAt:new Date(d.updatedAt),...(amountIn!==undefined?{amountIn}:{}),...(amountOut!==undefined?{amountOut}:{}),...(depositedAmount!==undefined?{depositedAmount}:{}),...(refundedAmount!==undefined?{refundedAmount}:{}),originTxHashes:(s.originChainTxHashes??[]).map(x=>x.hash),destinationTxHashes:(s.destinationChainTxHashes??[]).map(x=>x.hash),rawSanitized:sanitize(d)};
  }
}
