import { describe,it,expect } from 'vitest';
import { PayoutLifecycle } from '../../src/payouts/state-machine.js';
import { reconcile } from '../../src/payouts/recovery.service.js';
describe('payout lifecycle and reconciliation',()=>{
 it('accepts known transitions and rejects impossible ones',()=>{const p=new PayoutLifecycle();p.transition('QUOTED','quote');p.transition('RESERVED','reserve');expect(()=>p.transition('SUCCESS','unsupported direct settlement')).toThrow('Invalid payout transition');});
 it('requires exact promised output before SUCCESS',()=>expect(()=>reconcile({status:'PROCESSING',promisedOutput:10n,outputAssetId:'out',inputAssetId:'in',reserved:12n},{status:'SUCCESS',updatedAt:new Date(),amountOut:9n,amountIn:11n,originTxHashes:[],destinationTxHashes:[],rawSanitized:{}})).toThrow('does not equal promise'));
 it('does not release exposure on ambiguous provider state',()=>expect(reconcile({status:'UNKNOWN',promisedOutput:10n,outputAssetId:'out',inputAssetId:'in',reserved:12n},{status:'PROCESSING',updatedAt:new Date(),originTxHashes:[],destinationTxHashes:[],rawSanitized:{} }).releaseExposure).toBe(false));
 it('credits only bounded confirmed refund amount',()=>expect(reconcile({status:'REFUND_PENDING',promisedOutput:10n,outputAssetId:'out',inputAssetId:'in',reserved:12n},{status:'REFUNDED',updatedAt:new Date(),refundedAmount:12n,originTxHashes:['sim-refund'],destinationTxHashes:[],rawSanitized:{}}).confirmedRefund).toBe(12n));
 it('rejects refund missing amount',()=>expect(()=>reconcile({status:'REFUND_PENDING',promisedOutput:10n,outputAssetId:'out',inputAssetId:'in',reserved:12n},{status:'REFUNDED',updatedAt:new Date(),originTxHashes:[],destinationTxHashes:[],rawSanitized:{}})).toThrow());
});
