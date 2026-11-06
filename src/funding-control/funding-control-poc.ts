import { createHash } from 'node:crypto';

export interface FundingPolicy {
  readonly quoteId:string;
  readonly chainId:string;
  readonly sourceAssetId:string;
  readonly depositAddress:string;
  readonly maxSourceAmount:bigint;
  readonly feeAssetId:string;
  readonly maxNetworkFee:bigint;
  readonly expiresAt:Date;
}

export interface ProposedTransfer {
  readonly quoteId:string;
  readonly chainId:string;
  readonly sourceAssetId:string;
  readonly from:string;
  readonly to:string;
  readonly amount:bigint;
  readonly feeAssetId:string;
  readonly networkFee:bigint;
  readonly memo?:string;
  readonly idempotencyKey:string;
}

export interface UnsignedTransfer { readonly encoded:string }
export interface TransferEvidence {
  readonly transactionHash:string;
  readonly encodedTransaction:string;
  readonly chainId:string;
  readonly sourceAssetId:string;
  readonly from:string;
  readonly to:string;
  readonly amount:bigint;
  readonly feeAssetId:string;
  readonly networkFee:bigint;
  readonly confirmations:number;
}

export interface ChainFundingCapabilities {
  readonly chainFamily:'SIMULATED'|'EVM'|'SOLANA'|'NEAR'|'UTXO'|'OTHER';
  readonly networkId:string;
  readonly exactTransferFields:boolean;
  readonly canEnforceMaximumAtIsolatedSigner:boolean;
  readonly canVerifyFinalityIndependently:boolean;
  readonly supportedAssetIds:readonly string[];
}

export interface ChainFundingAdapter {
  readonly capabilities:ChainFundingCapabilities;
  buildUnsignedTransfer(proposal:ProposedTransfer):UnsignedTransfer;
  inspectUnsignedTransfer(tx:UnsignedTransfer):ProposedTransfer;
  verifyEvidence(policy:FundingPolicy,proposal:ProposedTransfer,evidence:TransferEvidence):boolean;
}

export type FundingState='PREPARED'|'SUBMISSION_CLAIMED'|'UNKNOWN'|'CHAIN_CONFIRMED';
export interface FundingRecord {
  readonly fingerprint:string;
  readonly policy:FundingPolicy;
  readonly proposal:ProposedTransfer;
  readonly unsigned:UnsignedTransfer;
  state:FundingState;
  remainingExposure:bigint;
  evidence?:TransferEvidence;
}

/** The PoC journal is deliberately injectable so a replacement service can recover the same durable record. */
export class InMemoryFundingJournal {
  private readonly rows=new Map<string,FundingRecord>();
  get(key:string):FundingRecord|undefined{return this.rows.get(key);}
  insertIfAbsent(key:string,row:FundingRecord):FundingRecord {
    const current=this.rows.get(key);
    if(current)return current;
    this.rows.set(key,row);
    return row;
  }
}

/** Simulated policy signer: validates decoded transaction contents, but never signs or broadcasts. */
export class SimulatedSigningPolicy {
  authorizationChecks=0;
  authorizeBeforeSigning(policy:FundingPolicy,tx:UnsignedTransfer,adapter:ChainFundingAdapter,now:Date):ProposedTransfer {
    this.authorizationChecks++;
    const actual=adapter.inspectUnsignedTransfer(tx);
    if(!adapter.capabilities.canEnforceMaximumAtIsolatedSigner)throw new Error('Adapter does not declare isolated signer maximum enforcement');
    if(now>=policy.expiresAt)throw new Error('Quote authorization is expired');
    if(actual.quoteId!==policy.quoteId||actual.chainId!==policy.chainId||actual.sourceAssetId!==policy.sourceAssetId)throw new Error('Transaction quote, chain, or source asset does not match authorization');
    if(actual.to!==policy.depositAddress)throw new Error('Transaction destination does not match 1Click deposit address');
    if(actual.amount<=0n||actual.amount>policy.maxSourceAmount)throw new Error('Proposed source transfer exceeds authorized maximum');
    if(actual.feeAssetId!==policy.feeAssetId||actual.networkFee<0n||actual.networkFee>policy.maxNetworkFee)throw new Error('Network fee exceeds its separately authorized fee policy');
    if(actual.feeAssetId===actual.sourceAssetId&&actual.amount+actual.networkFee>policy.maxSourceAmount)throw new Error('Combined source-asset debit exceeds authorized maximum');
    return actual;
  }
}

