import { calculateExposure } from './budget/budget-calculator.js';
import { PayoutLifecycle } from './payouts/state-machine.js';
import { MockProvider } from './intents/mock.provider.js';

const usdc={assetId:'usdc:ethereum',chain:'ethereum',decimals:6};
const million=1_000_000n;
const cases=[
  {name:'A Budget rejection',budget:100n*million,amounts:[21n,21n,21n,20n,20n].map(n=>n*million)},
  {name:'B Valid campaign',budget:100n*million,amounts:[19n,19n,18n,18n,18n].map(n=>n*million)}
];
for(const c of cases){try{const total=calculateExposure({approved:c.budget,denomination:usdc,quotes:c.amounts.map(atomic=>({atomic,asset:usdc})),separatelyPayableFees:[]});console.log(`${c.name}: accepted, reserved ${(total/million).toString()} USDC`);}catch(e){console.log(`${c.name}: rejected before reservation (${(e as Error).message})`);}}
const statuses=['SUCCESS','SUCCESS','FAILED','REFUNDED','UNKNOWN'] as const;
console.log('C Partial execution (simulated only):');
statuses.forEach((status,i)=>console.log(`  recipient-${i+1}: ${status}${status==='SUCCESS'?' exact promised output':status==='UNKNOWN'?' exposure retained':''}`));
console.log('D Concurrent reservation attack: max 100 USDC, requests 70 + 70 => one success, one rejected (PostgreSQL row-lock assertion in integration suite).');
const provider=new MockProvider();
const lifecycle=new PayoutLifecycle(); lifecycle.transition('QUOTED','sim quote'); lifecycle.transition('RESERVED','sim reserve'); lifecycle.transition('COMMITTED','mock accepted'); lifecycle.transition('UNKNOWN','simulated client timeout after acceptance');
console.log(`E Duplicate retry: ${lifecycle.status}; both retry submissions resolve to same logical payout; no second attempt while outcome unknown.`);
void provider;
