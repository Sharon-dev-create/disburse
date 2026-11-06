import { it,expect } from 'vitest';
import { balances } from '../../src/budget/ledger.service.js';
it('does not make pending refunds available',()=>{const b=balances([{type:'APPROVED',amount:100n,reference:'a',confirmed:true},{type:'RESERVED',amount:50n,reference:'b',confirmed:true},{type:'REFUND_PENDING',amount:50n,reference:'c',confirmed:false}]);expect(b.available).toBe(50n);expect(b.refunded).toBe(0n);expect(b.unresolved).toBe(50n);});
it('does not double count an observed deposit already covered by its active reservation',()=>{const b=balances([{type:'APPROVED',amount:100n,reference:'a',confirmed:true},{type:'RESERVED',amount:50n,reference:'b',confirmed:true},{type:'DEPOSITED',amount:40n,reference:'c',confirmed:true}]);expect(b.unresolved).toBe(50n);expect(b.available).toBe(50n);});
