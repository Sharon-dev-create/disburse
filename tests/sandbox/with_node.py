"""Launch only a private synthetic chain on loopback, run the suite, and stop our node."""
import argparse,copy,json,pathlib,subprocess,sys,tempfile,time,hashlib,os
from local_rpc import *
ROOT=pathlib.Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--sandbox-bin',required=True);p.add_argument('--phase',choices=['main','faults','b-migration','inspect'],default='main');p.add_argument('--existing-home');opts=p.parse_args()
home=pathlib.Path(opts.existing_home) if opts.existing_home else pathlib.Path(tempfile.mkdtemp(prefix='disburse-m5c-local-'))
if not opts.existing_home:
 subprocess.run([opts.sandbox_bin,'--home',str(home),'init','--fast'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 x=json.loads((home/'genesis.json').read_text());x['chain_id']=CHAIN_ID
 original={r['Account']['account_id'] for r in x['records'] if 'Account' in r}
 for account in ACCOUNTS:
  if account in original:continue
  record=copy.deepcopy(x['records'][0]['Account']);record['account_id']=account;record['account']['amount']=str(2000*10**24);record['account']['locked']='0'
  x['records'] += [{'Account':record},{'AccessKey':{'account_id':account,'public_key':'ed25519:'+b58(pub(account)),'access_key':{'nonce':0,'permission':'FullAccess'}}}]
 x['total_supply']=str(sum(int(r['Account']['account']['amount'])+int(r['Account']['account']['locked']) for r in x['records'] if 'Account' in r))
 (home/'genesis.json').write_text(json.dumps(x,indent=2)+'\n')
 c=json.loads((home/'config.json').read_text());c['rpc']['addr']='127.0.0.1:18545';c['network']['addr']='127.0.0.1:18546';c['network']['boot_nodes']='';c['consensus']['min_num_peers']=0
 (home/'config.json').write_text(json.dumps(c,indent=2)+'\n')
if opts.phase=='faults':
 # Widen receipt gaps only in this synthetic node, making the pause interleaving reproducible.
 c=json.loads((home/'config.json').read_text());c['consensus']['min_block_production_delay']={'secs':0,'nanos':700000000};c['consensus']['max_block_production_delay']={'secs':1,'nanos':0}
 (home/'config.json').write_text(json.dumps(c,indent=2)+'\n')
log=(home/'node.log').open('w');node=subprocess.Popen([opts.sandbox_bin,'--home',str(home),'run'],stdout=log,stderr=subprocess.STDOUT)
print('synthetic sandbox home',str(home),flush=True)
try:
 for _ in range(150):
  try:rpc=LocalRPC();break
  except Exception:
   if node.poll() is not None:raise RuntimeError((home/'node.log').read_text()[-3000:])
   time.sleep(.2)
 else:raise RuntimeError('Local node unavailable')
 metadata={'chain_id':CHAIN_ID,'home':str(home),'binary_sha256':hashlib.sha256(pathlib.Path(opts.sandbox_bin).read_bytes()).hexdigest(),'binary_version':subprocess.check_output([opts.sandbox_bin,'--version'],text=True).strip(),'rpc':'http://127.0.0.1:18545','genesis_sha256':hashlib.sha256((home/'genesis.json').read_bytes()).hexdigest(),'phase':opts.phase,'public_fixture_keys_only':True}
 (ROOT/'docs/evidence/milestone-5/m5c-implementation'/('node-'+opts.phase+'.json')).write_text(json.dumps(metadata,indent=2)+'\n')
 runner='collect_runtime_evidence.py' if opts.phase=='inspect' else 'run_native_payout.py' if opts.phase in ['main','faults'] else 'run_b_migration.py'
 args=[sys.executable,str(ROOT/'tests/sandbox'/runner)]
 if runner=='run_native_payout.py':args+=['--phase',opts.phase]
 result=subprocess.run(args,cwd=ROOT)
 sys.exit(result.returncode)
finally:
 node.terminate()
 try:node.wait(timeout=15)
 except subprocess.TimeoutExpired:node.kill();node.wait()
 log.close()
