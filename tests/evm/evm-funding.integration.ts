import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createWalletClient, getAddress, http, parseAbi, type Address } from 'viem';
import { anvilChain, EvmChainAdapter, type EvmGasPolicy, type EvmTokenConfig } from '../../src/funding-control/evm/evm-chain-adapter.js';
import { EvmFundingService } from '../../src/funding-control/evm/evm-funding.service.js';
import { PolicyCheckedAnvilSigner } from '../../src/funding-control/evm/signer.js';
import { AesGcmSignedTransactionCipher } from '../../src/funding-control/evm/signed-tx-cipher.js';

const rpc=process.env.ANVIL_RPC_URL??'http://127.0.0.1:18545';
const chainId=31337;
const db=new PrismaClient();
const chain=anvilChain(chainId,rpc);

describe('Anvil EVM funding integration (disposable local chain only)',()=>{
  afterAll(async()=>{await db.$disconnect();});
  it('authorizes exact ERC-20 transfer, persists idempotently, and independently verifies its receipt',async()=>{
    const wallet=createWalletClient({chain,transport:http(rpc)});
    const [source]=await wallet.getAddresses();if(!source)throw new Error('Anvil has no unlocked disposable account');
    const artifact=JSON.parse(await readFile(join(process.cwd(),'out/TestERC20.sol/TestERC20.json'),'utf8')) as {abi:readonly unknown[];bytecode:{object:string}};
    const deployed=await wallet.deployContract({account:source,abi:artifact.abi as never,bytecode:artifact.bytecode.object as `0x${string}`,args:[10_000_000n]});
    const publicClient=new EvmChainAdapter(chain,{assetId:'SPIKE_USDC',sourceChain:'ANVIL',chainId,tokenAddress:'0x0000000000000000000000000000000000000001',decimals:6},rpc).publicClient;
    const deployment=await publicClient.waitForTransactionReceipt({hash:deployed});if(!deployment.contractAddress)throw new Error('Anvil test token deployment failed');
    const token: EvmTokenConfig={assetId:'SPIKE_USDC',sourceChain:'ANVIL',chainId,tokenAddress:deployment.contractAddress,decimals:6};
    const adapter=new EvmChainAdapter(chain,token,rpc);
    const fundingPolicy:EvmGasPolicy={maxGasLimit:200000n,maxFeePerGas:100_000_000_000n,maxPriorityFeePerGas:2_000_000_000n,maxNativeGasCost:100_000_000_000_000_000n};
    const destination='0x00000000000000000000000000000000000000d1' as Address;
    const suffix=`${Date.now()}-${Math.floor(Math.random()*1e8)}`;const campaignId=`evm-c-${suffix}`;const payoutId=`evm-p-${suffix}`;const attemptId=`evm-a-${suffix}`;const reservationId=`evm-r-${suffix}`;
    try{
      await db.campaign.create({data:{id:campaignId,idempotencyKey:`evm-ci-${suffix}`,budget:1_000_000n,assetId:token.assetId,decimals:6,status:'APPROVED'}});
      await db.payout.create({data:{id:payoutId,campaignId,recipientId:`r-${suffix}`,recipientAddress:destination,promisedAmount:900_000n,outputAssetId:'DEST',outputChain:'OTHER',status:'RESERVED',activeExposure:1_000_000n}});
      await db.attempt.create({data:{id:attemptId,payoutId,attemptNo:1,quoteId:`q-${suffix}`,maxAmountIn:1_000_000n,inputAssetId:token.assetId,inputChain:token.sourceChain,outputAmount:900_000n,expiresAt:new Date(Date.now()+300_000),depositAddress:destination,status:'COMMITTED'}});
      await db.reservation.create({data:{id:reservationId,campaignId,payoutId,attemptId,amount:1_000_000n,remainingAmount:1_000_000n,status:'ACTIVE'}});
      const service=new EvmFundingService(db,adapter,new PolicyCheckedAnvilSigner(db,adapter,source),new AesGcmSignedTransactionCipher(Buffer.alloc(32,7)),{signerAddress:getAddress(source),token,gas:fundingPolicy,confirmations:1n});
      const first=await service.authorizeAndSubmit({reservationId,idempotencyKey:`evm-op-${suffix}`});expect(first.state).toBe('BROADCAST');expect(first.tokenAmount).toBe('1000000');
      const duplicate=await service.authorizeAndSubmit({reservationId,idempotencyKey:`evm-op-${suffix}`});expect(duplicate.id).toBe(first.id);expect(duplicate.txHash).toBe(first.txHash);
      await publicClient.request({method:'anvil_mine',params:['0x1']} as never);
      const final=await service.reconcile(first.id);expect(final.state).toBe('CONFIRMED');
      const balance=await publicClient.readContract({address:token.tokenAddress,abi:parseAbi(['function balanceOf(address) view returns (uint256)']),functionName:'balanceOf',args:[destination]});expect(balance).toBe(1_000_000n);
      expect(await db.ledgerEntry.findUnique({where:{externalRef:`evm-deposit:${first.id}`} })).not.toBeNull();
      expect((await service.authorizeAndSubmit({reservationId,idempotencyKey:`evm-op-${suffix}`})).id).toBe(first.id);
    }finally{
      await db.evmFundingOperation.deleteMany({where:{reservationId}}).catch(()=>undefined);
      await db.ledgerEntry.deleteMany({where:{campaignId}});await db.reservation.deleteMany({where:{campaignId}});await db.attempt.deleteMany({where:{payoutId}});await db.payout.deleteMany({where:{campaignId}});await db.campaign.deleteMany({where:{id:campaignId}});
    }
  },60_000);
});
