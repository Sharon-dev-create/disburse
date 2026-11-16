"""Build isolated, auditable fault-injection artifacts; never adds hooks to production code.
Artifact source copies and logs are saved in /tmp. SDK/dependency versions remain unchanged.
"""
import pathlib,shutil,subprocess,os,json,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
ART=pathlib.Path('/tmp/disburse-m5c-artifacts');ART.mkdir(exist_ok=True)
OUT=ROOT/'docs/evidence/milestone-5/m5c-implementation'
manifest=[]
for name in ['panic-callback','oog-callback','schedule-panic','missing-callback','old-b']:
 target=pathlib.Path('/tmp/disburse-m5c-'+name);target.mkdir(exist_ok=True)
 if name=='old-b':
  for path in subprocess.check_output(['git','ls-tree','-r','--name-only','fdd8b48','--','src','Cargo.toml','Cargo.lock'],cwd=ROOT,text=True).splitlines():
   dest=target/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(subprocess.check_output(['git','show','fdd8b48:'+path],cwd=ROOT))
 else:
  for path in ['Cargo.toml','Cargo.lock']:shutil.copyfile(ROOT/path,target/path)
  shutil.copytree(ROOT/'src',target/'src',dirs_exist_ok=True)
  p=target/'src/native/execution.rs';s=p.read_text()
  if name=='panic-callback':
   # Execute the real successful settlement body, THEN panic to prove receipt rollback.
   a=s.index('\n    }',s.index('    fn settle_native_success('))
   s=s[:a]+'\n        if env::block_height() > 0 { env::panic_str("SANDBOX_ONLY_AFTER_SETTLEMENT_PANIC"); }'+s[a:]
  elif name=='schedule-panic':
   needle='        // A panic while building/scheduling this graph rolls back this entire receipt, including lock writes.'
   assert needle in s;s=s.replace(needle,'        if env::block_height() > 0 { env::panic_str("SANDBOX_ONLY_SCHEDULING_PANIC"); }\n'+needle)
  elif name=='missing-callback':
   s=s.replace('pub fn on_native_transfer_result(', 'pub fn incompatible_native_callback(')
  else:
   # 1 gas cannot even load the callback, after the independent FT receipt has committed.
   old='pub const SETTLEMENT_GAS: Gas = Gas::from_tgas(50);';assert old in s;s=s.replace(old,'pub const SETTLEMENT_GAS: Gas = Gas::from_gas(1);')
  p.write_text(s)
 env=dict(os.environ);env['CARGO_TARGET_DIR']=str(ROOT/'target/m5c-variants')
 with (OUT/(name+'-build.log')).open('w') as log:
  result=subprocess.run(['cargo','near','build','non-reproducible-wasm','--locked','--manifest-path',str(target/'Cargo.toml'),'--out-dir',str(ART/name)],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
 if result.returncode:raise RuntimeError(name+' build failed; inspect log')
 code=ART/name/'disburse_contract.wasm'
 if name=='old-b':assert hashlib.sha256(code.read_bytes()).hexdigest()=='ad51f8bc061138013ff33620d33adff8dffacb4eaf1c06b09853c79b92c58e94','M5-B artifact provenance mismatch'
 manifest.append({'name':name,'source_copy':str(target),'artifact':str(code),'sha256':hashlib.sha256(code.read_bytes()).hexdigest(),'patch':'Panic after successful settlement writes/events, testing receipt rollback' if name=='panic-callback' else 'Final callback gas1' if name=='oog-callback' else 'Panic after TransferPending writes but before promise scheduling' if name=='schedule-panic' else 'Renamed final callback for local incompatible-upgrade simulation' if name=='missing-callback' else 'Unmodified git fdd8b48 M5-B source','production_has_fault_hooks':False})
 print('built',name,flush=True)
(OUT/'fault-artifact-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
