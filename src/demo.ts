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
const provider=new MockProvider();
const lifecycle=new PayoutLifecycle(); lifecycle.transition('QUOTED','sim quote'); lifecycle.transition('RESERVED','sim reserve'); lifecycle.transition('COMMITTED','mock accepted'); lifecycle.transition('UNKNOWN','simulated client timeout after acceptance');
let available=100n*million;
const simulatedReserve=async(amount:bigint)=>{await Promise.resolve();if(amount>available)return false;available-=amount;return true;};
const concurrent=await Promise.all([simulatedReserve(70n*million),simulatedReserve(70n*million)]);
console.log(`D Concurrent reservation attack (in-process illustration only): ${concurrent.filter(Boolean).length} accepted, ${concurrent.filter(x=>!x).length} rejected; database guarantee is covered only by the PostgreSQL integration test.`);
const retries=new Map<string,string>();
const retry=async(key:string)=>{const existing=retries.get(key);if(existing)return existing;const quote=await provider.quote({dry:false,swapType:'EXACT_OUTPUT',slippageTolerance:100,originAsset:'sim:usdc',destinationAsset:'sim:out',amount:'100',recipient:'sim:recipient',refundTo:'sim:refund',depositType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',refundType:'ORIGIN_CHAIN',deadline:new Date(Date.now()+600_000).toISOString()});retries.set(key,quote.correlationId);return quote.correlationId;};
await retry('same-retry-request');await retry('same-retry-request');
console.log(`E Duplicate retry: ${lifecycle.status}; mock idempotency key reused once and uncertain outcome remains locked (simulated only).`);
