import { Prisma, PrismaClient, type EvmFundingOperation } from '@prisma/client';
import { decodeEventLog, getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex } from 'viem';
import type { EvmChainAdapter, EvmGasPolicy, EvmTokenConfig } from './evm-chain-adapter.js';
import { erc20FundingAbi } from './erc20.js';
import { assertAuthorizedErc20Transfer, type EvmFundingOperationContext, type EvmUnsignedTransfer } from './policy.js';
import type { EvmSigner } from './signer.js';
import type { SignedTransactionCipher } from './signed-tx-cipher.js';

export interface AuthorizeEvmFundingInput { readonly reservationId:string; readonly idempotencyKey:string; }
export interface EvmFundingSummary { readonly id:string;readonly state:string;readonly txHash:string|null;readonly chainId:string;readonly nonce:string;readonly tokenAmount:string; }
export interface EvmFundingPolicy {readonly signerAddress:Address;readonly token:EvmTokenConfig;readonly gas:EvmGasPolicy;readonly confirmations:bigint;}

const publicSelect={id:true,state:true,txHash:true,chainId:true,nonce:true,tokenAmount:true} as const;
function summary(op:Pick<EvmFundingOperation,'id'|'state'|'txHash'|'chainId'|'nonce'|'tokenAmount'>):EvmFundingSummary{return{id:op.id,state:op.state,txHash:op.txHash,chainId:op.chainId.toString(),nonce:op.nonce.toString(),tokenAmount:op.tokenAmount.toString()};}

export class EvmFundingService {
  constructor(private readonly db:PrismaClient,private readonly chain:EvmChainAdapter,private readonly signer:EvmSigner,private readonly cipher:SignedTransactionCipher,private readonly policy:EvmFundingPolicy){}

  async authorizeAndSubmit(input:AuthorizeEvmFundingInput):Promise<EvmFundingSummary>{
    if(!input.idempotencyKey.trim())throw new Error('An idempotency key is required');
    await this.chain.assertChainAndToken();
    let op=await this.db.evmFundingOperation.findUnique({where:{idempotencyKey:input.idempotencyKey}});
    if(op){if(op.reservationId!==input.reservationId)throw new Error('Idempotency key is already bound to another reservation');return this.resume(op);}
    const reservation=await this.db.reservation.findUnique({where:{id:input.reservationId},include:{campaign:true,payout:true,attempt:true}});
    if(!reservation||!reservation.payout||!reservation.attempt)throw new Error('An active payout reservation is required');
    const {campaign,payout,attempt}=reservation;
    if(campaign.status!=='APPROVED'||reservation.status!=='ACTIVE'||reservation.remainingAmount!==reservation.amount||reservation.amount<=0n)throw new Error('Reservation is not eligible for funding');
    if(attempt.inputAssetId!==campaign.assetId||attempt.inputAssetId!==this.policy.token.assetId||attempt.inputChain!==this.policy.token.sourceChain||attempt.depositAddress===null||!attempt.expiresAt||attempt.expiresAt<=new Date())throw new Error('Attempt source asset, chain, destination, or quote expiry is invalid');
    if(reservation.amount!==attempt.maxAmountIn||attempt.outputAmount!==payout.promisedAmount||!['RESERVED','COMMITTED'].includes(payout.status)||payout.activeExposure<reservation.amount)throw new Error('Reservation does not match persisted payout authorization');
    const pending=await this.chain.getPendingNonce(this.policy.signerAddress);
    const unsigned=await this.chain.buildUnsignedTransfer({from:this.policy.signerAddress,to:getAddress(attempt.depositAddress),amount:reservation.amount,nonce:pending,gasPolicy:this.policy.gas});
    op=await this.createOperation(input, unsigned, {reservation,campaign,payout,attempt},pending);
    return this.resume(op);
  }

