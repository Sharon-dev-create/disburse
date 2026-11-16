import {createRequire} from 'node:module';import fs from 'node:fs';
import {NativeReconciliationRepository} from '/home/topg/disburse/execution-service/src/reconciliation/postgres.ts';
const require=createRequire('/home/topg/disburse/execution-service/package.json');const {Pool}=require('pg');
const p=new Pool({connectionString:'postgresql://disburse_test@127.0.0.1:19544/disburse_test'});const repo=new NativeReconciliationRepository(p);
const f=JSON.parse(fs.readFileSync('/home/topg/disburse/docs/evidence/milestone-5/m5d/sandbox/successful-transfer.json'));f.identity.chainId='audit-lock-test';
try{const key=await repo.enqueue(f.identity,f.locator);const claim=await repo.claim('audit',500,key);const c=await p.connect();await c.query('BEGIN');await c.query('SELECT * FROM native_reconciliation_jobs WHERE job_key=$1 FOR UPDATE',[key]);
const result=repo.complete(claim,{classification:'ManualReview',reason:'audit',transferReceiptId:null,callbackReceiptId:null,semanticDigest:null,trust:'TRUSTED_RPC_OBSERVATION_NOT_ON_CHAIN_PROOF',conflicting:false,observations:[]}).then(()=>({accepted:true}),e=>({accepted:false,error:e.message}));
await new Promise(r=>setTimeout(r,900));await c.query('COMMIT');c.release();console.log(JSON.stringify(await result));}finally{await p.end();}
