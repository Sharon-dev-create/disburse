import { describe,it,expect } from 'vitest';
import { calculateExposure } from '../../src/budget/budget-calculator.js';
import { parseAtomic } from '../../src/domain/money.js';
const usdc={assetId:'usdc:eth',chain:'ethereum',decimals:6};
describe('exact budget arithmetic',()=>{
 it('sums max input in integer atomic units and accepts within limit',()=>expect(calculateExposure({approved:100n,denomination:usdc,quotes:[1n,2n,3n].map(atomic=>({atomic,asset:usdc})),separatelyPayableFees:[]})).toBe(6n));
 it('rejects over budget and mixed denominations',()=>{expect(()=>calculateExposure({approved:1n,denomination:usdc,quotes:[{atomic:2n,asset:usdc}],separatelyPayableFees:[]})).toThrow('Budget exceeded');expect(()=>calculateExposure({approved:10n,denomination:usdc,quotes:[{atomic:1n,asset:{...usdc,chain:'base'}}],separatelyPayableFees:[]})).toThrow('Mixed budget');});
 it('rejects zero, negative, malformed amounts and invalid precision',()=>{for(const s of ['0','-1','1.2','01'])expect(()=>parseAtomic(s,6)).toThrow();expect(()=>parseAtomic('1',31)).toThrow();});
 it('keeps decimal arithmetic exact at large magnitudes',()=>expect(parseAtomic('900719925474099312345',6)).toBe(900719925474099312345n));
 it('accounts for separately payable fees',()=>expect(calculateExposure({approved:10n,denomination:usdc,quotes:[{atomic:8n,asset:usdc}],separatelyPayableFees:[{atomic:2n,asset:usdc}]})).toBe(10n));
});
