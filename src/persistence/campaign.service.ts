import { PrismaClient } from '@prisma/client';
import { calculateExposure } from '../budget/budget-calculator.js';
import type { Asset } from '../domain/money.js';
export interface RecipientSpec { id:string; address:string; amount:bigint; outputAssetId:string; outputChain:string; maximumInput:bigint; inputAsset:Asset }
export class CampaignService {
  constructor(private readonly db:PrismaClient){}
  async createAndApprove(input:{id:string;idempotencyKey:string;budget:bigint;budgetAsset:Asset;recipients:RecipientSpec[]}):Promise<bigint>{
    const exposure=calculateExposure({approved:input.budget,denomination:input.budgetAsset,quotes:input.recipients.map(r=>({atomic:r.maximumInput,asset:r.inputAsset})),separatelyPayableFees:[]});
    await this.db.$transaction(async tx=>{
      await tx.campaign.create({data:{id:input.id,idempotencyKey:input.idempotencyKey,budget:input.budget,assetId:input.budgetAsset.assetId,decimals:input.budgetAsset.decimals,status:'APPROVED',payouts:{create:input.recipients.map(r=>({id:`${input.id}:${r.id}`,recipientId:r.id,recipientAddress:r.address,promisedAmount:r.amount,outputAssetId:r.outputAssetId,outputChain:r.outputChain,status:'QUOTED'}))}}});
      await tx.ledgerEntry.create({data:{campaignId:input.id,type:'BUDGET_APPROVED',amount:input.budget,assetId:input.budgetAsset.assetId,externalRef:`budget:${input.id}`}});
    },{isolationLevel:'Serializable'});
    return exposure;
  }
}
