import {createRequire} from 'node:module';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {NativeReconciliationRepository as Fixed} from '/home/topg/disburse/execution-service/src/reconciliation/postgres.ts';
import {NativeReconciliationRepository as Baseline} from './baseline/postgres.ts';
const require=createRequire('/home/topg/disburse/execution-service/package.json');const {Pool}=require('pg');
const p=new Pool({connectionString:'postgresql://disburse_test@127.0.0.1:19545/disburse_test'});
const f=JSON.parse(fs.readFileSync('/home/topg/disburse/docs/evidence/milestone-5/m5d/sandbox/successful-transfer.json'));
const results=[];
try {for (const [label,Class] of [['baseline',Baseline],['current',Fixed]]) {
const repo=new Class(p);const key=await repo.enqueue({...f.identity,chainId:'m5d2-'+randomUUID()},f.locator);const claim=await repo.claim('audit-A',500,key);
const initial=(await p.query('SELECT state,fence::text,lease_until,clock_timestamp() AS observed FROM native_reconciliation_jobs WHERE job_key=$1',[key])).rows[0];
const b=await p.connect();await b.query('BEGIN');await b.query('SELECT * FROM native_reconciliation_jobs WHERE job_key=$1 FOR UPDATE',[key]);const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
const started=performance.now();const completing=repo.complete(claim,{classification:'ManualReview',reason:'audit',transferReceiptId:null,callbackReceiptId:null,semanticDigest:null,trust:'TRUSTED_RPC_OBSERVATION_NOT_ON_CHAIN_PROOF',conflicting:false,observations:[]}).then(()=>({accepted:true}),e=>({accepted:false,error:e.message}));
let blocked=false;for(let k=0;k<300;k++){if((await p.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS b',[pid])).rows[0].b){blocked=true;break;}await p.query('SELECT pg_sleep(0.01)');}if(!blocked)throw Error('No actual blocking barrier');
const beforeHold=(await p.query('SELECT clock_timestamp() AS t')).rows[0].t;await p.query('SELECT pg_sleep(0.9)');await b.query('COMMIT');b.release();const result=await completing;
const h=await repo.history(key);results.push({label,initial,blocked,beforeHold,elapsedMs:performance.now()-started,result,job:h.job,observations:h.observations.length,decisions:h.decisions.length,receiptClaims:(await p.query('SELECT count(*) FROM native_reconciliation_receipt_claims WHERE job_key=$1',[key])).rows[0].count,transactionClaims:(await p.query('SELECT count(*) FROM native_reconciliation_transaction_claims WHERE job_key=$1',[key])).rows[0].count});}
console.log(JSON.stringify(results,null,2));}finally{await p.end();}
