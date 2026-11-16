"""Build local candidate/token/fault fixtures using unchanged locked SDK dependencies.
Historical deployed WASM must have been fetched read-only and authenticated separately.
"""
import pathlib,subprocess,os,hashlib,sys,json
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'docs/evidence/milestone-5/m5c-implementation';ART=pathlib.Path('/tmp/disburse-m5c-artifacts')
assert hashlib.sha256((ART/'historical-deployed.wasm').read_bytes()).hexdigest()=='a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530'
commands=[('build',['cargo','near','build','non-reproducible-wasm','--locked'],None),('token-build',['cargo','near','build','non-reproducible-wasm','--locked','--manifest-path',str(ROOT/'tests/sandbox/token/Cargo.toml'),'--out-dir',str(ART/'token')],str(ROOT/'target/m5c-fixtures'))]
for name,args,target in commands:
 env=dict(os.environ)
 if target:env['CARGO_TARGET_DIR']=target
 with (OUT/(name+'.log')).open('w') as log:subprocess.run(args,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 print('built',name,flush=True)
subprocess.run([sys.executable,str(ROOT/'tests/sandbox/build_variants.py')],cwd=ROOT,check=True)
