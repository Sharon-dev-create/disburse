import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createWalletClient, getAddress, http, parseAbi, type Address } from 'viem';
import { CampaignService } from '../../src/persistence/campaign.service.js';
import { MockProvider } from '../../src/intents/mock.provider.js';
import { anvilChain, EvmChainAdapter, type EvmTokenConfig } from '../../src/funding-control/evm/evm-chain-adapter.js';
import { EvmFundingService } from '../../src/funding-control/evm/evm-funding.service.js';
import { PolicyCheckedAnvilSigner } from '../../src/funding-control/evm/signer.js';
import { AesGcmSignedTransactionCipher } from '../../src/funding-control/evm/signed-tx-cipher.js';
import { EvmRecipientOutputVerifier } from '../../src/payouts/recipient-output-verifier.js';
import { SinglePayoutWorker } from '../../src/payouts/single-payout-worker.js';

const rpc=process.env.ANVIL_RPC_URL??'http://127.0.0.1:18545';const chainId=31337;const db=new PrismaClient();const chain=anvilChain(chainId,rpc);
const tokenAbi=parseAbi(['function balanceOf(address) view returns (uint256)','function transfer(address,uint256) returns (bool)','event Transfer(address indexed from,address indexed to,uint256 value)']);
describe('single payout lifecycle on Anvil + PostgreSQL + deterministic provider mock',()=>{
  afterAll(async()=>db.$disconnect());
  it('recovers a leased job and completes only after source and recipient chain proofs',async()=>{
    const wallet=createWalletClient({chain,transport:http(rpc)});const [source,recipient]=await wallet.getAddresses();if(!source||!recipient)throw new Error('Anvil disposable accounts are unavailable');
    const artifact=JSON.parse(await readFile(join(process.cwd(),'out/TestERC20.sol/TestERC20.json'),'utf8')) as {abi:readonly unknown[];bytecode:{object:string}};
    const deploy=async()=>{const hash=await wallet.deployContract({account:source,abi:artifact.abi as never,bytecode:artifact.bytecode.object as `0x${string}`,args:[20_000_000n]});const receipt=await chainClient.waitForTransactionReceipt({hash});if(!receipt.contractAddress)throw new Error('Local test token deployment failed');return receipt.contractAddress;};
    const chainClient=new EvmChainAdapter(chain,{assetId:'placeholder',sourceChain:'ANVIL',chainId,tokenAddress:'0x0000000000000000000000000000000000000001',decimals:6},rpc).publicClient;
    const sourceToken=await deploy();const outputToken=await deploy();
    const sourceConfig:EvmTokenConfig={assetId:'mock:source-usdc',sourceChain:'ANVIL',chainId,tokenAddress:sourceToken,decimals:6};
    const outputConfig:EvmTokenConfig={assetId:'mock:output-usdc',sourceChain:'ANVIL',chainId,tokenAddress:outputToken,decimals:6};
    const sourceAdapter=new EvmChainAdapter(chain,sourceConfig,rpc);const outputAdapter=new EvmChainAdapter(chain,outputConfig,rpc);
    const deposit='0x00000000000000000000000000000000000000d1' as Address;const suffix=`single-${Date.now()}-${Math.floor(Math.random()*1e7)}`;const campaignId=`${suffix}:campaign`;const payoutKey=`${suffix}:payout-key`;
    const campaignService=new CampaignService(db);const provider=new MockProvider(()=>new Date(),amount=>BigInt(amount),()=>deposit);
    try{
      await campaignService.createDraft({id:campaignId,idempotencyKey:`${suffix}:campaign-key`,budget:2_000_000n,budgetAsset:{assetId:sourceConfig.assetId,chain:'ANVIL',decimals:6}});
      await campaignService.approveCampaign(campaignId);
      const created=await campaignService.createPayout({campaignId,idempotencyKey:payoutKey,recipientId:'recipient-1',recipientAddress:getAddress(recipient),amount:1_000_000n,outputAssetId:outputConfig.assetId,outputChain:'ANVIL',quote:{swapType:'EXACT_OUTPUT',slippageTolerance:100,refundTo:getAddress(source),depositType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',refundType:'ORIGIN_CHAIN',deadline:new Date(Date.now()+300_000).toISOString()}});
      const duplicate=await campaignService.createPayout({campaignId,idempotencyKey:payoutKey,recipientId:'recipient-1',recipientAddress:getAddress(recipient),amount:1_000_000n,outputAssetId:outputConfig.assetId,outputChain:'ANVIL',quote:{swapType:'EXACT_OUTPUT',slippageTolerance:100,refundTo:getAddress(source),depositType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',refundType:'ORIGIN_CHAIN',deadline:new Date(Date.now()+300_000).toISOString()}});
      expect(duplicate.id).toBe(created.id);expect(await db.payoutWorkItem.count({where:{payoutId:created.id}})).toBe(1);
      const gas={maxGasLimit:200_000n,maxFeePerGas:100_000_000_000n,maxPriorityFeePerGas:2_000_000_000n,maxNativeGasCost:100_000_000_000_000_000n};
      const funding=new EvmFundingService(db,sourceAdapter,new PolicyCheckedAnvilSigner(db,sourceAdapter,source),new AesGcmSignedTransactionCipher(Buffer.alloc(32,9)),{signerAddress:getAddress(source),token:sourceConfig,gas,confirmations:1n});
      const outputVerifier=new EvmRecipientOutputVerifier(outputConfig,outputAdapter,1n);let clockMs=Date.now();const now=()=>new Date(clockMs);const worker=new SinglePayoutWorker(db,provider,funding,outputVerifier,'ANVIL',now);
      const first=await worker.processOne();expect(first.state).toBe('QUOTED');
      const job=await db.payoutWorkItem.findUniqueOrThrow({where:{payoutId_kind:{payoutId:created.id,kind:'SINGLE_PAYOUT'}}});
      await db.payoutWorkItem.update({where:{id:job.id},data:{state:'LEASED',lockToken:'crashed-worker',leaseUntil:new Date(Date.now()-1),availableAt:new Date(Date.now()-1)}});
      const restartedWorker=new SinglePayoutWorker(db,provider,funding,outputVerifier,'ANVIL',now);
      const step=async()=>{clockMs+=5_000;return restartedWorker.processOne();};
      expect((await step()).state).toBe('RESERVED');
      expect((await step()).state).toBe('FUNDING_SUBMITTED');
      expect((await step()).state).toBe('SOURCE_CONFIRMED');
      const attempt=await db.attempt.findFirstOrThrow({where:{payoutId:created.id}});const op=await db.evmFundingOperation.findFirstOrThrow({where:{payoutId:created.id}});
      expect(attempt.quoteId).toBe(op.quoteId);expect(op.state).toBe('CONFIRMED');
      const outputHash=await wallet.writeContract({account:source,address:outputToken,abi:tokenAbi,functionName:'transfer',args:[getAddress(recipient),1_000_000n]});
      const outputReceipt=await chainClient.waitForTransactionReceipt({hash:outputHash});
      provider.setStatus(deposit,{status:'SUCCESS',updatedAt:new Date(),amountIn:op.tokenAmount,amountOut:1_000_000n,depositedAmount:op.tokenAmount,refundAssetId:sourceConfig.assetId,outputAssetId:outputConfig.assetId,recipient:getAddress(recipient),originTxHashes:[op.txHash!],destinationTxHashes:[outputHash],rawSanitized:{simulated:true,claim:'not real provider evidence'}});
      const done=await step();expect(done.state).toBe('SUCCESS');
      const final=await db.payout.findUniqueOrThrow({where:{id:created.id}});expect(final.status).toBe('SUCCESS');expect(final.recipientOutputState).toBe('VERIFIED');expect(final.recipientOutputTxHash).toBe(outputHash);expect(final.recipientOutputBlockHash).toBe(outputReceipt.blockHash);
      expect((await db.attempt.findUniqueOrThrow({where:{id:attempt.id}})).providerStatus).toBe('SUCCESS');
      expect((await db.evmFundingOperation.findUniqueOrThrow({where:{id:op.id}})).state).toBe('CONFIRMED');
      const events=await db.payoutEvent.findMany({where:{payoutId:created.id},orderBy:{createdAt:'asc'}});expect(events.map(e=>e.toStatus)).toEqual(['QUOTED','RESERVED','COMMITTED','AWAITING_DEPOSIT','PROCESSING','SUCCESS']);
      expect(await db.ledgerEntry.count({where:{attemptId:attempt.id,type:'RECIPIENT_OUTPUT_VERIFIED'}})).toBe(1);
      expect(await db.ledgerEntry.count({where:{attemptId:attempt.id,type:'SETTLEMENT_CONFIRMED'}})).toBe(1);
      expect(await db.payoutWorkItem.count({where:{payoutId:created.id,state:'DONE'}})).toBe(1);
      expect(await chainClient.readContract({address:outputToken,abi:tokenAbi,functionName:'balanceOf',args:[getAddress(recipient)]})).toBe(1_000_000n);
      const active=(await db.reservation.findFirst({where:{payoutId:created.id,status:'ACTIVE'}}))?.remainingAmount??0n;expect(active).toBe(0n);
    }finally{
      const payout=await db.payout.findUnique({where:{id:`${campaignId}:recipient-1`}});
      if(payout){await db.payoutWorkItem.deleteMany({where:{payoutId:payout.id}});await db.evmFundingOperation.deleteMany({where:{payoutId:payout.id}});await db.ledgerEntry.deleteMany({where:{payoutId:payout.id}});await db.payoutEvent.deleteMany({where:{payoutId:payout.id}});await db.reservation.deleteMany({where:{payoutId:payout.id}});await db.attempt.deleteMany({where:{payoutId:payout.id}});await db.payout.delete({where:{id:payout.id}});}
      await db.ledgerEntry.deleteMany({where:{campaignId}});await db.campaign.deleteMany({where:{id:campaignId}});
    }
  },60_000);
});