  private async createOperation(input:AuthorizeEvmFundingInput,tx:EvmUnsignedTransfer,ctx:{reservation:NonNullable<Awaited<ReturnType<PrismaClient['reservation']['findUnique']>>> & {campaign:unknown;payout:unknown;attempt:unknown};campaign:any;payout:any;attempt:any},pending:number):Promise<EvmFundingOperation>{
    return this.db.$transaction(async db=>{
      const rows=await db.$queryRaw<Array<{id:string}>>`SELECT "id" FROM "Campaign" WHERE "id"=${ctx.campaign.id} FOR UPDATE`;
      if(!rows.length)throw new Error('Campaign disappeared during authorization');
      await db.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id"=${input.reservationId} FOR UPDATE`;
      const fresh=await db.reservation.findUnique({where:{id:input.reservationId},include:{campaign:true,payout:true,attempt:true}});
      if(!fresh||!fresh.payout||!fresh.attempt||fresh.status!=='ACTIVE'||fresh.remainingAmount!==fresh.amount||fresh.amount!==ctx.reservation.amount||fresh.attempt.expiresAt===null||fresh.attempt.expiresAt<=new Date())throw new Error('Reservation changed before authorization');
      let cursor=await db.evmNonceCursor.findUnique({where:{chainId_sourceAddress:{chainId:BigInt(this.policy.token.chainId),sourceAddress:this.policy.signerAddress.toLowerCase()}}});
      if(!cursor)cursor=await db.evmNonceCursor.create({data:{chainId:BigInt(this.policy.token.chainId),sourceAddress:this.policy.signerAddress.toLowerCase(),nextNonce:BigInt(pending)}});
      const nonce=Number(cursor.nextNonce>BigInt(pending)?cursor.nextNonce:BigInt(pending));
      if(!Number.isSafeInteger(nonce))throw new Error('Source nonce exceeds safe transaction range');
      const actualTx=nonce===tx.nonce?tx:await this.chain.buildUnsignedTransfer({from:this.policy.signerAddress,to:getAddress(fresh.attempt.depositAddress!),amount:fresh.amount,nonce,gasPolicy:this.policy.gas});
      const made=await db.evmFundingOperation.create({data:{campaignId:fresh.campaignId,payoutId:fresh.payoutId!,attemptId:fresh.attemptId!,reservationId:fresh.id,idempotencyKey:input.idempotencyKey,chainId:BigInt(this.policy.token.chainId),sourceAssetId:this.policy.token.assetId,sourceChain:this.policy.token.sourceChain,sourceAddress:this.policy.signerAddress.toLowerCase(),tokenAddress:this.policy.token.tokenAddress.toLowerCase(),tokenAmount:fresh.amount,tokenDecimals:this.policy.token.decimals,destinationAddress:getAddress(fresh.attempt.depositAddress!),quoteExpiresAt:fresh.attempt.expiresAt!,nonce:BigInt(nonce),gasLimit:actualTx.gas,maxFeePerGas:actualTx.maxFeePerGas,maxPriorityFeePerGas:actualTx.maxPriorityFeePerGas,maxGasLimit:this.policy.gas.maxGasLimit,maxFeePerGasCap:this.policy.gas.maxFeePerGas,maxPriorityFeePerGasCap:this.policy.gas.maxPriorityFeePerGas,maxNativeGasCost:this.policy.gas.maxNativeGasCost,state:'AUTHORIZED',authorizedAt:new Date()}});
      await db.evmNonceCursor.update({where:{id:cursor.id},data:{nextNonce:BigInt(nonce+1)}});
      return made;
    },{isolationLevel:'Serializable'});
  }

  private async loadContext(id:string):Promise<EvmFundingOperationContext>{const op=await this.db.evmFundingOperation.findUnique({where:{id},include:{campaign:true,payout:true,attempt:true,reservation:true}});if(!op)throw new Error('Funding operation not found');return{operation:op,campaign:op.campaign,payout:op.payout,attempt:op.attempt,reservation:op.reservation};}
  private toTx(ctx:EvmFundingOperationContext):EvmUnsignedTransfer{return{account:getAddress(ctx.operation.sourceAddress),chainId:Number(ctx.operation.chainId),to:getAddress(ctx.operation.tokenAddress),data:(awaitTransferData(ctx.operation.destinationAddress,ctx.operation.tokenAmount)),value:0n,nonce:Number(ctx.operation.nonce),gas:ctx.operation.gasLimit,maxFeePerGas:ctx.operation.maxFeePerGas,maxPriorityFeePerGas:ctx.operation.maxPriorityFeePerGas};}

