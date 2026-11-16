"""Run fresh local receipt tests, controlled failures and two authenticated WASM upgrades."""
import argparse,json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'docs/evidence/milestone-5/m5c-implementation'
p=argparse.ArgumentParser();p.add_argument('--sandbox-bin',required=True);args=p.parse_args()
for phase in ['main','faults','b-migration']:
 cmd=[sys.executable,str(ROOT/'tests/sandbox/with_node.py'),'--sandbox-bin',args.sandbox_bin,'--phase',phase]
 if phase=='faults':cmd+=['--existing-home',json.loads((OUT/'node-main.json').read_text())['home']]
 with (OUT/('sandbox-'+phase+'.log')).open('w') as log:result=subprocess.run(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
 print('sandbox',phase,'exit',result.returncode,flush=True)
 if result.returncode:raise SystemExit(result.returncode)
(OUT/'all-sandbox-suites.json').write_text(json.dumps({'result':'PASS','phases':['main','faults','b-migration'],'actual_local_receipts_executed':True,'no_public_chain_transactions':True},indent=2)+'\n')
