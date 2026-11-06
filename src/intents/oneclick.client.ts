import { z } from 'zod';
import type { IntentsProvider, QuoteRequest, ValidatedQuote, StatusResult, ProviderStatus } from './provider.interface.js';

const quoteSchema=z.object({correlationId:z.string().min(1),timestamp:z.string(),signature:z.string().min(1),quoteRequest:z.record(z.unknown()),quote:z.object({amountIn:z.string(),minAmountIn:z.string(),amountOut:z.string(),deadline:z.string().optional(),timeWhenInactive:z.string().optional(),depositAddress:z.string().optional(),depositMemo:z.string().nullable().optional(),refundFee:z.string().optional(),withdrawFee:z.string().optional()}).passthrough()}).passthrough();
const statusSchema=z.object({correlationId:z.string(),status:z.enum(['PENDING_DEPOSIT','KNOWN_DEPOSIT_TX','PROCESSING','SUCCESS','INCOMPLETE_DEPOSIT','REFUNDED','FAILED']),updatedAt:z.string(),swapDetails:z.object({amountIn:z.string().optional(),amountOut:z.string().optional(),depositedAmount:z.string().optional(),refundedAmount:z.string().optional(),originChainTxHashes:z.array(z.object({hash:z.string()}).passthrough()).optional(),destinationChainTxHashes:z.array(z.object({hash:z.string()}).passthrough()).optional()}).passthrough(),quoteResponse:quoteSchema}).passthrough();
const positive=(s:string)=>{if(!/^[1-9]\d*$/.test(s))throw new Error('Provider returned invalid atomic amount');return BigInt(s)};
const nonnegative=(s:string)=>{if(!/^(0|[1-9]\d*)$/.test(s))throw new Error('Provider returned invalid atomic amount');return BigInt(s)};
function sanitize(v:unknown):unknown { if(Array.isArray(v))return v.map(sanitize); if(v&&typeof v==='object'){const out:Record<string,unknown>={}; for(const [k,val] of Object.entries(v)) out[k]=/authorization|token|secret|key/i.test(k)?'[REDACTED]':sanitize(val); return out;} return v; }
export class OneClickClient implements IntentsProvider {
  constructor(private readonly config:{baseUrl?:string;jwt?:string;timeoutMs?:number;fetchImpl?:typeof fetch}={}){}
  private get base(){return (this.config.baseUrl??'https://1click.chaindefuser.com').replace(/\/$/,'');}
  private get fetcher(){return this.config.fetchImpl??fetch;}
  async quote(request:QuoteRequest):Promise<ValidatedQuote>{
    if(request.swapType!=='EXACT_OUTPUT')throw new Error('Only EXACT_OUTPUT is supported');
    if(!/^[1-9]\d*$/.test(request.amount)||!Number.isInteger(request.slippageTolerance)||request.slippageTolerance<0||!Number.isFinite(Date.parse(request.deadline))||Date.parse(request.deadline)<=Date.now()||![request.originAsset,request.destinationAsset,request.recipient,request.refundTo].every(x=>typeof x==='string'&&x.length>0))throw new Error('Invalid exact-output quote request');
    const headers:Record<string,string>={'content-type':'application/json'}; if(this.config.jwt)headers['X-API-Key']=this.config.jwt;
    const res=await this.fetcher(`${this.base}/v0/quote`,{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.timeout(this.config.timeoutMs??15_000)}); if(!res.ok)throw new Error(`1Click quote HTTP ${res.status}`);
    const parsed=quoteSchema.safeParse(await res.json()); if(!parsed.success)throw new Error(`Invalid 1Click quote response: ${parsed.error.message}`);
    if(!Number.isFinite(Date.parse(parsed.data.timestamp)))throw new Error('Invalid provider quote timestamp');
    const q=parsed.data.quote; const min=q.minAmountIn; const deadline=q.deadline?new Date(q.deadline):undefined;const timeWhenInactive=q.timeWhenInactive?new Date(q.timeWhenInactive):undefined;
    if(deadline&&!Number.isFinite(deadline.getTime())||timeWhenInactive&&!Number.isFinite(timeWhenInactive.getTime()))throw new Error('Invalid provider quote expiry timestamp');
    if(deadline&&deadline.getTime()<=Date.now()||timeWhenInactive&&timeWhenInactive.getTime()<=Date.now())throw new Error('Provider quote is already expired or inactive');
    if(parsed.data.quoteRequest.dry!==request.dry||parsed.data.quoteRequest.swapType!=='EXACT_OUTPUT'||parsed.data.quoteRequest.amount!==request.amount||parsed.data.quoteRequest.originAsset!==request.originAsset||parsed.data.quoteRequest.destinationAsset!==request.destinationAsset||parsed.data.quoteRequest.recipient!==request.recipient||parsed.data.quoteRequest.refundTo!==request.refundTo||parsed.data.quoteRequest.slippageTolerance!==request.slippageTolerance||parsed.data.quoteRequest.depositType!==request.depositType||parsed.data.quoteRequest.recipientType!==request.recipientType||parsed.data.quoteRequest.refundType!==request.refundType||parsed.data.quoteRequest.deadline!==request.deadline)throw new Error('Provider quote does not match exact-output request');
    if(BigInt(q.amountOut)!==BigInt(request.amount))throw new Error('Provider output amount differs from promised amount');
    const amountIn=positive(q.amountIn),minAmountIn=positive(min);
    if(amountIn<minAmountIn)throw new Error('Provider amountIn is below minimum input');
    for(const fee of [q.refundFee,q.withdrawFee])if(fee!==undefined&&(!/^(0|[1-9]\d*)$/.test(fee)||BigInt(fee)>0n))throw new Error('Unsupported provider fee field; fee denomination/accounting is not validated');
    if(Object.hasOwn(q,'fees')&&Array.isArray(q.fees)&&q.fees.length>0)throw new Error('Unsupported provider fee collection');
    if(!request.dry&&(!q.depositAddress||!deadline))throw new Error('Committed quote omitted depositAddress or deadline');
    if(deadline&&deadline.getTime()>Date.parse(request.deadline))throw new Error('Provider quote deadline exceeds requested deadline');
    return {correlationId:parsed.data.correlationId,amountIn,minAmountIn,maxAmountIn:amountIn,amountOut:positive(q.amountOut),...(deadline?{deadline}:{}),...(timeWhenInactive?{timeWhenInactive}:{}),...(q.depositAddress?{depositAddress:q.depositAddress}:{}),...(q.depositMemo!==undefined?{depositMemo:q.depositMemo}:{}),rawSanitized:sanitize(parsed.data)};
  }
  async status(depositAddress:string,depositMemo?:string|null):Promise<StatusResult>{
    if(typeof depositAddress!=='string'||depositAddress.length===0)throw new Error('Invalid deposit address');
    const u=new URL(`${this.base}/v0/status`); u.searchParams.set('depositAddress',depositAddress);
    if(depositMemo)u.searchParams.set('depositMemo',depositMemo);
    const res=await this.fetcher(u,{headers:this.config.jwt?{Authorization:`Bearer ${this.config.jwt}`}:{},signal:AbortSignal.timeout(this.config.timeoutMs??15_000)}); if(!res.ok)throw new Error(`1Click status HTTP ${res.status}`);
    const d=statusSchema.parse(await res.json()); const s=d.swapDetails; const optional=(x?:string)=>x===undefined?undefined:positive(x);
    if(!Number.isFinite(Date.parse(d.updatedAt))||d.quoteResponse.quote.depositAddress!==depositAddress)throw new Error('Provider status does not match the persisted quote');
    const echoedMemo=d.quoteResponse.quote.depositMemo??null;if((echoedMemo??null)!==(depositMemo??null))throw new Error('Provider status memo does not match the persisted quote');
    const amountIn=optional(s.amountIn),amountOut=optional(s.amountOut),depositedAmount=s.depositedAmount===undefined?undefined:nonnegative(s.depositedAmount),refundedAmount=optional(s.refundedAmount);
    const refundAssetId=d.quoteResponse.quoteRequest.originAsset;
    const outputAssetId=d.quoteResponse.quoteRequest.destinationAsset,recipient=d.quoteResponse.quoteRequest.recipient;
    if(typeof refundAssetId!=='string'||!refundAssetId||typeof outputAssetId!=='string'||!outputAssetId||typeof recipient!=='string'||!recipient)throw new Error('Status response missing original quote asset or recipient');
    return {status:d.status as ProviderStatus,updatedAt:new Date(d.updatedAt),...(amountIn!==undefined?{amountIn}:{}),...(amountOut!==undefined?{amountOut}:{}),...(depositedAmount!==undefined?{depositedAmount}:{}),...(refundedAmount!==undefined?{refundedAmount}:{}),refundAssetId,outputAssetId,recipient,originTxHashes:(s.originChainTxHashes??[]).map(x=>x.hash),destinationTxHashes:(s.destinationChainTxHashes??[]).map(x=>x.hash),rawSanitized:sanitize(d)};
  }
}