  private async resume(initial:EvmFundingOperation):Promise<EvmFundingSummary>{
    let op=await this.db.evmFundingOperation.findUniqueOrThrow({where:{id:initial.id}});
    if(op.state==='CONFIRMED'||op.state==='FAILED'||op.state==='REJECTED')return summary(op);
    if(!op.signedTxCiphertext){
      const ctx=await this.loadContext(op.id);const tx=this.toTx(ctx);assertAuthorizedErc20Transfer(ctx,tx,new Date());
      const raw=await this.signer.sign(op.id,tx);
      const parsed=parseTransaction(raw as `0x02${string}`);
      const recovered=await recoverTransactionAddress({serializedTransaction:raw as `0x02${string}`});
      const signedGas=parsed.gas??0n;const signedMaxFee=parsed.maxFeePerGas??0n;const signedPriority=parsed.maxPriorityFeePerGas??0n;
      if(!parsed.to||getAddress(recovered)!==getAddress(op.sourceAddress)||parsed.chainId!==Number(op.chainId)||parsed.nonce!==Number(op.nonce)||getAddress(parsed.to)!==getAddress(op.tokenAddress)||(parsed.value??0n)!==0n||(parsed.data??'0x').toLowerCase()!==tx.data.toLowerCase()||signedGas!==op.gasLimit||signedGas>op.maxGasLimit||signedMaxFee>op.maxFeePerGasCap||signedPriority>op.maxPriorityFeePerGasCap||signedPriority>signedMaxFee||signedGas*signedMaxFee>op.maxNativeGasCost||parsed.accessList?.length)throw new Error('Signer produced a transaction that differs from persisted authorization');
      const encrypted=this.cipher.encrypt(raw);const hash=keccak256(raw);
      op=await this.db.evmFundingOperation.update({where:{id:op.id,state:'AUTHORIZED'},data:{signedTxCiphertext:encrypted.ciphertext,signedTxIv:encrypted.iv,signedTxAuthTag:encrypted.authTag,txHash:hash,state:'SIGNED',signedAt:new Date()}});
    }
    const raw=this.cipher.decrypt({ciphertext:op.signedTxCiphertext!,iv:op.signedTxIv!,authTag:op.signedTxAuthTag!});
    try{const hash=await this.chain.broadcast(raw);if(hash.toLowerCase()!==op.txHash?.toLowerCase())throw new Error('Broadcast hash differs from persisted signed transaction');op=await this.db.evmFundingOperation.update({where:{id:op.id},data:{state:'BROADCAST',broadcastAt:op.broadcastAt??new Date(),failureReason:null}});}
    catch(error){const known=op.txHash?await this.chain.publicClient.getTransaction({hash:op.txHash as Hex}).catch(()=>null):null;if(known){op=await this.db.evmFundingOperation.update({where:{id:op.id},data:{state:'BROADCAST',broadcastAt:op.broadcastAt??new Date(),failureReason:null}});}else{op=await this.db.evmFundingOperation.update({where:{id:op.id},data:{state:'UNKNOWN',failureReason:error instanceof Error?error.message:'Broadcast outcome unknown'}});}}
    return summary(op);
  }

