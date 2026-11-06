import { describe,it,expect } from 'vitest';
import { FundingControlPoc,InMemoryFundingJournal,SimulatedChainAdapter,SimulatedSigningPolicy } from '../../src/funding-control/funding-control-poc.js';

const now=new Date('2030-01-01T00:00:00.000Z');
const policy={quoteId:'quote-poc',chainId:'sim:funding-poc',sourceAssetId:'sim:usdc',depositAddress:'sim:1click-deposit',maxSourceAmount:100n,feeAssetId:'sim:native',maxNetworkFee:3n,expiresAt:new Date('2030-01-01T00:05:00.000Z')};
const transfer=(amount=90n)=>({quoteId:policy.quoteId,chainId:policy.chainId,sourceAssetId:policy.sourceAssetId,from:'sim:treasury',to:policy.depositAddress,amount,feeAssetId:policy.feeAssetId,networkFee:2n,idempotencyKey:'funding-request-1'});
const setup=()=>{const adapter=new SimulatedChainAdapter();const journal=new InMemoryFundingJournal();const signer=new SimulatedSigningPolicy();return {adapter,journal,signer,service:new FundingControlPoc(adapter,journal,signer,()=>now)};};

describe('local funding-control feasibility PoC',()=>{
  it('rejects an over-limit transfer at the pre-sign policy gate',()=>{
    const {service,signer}=setup();
    expect(()=>service.prepare(policy,transfer(101n))).toThrow(/exceeds authorized maximum/);
    expect(signer.authorizationChecks).toBe(1);
  });

  it('constructs an unsigned simulated transfer within the limit',()=>{
    const {service}=setup();
    const record=service.prepare(policy,transfer());
    expect(record.unsigned.encoded).toContain('"amount":"90"');
    expect(record.state).toBe('PREPARED');
    expect(record.remainingExposure).toBe(100n);
  });

  it('blocks a duplicate submission claim, including after service reconstruction',()=>{
    const {adapter,journal,signer,service}=setup();
    service.prepare(policy,transfer());
    service.claimSubmission('funding-request-1');
    const restarted=new FundingControlPoc(adapter,journal,signer,()=>now);
    expect(()=>restarted.claimSubmission('funding-request-1')).toThrow(/already claimed or is unresolved/);
  });

  it('independently checks simulated transaction evidence against the authorized transfer',()=>{
    const {adapter,service}=setup();
    const record=service.prepare(policy,transfer());
    const valid=adapter.evidenceFor(record.proposal,2);
    expect(service.observeEvidence('funding-request-1',valid).state).toBe('CHAIN_CONFIRMED');
    const tampered={...valid,amount:91n};
    expect(()=>service.observeEvidence('funding-request-1',tampered)).toThrow(/does not match/);
  });

  it('retains the full reservation when outcome is uncertain across service restart',()=>{
    const {adapter,journal,signer,service}=setup();
    service.prepare(policy,transfer());
    service.claimSubmission('funding-request-1');
    expect(service.markUnknown('funding-request-1').remainingExposure).toBe(100n);
    const restarted=new FundingControlPoc(adapter,journal,signer,()=>now);
    expect(restarted.markUnknown('funding-request-1').remainingExposure).toBe(100n);
    expect(()=>restarted.claimSubmission('funding-request-1')).toThrow(/already claimed or is unresolved/);
  });

  it('counts a same-asset network fee within the authorized source debit',()=>{
    const {adapter,journal,signer}=setup();
    const sameAssetPolicy={...policy,feeAssetId:policy.sourceAssetId,maxNetworkFee:15n};
    const over={...transfer(90n),feeAssetId:policy.sourceAssetId,networkFee:11n};
    const service=new FundingControlPoc(adapter,journal,signer,()=>now);
    expect(()=>service.prepare(sameAssetPolicy,over)).toThrow(/Combined source-asset debit/);
  });
});
