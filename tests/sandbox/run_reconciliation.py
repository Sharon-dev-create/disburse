"""Reproduce M5-D in private synthetic nodes and an explicitly configured local test DB.
Requires the pinned artifacts built for C; never fetches public code or uses real keys.
Does not start production workers or change application configuration.
"""
import pathlib,shutil,subprocess,sys,tempfile,json,time,os,hashlib,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/evidence/milestone-5/m5d';OUT.mkdir(parents=True,exist_ok=True)
BIN=pathlib.Path('/tmp/disburse-m5c-tools/Linux-x86_64/near-sandbox')
assert hashlib.sha256(BIN.read_bytes()).hexdigest()=='797b9d7a9a23907048d68a427e86a55c94f1de232dbfb8b8a1eec09ecef3bf13'
assert hashlib.sha256((ROOT/'target/near/disburse_contract.wasm').read_bytes()).hexdigest()=='37e432600c43d5fc7d44b2d81bc9a852d5e120a7dc043c7f06f83d1e62a24ea9'
u=urllib.parse.urlparse(os.environ.get('DISBURSE_TEST_DATABASE_URL',''))
assert u.hostname in ['localhost','127.0.0.1','::1'] and u.path=='/disburse_test' and u.username=='disburse_test','Explicit dedicated local test database required'
work=pathlib.Path(tempfile.mkdtemp(prefix='disburse-m5d-retained-'))
shutil.copytree(ROOT/'tests/sandbox',work/'tests/sandbox',ignore=shutil.ignore_patterns('__pycache__','target'))
(work/'target').mkdir();(work/'target/near').symlink_to(ROOT/'target/near',target_is_directory=True)
evidence=work/'docs/evidence/milestone-5/m5c-implementation';evidence.mkdir(parents=True)
p=work/'tests/sandbox/with_node.py';s=p.read_text();needle="c['rpc']['addr']='127.0.0.1:18545'";assert needle in s
p.write_text(s.replace(needle,"c['gc_num_epochs_to_keep']=100000;"+needle))
def run(cmd,name,cwd=ROOT,env=None):
 with (OUT/(name+'.log')).open('w') as log:subprocess.run(cmd,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
run([sys.executable,str(work/'tests/sandbox/run_suite.py'),'--sandbox-bin',str(BIN)],'retained-receipt-suite')
shutil.copytree(evidence,OUT/'fresh-receipt-suite',dirs_exist_ok=True)
home=json.loads((evidence/'node-main.json').read_text())['home']
from local_rpc import LocalRPC
log=(OUT/'read-only-node.log').open('w');node=subprocess.Popen([str(BIN),'--home',home,'run'],stdout=log,stderr=subprocess.STDOUT)
try:
 for _ in range(150):
  try:LocalRPC();break
  except Exception:
   if node.poll() is not None:raise RuntimeError('Synthetic node failed')
   time.sleep(.2)
 else:raise RuntimeError('Synthetic node unavailable')
 env=dict(os.environ);env['DISBURSE_NATIVE_FIXTURE_ROOT']=(evidence/'sandbox').as_uri()+'/'
 run(['node','--experimental-strip-types','tests/integration/native-capture.ts'],'capture',ROOT/'execution-service',env)
 run(['pnpm','db:migrate:test'],'test-migrations',ROOT/'execution-service',env)
 run(['pnpm','test'],'service-tests',ROOT/'execution-service',env)
 run(['pnpm','test:postgres'],'postgres-tests',ROOT/'execution-service',env)
 run(['node','--experimental-strip-types','--test','tests/integration/native-live.test.ts'],'live-read-only-tests',ROOT/'execution-service',env)
 run([sys.executable,str(ROOT/'tests/sandbox/native_reconciliation_race.py')],'callback-observer-race',ROOT,env)
 (OUT/'reproduction-result.json').write_text(json.dumps({'result':'PASS','chain_id':'disburse-m5c-local','suite_work':str(work),
   'gc_num_epochs_to_keep':100000,'new_public_transactions':0,'production_workers_started':0,'local_fixture_transfers_only':True},indent=2)+'\n')
finally:
 node.terminate()
 try:node.wait(timeout=15)
 except subprocess.TimeoutExpired:node.kill();node.wait()
 log.close()
