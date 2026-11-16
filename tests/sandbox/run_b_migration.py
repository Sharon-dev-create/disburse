"""Real M5-B→M5-C upgrade: preserve approved and orphan preflight sidecars without resetting locks."""
import pathlib,json,hashlib,base64,sys
from local_rpc import *
ROOT=pathlib.Path(__file__).resolve().parents[2];ART=pathlib.Path('/tmp/disburse-m5c-artifacts');OUT=ROOT/'docs/evidence/milestone-5/m5c-implementation/sandbox';OUT.mkdir(parents=True,exist_ok=True);rpc=LocalRPC()
def call(who,target,name,args,deposit=0):return success(rpc.call(who,target,name,args,deposit=deposit))
def data(value):return json.loads(base64.b64decode(value['status']['SuccessValue']))
for acct,code in [(TOKEN,ART/'token/m5c_sandbox_token.wasm'),(CONTRACT,ART/'old-b/disburse_contract.wasm')]:success(rpc.send(acct,acct,[deploy(code.read_bytes())]))
call(OWNER,TOKEN,'new',{'owner':OWNER});call(OWNER,TOKEN,'mint',{'account_id':OP,'amount':'10000000'})
for acct in [CONTRACT,RECIPIENT]:call(OWNER,TOKEN,'storage_deposit',{'account_id':acct,'registration_only':True},deposit=int(rpc.view(TOKEN,'storage_balance_bounds',{})['min']))
call(OWNER,CONTRACT,'new',{});call(OWNER,CONTRACT,'add_accepted_token',{'token_id':TOKEN});call(OWNER,CONTRACT,'grant_role',{'account_id':OP,'role':'Operator'})
campaign=data(call(OWNER,CONTRACT,'create_campaign',{'title':'M5-B native sidecar upgrade','token_id':TOKEN,'budget':1000000}));call(OWNER,CONTRACT,'approve_campaign',{'campaign_id':campaign});call(OP,TOKEN,'ft_transfer_call',{'receiver_id':CONTRACT,'amount':'1000000','memo':None,'msg':json.dumps({'campaign_id':campaign})},deposit=1);call(OP,CONTRACT,'activate_campaign',{'campaign_id':campaign})
call(OWNER,CONTRACT,'pause',{});raw=rpc.state(CONTRACT);statehash=hashlib.sha256(next(base64.b64decode(v['value']) for v in raw if base64.b64decode(v['key'])==b'STATE')).hexdigest()
call(OWNER,CONTRACT,'initialize_native_execution',{'expected_legacy_state_hash':statehash,'max_payout_amount':'100000','max_authorization_ttl_ns':'3600000000000'})
for who,role in [(APPROVER,'Approver'),(EXECUTOR,'Executor')]:call(OWNER,CONTRACT,'set_native_role',{'account_id':who,'role':role,'enabled':True})
call(OWNER,CONTRACT,'approve_native_recipient',{'recipient_id':RECIPIENT,'evidence_hash':'a'*64});call(OWNER,CONTRACT,'unpause',{})
ps=[]
for keyname in ['approved','orphan-preflight']:
 p=data(call(OP,CONTRACT,'create_native_payout',{'campaign_id':campaign,'idempotency_key':keyname,'recipient_id':RECIPIENT,'amount':'100000'}));auth='b-auth:'+str(p);call(APPROVER,CONTRACT,'approve_native_execution',{'payout_id':p,'authorization_id':auth,'attempt_id':1,'expires_at_ns':str(rpc.block_time()+1800000000000)});ps.append((p,auth))
p,a=ps[1];call(EXECUTOR,CONTRACT,'begin_native_preflight',{'payout_id':p,'authorization_id':a,'attempt_id':1})
before={'state':rpc.state(CONTRACT),'balance':rpc.balance(CONTRACT),'accounting':rpc.view(CONTRACT,'get_campaign_payout_accounting',{'campaign_id':campaign}),'native':[rpc.view(CONTRACT,'get_native_payout',{'payout_id':p}) for p,_ in ps]}
upgrade=success(rpc.send(CONTRACT,CONTRACT,[deploy((ROOT/'target/near/disburse_contract.wasm').read_bytes())]));assert rpc.state(CONTRACT)==before['state'];assert rpc.balance(CONTRACT)==before['balance']
p,a=ps[0];result=call(EXECUTOR,CONTRACT,'begin_native_preflight',{'payout_id':p,'authorization_id':a,'attempt_id':1});assert rpc.view(CONTRACT,'get_native_payout',{'payout_id':p})['status']=='Succeeded';assert rpc.balance(RECIPIENT)==100000
p,a=ps[1];rejected=rpc.call(EXECUTOR,CONTRACT,'begin_native_preflight',{'payout_id':p,'authorization_id':a,'attempt_id':1});assert 'Failure' in rejected['status'];assert rpc.view(CONTRACT,'get_native_payout',{'payout_id':p})['status']=='PreflightPending'
after=rpc.view(CONTRACT,'get_campaign_payout_accounting',{'campaign_id':campaign});assert (after['reserved'],after['spent'],after['available'])==('100000','100000','800000')
x={'result':'PASS','actual_receipts_executed':True,'old_b_sha256':hashlib.sha256((ART/'old-b/disburse_contract.wasm').read_bytes()).hexdigest(),'before':before,'upgrade':upgrade,'approved_attempt_execution':result,'old_orphan_attempt_resubmission':rejected,'after_accounting':after,'after_balance':rpc.balance(CONTRACT),'recipient_balance':rpc.balance(RECIPIENT),'limitation':'An orphan M5-B consumed preflight without a scheduled query remains frozen for M5-D evidence-based resolution. No implicit continuation/reset added.'}
(OUT/'b-to-c-wasm-migration.json').write_text(json.dumps(x,indent=2)+'\n');print('PASS M5-B→M5-C WASM migration, approved execution and preserved old orphan lock',flush=True)