/** Local-only canonical transaction/evidence simulator; its capabilities do not represent a production chain. */
export class SimulatedChainAdapter implements ChainFundingAdapter {
  readonly capabilities:ChainFundingCapabilities={chainFamily:'SIMULATED',networkId:'sim:funding-poc',exactTransferFields:true,canEnforceMaximumAtIsolatedSigner:true,canVerifyFinalityIndependently:true,supportedAssetIds:['sim:usdc']};
  buildUnsignedTransfer(proposal:ProposedTransfer):UnsignedTransfer{return {encoded:encode(proposal)};}
  inspectUnsignedTransfer(tx:UnsignedTransfer):ProposedTransfer {
    const parsed=JSON.parse(tx.encoded) as Omit<ProposedTransfer,'amount'|'networkFee'> & {amount:string;networkFee:string};
    if(!/^(0|[1-9]\d*)$/.test(parsed.amount)||!/^(0|[1-9]\d*)$/.test(parsed.networkFee))throw new Error('Malformed simulated transaction amounts');
    return {...parsed,amount:BigInt(parsed.amount),networkFee:BigInt(parsed.networkFee)};
  }
  evidenceFor(proposal:ProposedTransfer,confirmations:number):TransferEvidence {
    const encodedTransaction=encode(proposal);
    return {transactionHash:hash(encodedTransaction),encodedTransaction,chainId:proposal.chainId,sourceAssetId:proposal.sourceAssetId,from:proposal.from,to:proposal.to,amount:proposal.amount,feeAssetId:proposal.feeAssetId,networkFee:proposal.networkFee,confirmations};
  }
  verifyEvidence(policy:FundingPolicy,proposal:ProposedTransfer,evidence:TransferEvidence):boolean {
    return this.capabilities.canVerifyFinalityIndependently&&evidence.transactionHash===hash(evidence.encodedTransaction)
      &&evidence.chainId===policy.chainId&&evidence.chainId===proposal.chainId
      &&evidence.sourceAssetId===policy.sourceAssetId&&evidence.sourceAssetId===proposal.sourceAssetId
      &&evidence.from===proposal.from&&evidence.to===policy.depositAddress&&evidence.to===proposal.to
      &&evidence.amount===proposal.amount&&evidence.amount<=policy.maxSourceAmount
      &&evidence.feeAssetId===policy.feeAssetId&&evidence.networkFee<=policy.maxNetworkFee
      &&evidence.confirmations>=2&&evidence.encodedTransaction===encode(proposal);
  }
}

export class FundingControlPoc {
  constructor(private readonly adapter:ChainFundingAdapter,private readonly journal:InMemoryFundingJournal,private readonly signerPolicy:SimulatedSigningPolicy,private readonly now:()=>Date=()=>new Date()){}

  prepare(policy:FundingPolicy,proposal:ProposedTransfer):FundingRecord {
    const fingerprint=hash(encode(proposal));
    const existing=this.journal.get(proposal.idempotencyKey);
    if(existing){if(existing.fingerprint!==fingerprint||existing.policy.quoteId!==policy.quoteId)throw new Error('Idempotency key was already used for a different transfer');return existing;}
    if(!this.adapter.capabilities.supportedAssetIds.includes(proposal.sourceAssetId))throw new Error('Source asset is not enabled by this chain adapter');
    const unsigned=this.adapter.buildUnsignedTransfer(proposal);
    this.signerPolicy.authorizeBeforeSigning(policy,unsigned,this.adapter,this.now());
    const record:FundingRecord={fingerprint,policy,proposal,unsigned,state:'PREPARED',remainingExposure:policy.maxSourceAmount};
    return this.journal.insertIfAbsent(proposal.idempotencyKey,record);
  }

  claimSubmission(key:string):FundingRecord {
    const record=this.journal.get(key);if(!record)throw new Error('Funding record not found');
    if(record.state!=='PREPARED')throw new Error('Transfer submission was already claimed or is unresolved');
    record.state='SUBMISSION_CLAIMED';return record;
  }

  markUnknown(key:string):FundingRecord {
    const record=this.journal.get(key);if(!record)throw new Error('Funding record not found');
    if(record.state==='CHAIN_CONFIRMED')return record;
    record.state='UNKNOWN';record.remainingExposure=record.policy.maxSourceAmount;return record;
  }

  observeEvidence(key:string,evidence:TransferEvidence):FundingRecord {
    const record=this.journal.get(key);if(!record)throw new Error('Funding record not found');
    if(!this.adapter.verifyEvidence(record.policy,record.proposal,evidence))throw new Error('Independent chain evidence does not match authorized transfer');
    record.evidence=evidence;record.state='CHAIN_CONFIRMED';record.remainingExposure=evidence.amount;return record;
  }
}

function encode(proposal:ProposedTransfer):string {
  return JSON.stringify({quoteId:proposal.quoteId,chainId:proposal.chainId,sourceAssetId:proposal.sourceAssetId,from:proposal.from,to:proposal.to,amount:proposal.amount.toString(),feeAssetId:proposal.feeAssetId,networkFee:proposal.networkFee.toString(),...(proposal.memo!==undefined?{memo:proposal.memo}:{}),idempotencyKey:proposal.idempotencyKey});
}
function hash(value:string):string{return createHash('sha256').update(value).digest('hex');}
