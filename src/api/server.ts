import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { CampaignService } from '../persistence/campaign.service.js';

const campaignSchema=z.object({id:z.string().min(1),budgetAtomic:z.string().regex(/^[1-9]\d*$/),assetId:z.string().min(1),sourceChain:z.string().min(1),decimals:z.number().int().min(0).max(30)});
const payoutSchema=z.object({recipientId:z.string().min(1),recipientAddress:z.string().min(1),amountAtomic:z.string().regex(/^[1-9]\d*$/),outputAssetId:z.string().min(1),outputChain:z.string().min(1),quote:z.object({slippageTolerance:z.number().int().nonnegative(),refundTo:z.string().min(1),depositType:z.enum(['ORIGIN_CHAIN','INTENTS','CONFIDENTIAL_INTENTS']),recipientType:z.enum(['DESTINATION_CHAIN','INTENTS','CONFIDENTIAL_INTENTS']),refundType:z.enum(['ORIGIN_CHAIN','INTENTS','CONFIDENTIAL_INTENTS']),deadline:z.string().datetime()})});
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};

async function body(req:IncomingMessage):Promise<unknown>{let raw='';for await(const chunk of req){raw+=chunk.toString();if(raw.length>1_000_000)throw new Error('Request body exceeds 1 MB');}try{return JSON.parse(raw);}catch{throw new Error('Request body must be valid JSON');}}

/** Minimal API. Funding secrets and signed transactions are never serialized into responses. */
export function createApiServer(db:PrismaClient,campaigns=new CampaignService(db)):Server{
  return createServer(async(req,res)=>{
    try{
      const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`);const parts=url.pathname.split('/').filter(Boolean);const method=req.method??'GET';
      if(method==='POST'&&url.pathname==='/campaigns'){
        const parsed=campaignSchema.parse(await body(req));const key=req.headers['idempotency-key'];if(typeof key!=='string'||!key.trim())return json(res,400,{error:'Idempotency-Key header is required'});
        const campaign=await campaigns.createDraft({id:parsed.id,idempotencyKey:key,budget:BigInt(parsed.budgetAtomic),budgetAsset:{assetId:parsed.assetId,chain:parsed.sourceChain,decimals:parsed.decimals}});return json(res,201,campaign);
      }
      if(method==='POST'&&parts.length===3&&parts[0]==='campaigns'&&parts[2]==='approve'){await campaigns.approveCampaign(parts[1]!);return json(res,200,{id:parts[1],status:'APPROVED'});}
      if(method==='POST'&&parts.length===3&&parts[0]==='campaigns'&&parts[2]==='payouts'){
        const parsed=payoutSchema.parse(await body(req));const key=req.headers['idempotency-key'];if(typeof key!=='string'||!key.trim())return json(res,400,{error:'Idempotency-Key header is required'});
        const payout=await campaigns.createPayout({campaignId:parts[1]!,idempotencyKey:key,recipientId:parsed.recipientId,recipientAddress:parsed.recipientAddress,amount:BigInt(parsed.amountAtomic),outputAssetId:parsed.outputAssetId,outputChain:parsed.outputChain,quote:parsed.quote});return json(res,201,payout);
      }
      if(method==='GET'&&parts.length===2&&parts[0]==='payouts'){
        const payout=await db.payout.findUnique({where:{id:parts[1]},include:{attempts:{orderBy:{attemptNo:'asc'}},events:{orderBy:{createdAt:'asc'}},workItems:true}});if(!payout)return json(res,404,{error:'Payout not found'});
        return json(res,200,{id:payout.id,campaignId:payout.campaignId,recipientId:payout.recipientId,recipientAddress:payout.recipientAddress,promisedAmount:payout.promisedAmount.toString(),outputAssetId:payout.outputAssetId,outputChain:payout.outputChain,status:payout.status,activeExposure:payout.activeExposure.toString(),recipientOutput:{state:payout.recipientOutputState,transactionHash:payout.recipientOutputTxHash,blockHash:payout.recipientOutputBlockHash,verifiedAt:payout.recipientOutputVerifiedAt},providerExecution:payout.attempts.map(a=>({attemptId:a.id,quoteId:a.quoteId,status:a.providerStatus})),work:payout.workItems.map(w=>({state:w.state,attempts:w.attempts,availableAt:w.availableAt,lastError:w.lastError})),events:payout.events.map(e=>({from:e.fromStatus,to:e.toStatus,note:e.note,providerRef:e.providerRef,txHash:e.txHash,at:e.createdAt}))});
      }
      if(method==='GET'&&parts.length===3&&parts[0]==='payouts'&&parts[2]==='attempts'){
        const rows=await db.attempt.findMany({where:{payoutId:parts[1]},orderBy:{attemptNo:'asc'}});return json(res,200,rows.map(a=>({id:a.id,attemptNo:a.attemptNo,quoteId:a.quoteId,status:a.status,providerStatus:a.providerStatus,inputAssetId:a.inputAssetId,inputChain:a.inputChain,maxAmountIn:a.maxAmountIn?.toString(),outputAmount:a.outputAmount?.toString(),depositAddress:a.depositAddress,depositMemo:a.depositMemo,expiresAt:a.expiresAt,timeWhenInactive:a.timeWhenInactive})));
      }
      if(method==='GET'&&parts.length===3&&parts[0]==='payouts'&&parts[2]==='funding'){
        const op=await db.evmFundingOperation.findFirst({where:{payoutId:parts[1]},orderBy:{createdAt:'desc'},select:{id:true,state:true,quoteId:true,chainId:true,sourceAssetId:true,sourceChain:true,sourceAddress:true,tokenAddress:true,tokenAmount:true,tokenDecimals:true,destinationAddress:true,destinationMemo:true,nonce:true,txHash:true,failureReason:true,lastObservedBlock:true,lastObservedBlockHash:true,createdAt:true,authorizedAt:true,broadcastAt:true,confirmedAt:true,reconciledAt:true}});if(!op)return json(res,404,{error:'Funding operation not found'});
        return json(res,200,{...op,chainId:op.chainId.toString(),tokenAmount:op.tokenAmount.toString(),nonce:op.nonce.toString(),lastObservedBlock:op.lastObservedBlock?.toString()??null});
      }
      if(method==='GET'&&parts.length===3&&parts[0]==='payouts'&&parts[2]==='reconciliation'){
        const rows=await db.ledgerEntry.findMany({where:{payoutId:parts[1]},orderBy:{createdAt:'asc'},select:{id:true,type:true,amount:true,assetId:true,externalRef:true,reason:true,createdAt:true}});return json(res,200,rows.map(x=>({...x,amount:x.amount.toString()})));
      }
      return json(res,404,{error:'Route not found'});
    }catch(error){const message=error instanceof Error?error.message:'Request failed';const status=error instanceof z.ZodError?400:/not found/i.test(message)?404:/idempotency|already|conflict/i.test(message)?409:422;return json(res,status,{error:message});}
  });
}