  async reconcile(id:string):Promise<EvmFundingSummary>{
    let op=await this.db.evmFundingOperation.findUniqueOrThrow({where:{id},include:{campaign:true,payout:true,attempt:true,reservation:true}});
    if(!op.txHash)return summary(op);
    const hash=op.txHash as Hex;const tx=await this.chain.publicClient.getTransaction({hash}).catch(()=>null);const receipt=await this.chain.publicClient.getTransactionReceipt({hash}).catch(()=>null);
    if(!tx){if(op.state==='CONFIRMED'){await this.reverseIfPreviouslyObserved(op,op.lastObservedBlockHash??'unknown');return summary(await this.db.evmFundingOperation.update({where:{id},data:{state:'REORGED',failureReason:'Previously confirmed transaction is no longer available from the chain RPC',reconciledAt:new Date()}}));}return summary(await this.db.evmFundingOperation.update({where:{id},data:{state:'UNKNOWN',reconciledAt:new Date()}}));}
    if(!receipt){if(op.state==='CONFIRMED'){await this.reverseIfPreviouslyObserved(op,op.lastObservedBlockHash??'unknown');return summary(await this.db.evmFundingOperation.update({where:{id},data:{state:'REORGED',failureReason:'Previously confirmed transaction no longer has a receipt',reconciledAt:new Date()}}));}return summary(await this.db.evmFundingOperation.update({where:{id},data:{state:'CONFIRMING',reconciledAt:new Date()}}));}
    const ctx: EvmFundingOperationContext={operation:op,campaign:op.campaign,payout:op.payout,attempt:op.attempt,reservation:op.reservation};const expected=this.toTx(ctx);
    if(tx.chainId!==Number(op.chainId)||getAddress(tx.from)!==getAddress(op.sourceAddress)||!tx.to||getAddress(tx.to)!==getAddress(op.tokenAddress)||tx.input.toLowerCase()!==expected.data.toLowerCase()||tx.value!==0n||tx.nonce!==Number(op.nonce))throw new Error('Chain transaction evidence does not match funding authorization');
    if(receipt.status!=='success')return summary(await this.db.evmFundingOperation.update({where:{id},data:{state:'FAILED',failureReason:'Source-chain transaction reverted',reconciledAt:new Date()}}));
    const transfers=receipt.logs.filter(log=>getAddress(log.address)===getAddress(op.tokenAddress)).flatMap(log=>{try{const decoded=decodeEventLog({abi:erc20FundingAbi,eventName:'Transfer',data:log.data,topics:log.topics});return decoded.args.from&&decoded.args.to&&decoded.args.value!==undefined?[decoded.args]:[];}catch{return[];}});
    if(transfers.length!==1||getAddress(transfers[0]!.from)!==getAddress(op.sourceAddress)||getAddress(transfers[0]!.to)!==getAddress(op.destinationAddress)||transfers[0]!.value!==op.tokenAmount)throw new Error('Receipt lacks exactly one matching ERC-20 Transfer event');
    const canonical=await this.chain.publicClient.getBlock({blockNumber:receipt.blockNumber});
    if(canonical.hash!==receipt.blockHash){await this.reverseIfPreviouslyObserved(op,receipt.blockHash);return summary(await this.db.evmFundingOperation.update({where:{id},data:{state:'REORGED',failureReason:'Receipt block is not canonical',reconciledAt:new Date()}}));}
    const head=await this.chain.publicClient.getBlockNumber();const depth=head-receipt.blockNumber+1n;
    if(depth<this.policy.confirmations)return summary(await this.db.evmFundingOperation.update({where:{id},data:{state:'CONFIRMING',lastObservedBlock:receipt.blockNumber,lastObservedBlockHash:receipt.blockHash,reconciledAt:new Date()}}));
    await this.db.$transaction(async db=>{const fresh=await db.evmFundingOperation.findUniqueOrThrow({where:{id}});if(fresh.state==='CONFIRMED')return;await db.ledgerEntry.createMany({data:[{campaignId:op.campaignId,payoutId:op.payoutId,attemptId:op.attemptId,type:'DEPOSIT_OBSERVED',amount:op.tokenAmount,assetId:op.sourceAssetId,externalRef:`evm-deposit:${op.id}`,metadata:{txHash:hash,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,chainId:op.chainId.toString(),tokenAddress:op.tokenAddress}}],skipDuplicates:true});await db.evmFundingOperation.update({where:{id},data:{state:'CONFIRMED',confirmedAt:new Date(),reconciledAt:new Date(),lastObservedBlock:receipt.blockNumber,lastObservedBlockHash:receipt.blockHash,failureReason:null}});},{isolationLevel:'Serializable'});
    return summary(await this.db.evmFundingOperation.findUniqueOrThrow({where:{id}}));
  }

  private async reverseIfPreviouslyObserved(op:EvmFundingOperation,blockHash:string):Promise<void>{await this.db.$transaction(async db=>{await db.ledgerEntry.createMany({data:[{campaignId:op.campaignId,payoutId:op.payoutId,attemptId:op.attemptId,type:'DEPOSIT_REVERSED',amount:op.tokenAmount,assetId:op.sourceAssetId,externalRef:`evm-reorg:${op.id}:${blockHash}`,metadata:{txHash:op.txHash,orphanedBlockHash:blockHash}}],skipDuplicates:true});const reservation=await db.reservation.findUnique({where:{id:op.reservationId}});if(reservation&&reservation.remainingAmount<reservation.amount){const restore=reservation.amount-reservation.remainingAmount;await db.reservation.update({where:{id:reservation.id},data:{remainingAmount:reservation.amount,status:'ACTIVE',releasedAt:null}});await db.payout.update({where:{id:op.payoutId},data:{activeExposure:{increment:restore},status:'UNKNOWN'}});await db.payoutEvent.create({data:{payoutId:op.payoutId,fromStatus:'UNKNOWN',toStatus:'UNKNOWN',note:'Previously confirmed source deposit was removed by a chain reorganization; exposure restored for manual reconciliation',txHash:op.txHash}});}});}
}

function awaitTransferData(destination:string,amount:bigint):Hex {return `0xa9059cbb${destination.toLowerCase().replace(/^0x/,'').padStart(64,'0')}${amount.toString(16).padStart(64,'0')}` as Hex;}
