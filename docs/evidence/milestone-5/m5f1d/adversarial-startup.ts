import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startExecutionHost} from '../../../../execution-service/src/host.ts';
const base:NodeJS.ProcessEnv={DISBURSE_EXECUTION_PROFILE:'isolated-testnet',DISBURSE_ACTIVE_TESTNET_READ_ONLY:'true',DISBURSE_EXECUTION_WORKER_ENABLED:'false',DISBURSE_PAYOUT_SUBMISSION_ENABLED:'false',DISBURSE_MAX_PAYOUT_ATOMIC:'0',DISBURSE_POSTGRES_TARGET:'test',DISBURSE_TEST_DATABASE_URL:'postgresql://disburse_test:never-log-this-password@127.0.0.1:19553/disburse_test',NEAR_NETWORK:'testnet',NEAR_RPC_ENDPOINT:'https://rpc.testnet.near.org/?token=never-log-this-token',DISBURSE_CONTRACT_ID:'disburse-test-contract.testnet',DISBURSE_EXECUTION_API_DEMO_TOKEN:'never-log-this-api-token'};
const results:unknown[]=[];
for(const [key,valid] of [['DISBURSE_EXECUTION_PROFILE','isolated-testnet'],['DISBURSE_ACTIVE_TESTNET_READ_ONLY','true'],['DISBURSE_EXECUTION_WORKER_ENABLED','false'],['DISBURSE_PAYOUT_SUBMISSION_ENABLED','false'],['DISBURSE_MAX_PAYOUT_ATOMIC','0']] as const){
 for(const value of [undefined,'',valid.toUpperCase(),` ${valid}`,`${valid} `,'yes','1']){
  if(value===valid)continue;
  let initialized=false;
  await assert.rejects(startExecutionHost({...base,[key]:value},async()=>{initialized=true;}));assert.equal(initialized,false);results.push({key,value:value??'MISSING',rejectedBeforeInitialization:true});
 }
}
for(const [key,value] of [['NEAR_NETWORK','mainnet'],['NEAR_NETWORK','localnet'],['DISBURSE_CONTRACT_ID','disburse-topg.testnet'],['DISBURSE_CONTRACT_ID','disburse-m12.testnet'],['NEAR_RPC_ENDPOINT',''],['NEAR_NETWORK',''],['DISBURSE_CONTRACT_ID',''],['DISBURSE_TEST_DATABASE_URL',''],['DISBURSE_EXECUTION_WORKER_ENABLED','true'],['DISBURSE_PAYOUT_SUBMISSION_ENABLED','true'],['DISBURSE_MAX_PAYOUT_ATOMIC','100000']] as const){
 let initialized=false;await assert.rejects(startExecutionHost({...base,[key]:value},async()=>{initialized=true;}));assert.equal(initialized,false);results.push({key,value,rejectedBeforeInitialization:true});
}
let normalized=false;await startExecutionHost({...base,NEAR_NETWORK:' testnet ',DISBURSE_CONTRACT_ID:' disburse-test-contract.testnet '},async(c)=>{assert.equal(c.contractAccountId,'disburse-test-contract.testnet');normalized=true;});assert.ok(normalized);
const dir=mkdtempSync(join(tmpdir(),'m5f1b-env-'));const file=join(dir,'profile.env');writeFileSync(file,Object.entries(base).map(([k,v])=>`${k}=${v}`).join('\n'));
const cli=spawnSync(process.execPath,[`--env-file=${file}`,'--experimental-strip-types','src/host.ts'],{cwd:'/home/topg/disburse/execution-service',env:{PATH:process.env.PATH,DISBURSE_EXECUTION_WORKER_ENABLED:'true'},encoding:'utf8',timeout:10000});
assert.equal(cli.status,1);assert.match(cli.stderr,/Configuration error: DISBURSE_EXECUTION_WORKER_ENABLED/);for(const secret of ['never-log-this-password','never-log-this-token','never-log-this-api-token'])assert.ok(!cli.stderr.includes(secret));
console.log(JSON.stringify({result:'PASS',negativeStartupCases:results.length,normalizedIdentityChecked:true,realCliConflictRejected:true,realCliStatus:cli.status,secretsAbsentFromDiagnostics:true,cases:results},null,2));
