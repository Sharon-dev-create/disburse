import type { Hex } from 'viem';
import type { PrismaClient } from '@prisma/client';
import type { EvmChainAdapter } from './evm-chain-adapter.js';
import { assertAuthorizedErc20Transfer, type EvmUnsignedTransfer } from './policy.js';

export interface EvmSigner { readonly address:string; sign(requestId:string,tx:EvmUnsignedTransfer):Promise<Hex>; }

/** Anvil-only signer: final policy is reloaded from PostgreSQL immediately before signing. */
export class PolicyCheckedAnvilSigner implements EvmSigner {
  readonly address:string;
  constructor(private readonly db:PrismaClient,private readonly chain:EvmChainAdapter,address:string){this.address=address;}
  async sign(requestId:string,tx:EvmUnsignedTransfer):Promise<Hex>{
    const op=await this.db.evmFundingOperation.findUnique({where:{id:requestId},include:{campaign:true,payout:true,attempt:true,reservation:true}});
    if(!op)throw new Error('Funding authorization no longer exists');
    assertAuthorizedErc20Transfer({operation:op,campaign:op.campaign,payout:op.payout,attempt:op.attempt,reservation:op.reservation},tx,new Date());
    if(tx.account.toLowerCase()!==this.address.toLowerCase())throw new Error('Transaction source does not match local signer');
    return this.chain.signThroughUnlockedLocalNode(tx);
  }
}
