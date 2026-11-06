import { it,expect } from 'vitest';
import { calculateExposure } from '../../src/budget/budget-calculator.js';
const usdc={assetId:'usdc:ethereum',chain:'ethereum',decimals:6};const m=1_000_000n;
it('reproduces budget rejection and valid 92 USDC campaign in six-decimal atomic units',()=>{const quotes=(ns:bigint[])=>ns.map(n=>({atomic:n*m,asset:usdc}));expect(()=>calculateExposure({approved:100n*m,denomination:usdc,quotes:quotes([21n,21n,21n,20n,20n]),separatelyPayableFees:[]})).toThrow();expect(calculateExposure({approved:100n*m,denomination:usdc,quotes:quotes([19n,19n,18n,18n,18n]),separatelyPayableFees:[]})).toBe(92n*m);});
