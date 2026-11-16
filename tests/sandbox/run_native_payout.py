"""Real receipt integration tests against the synthetic loopback-only chain.
See README.md for setup. This client cannot sign/send to Testnet or mainnet.
"""
import argparse,base64,hashlib,json,pathlib,sys,time,traceback
from local_rpc import *
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/evidence/milestone-5/m5c-implementation/sandbox'
OUT.mkdir(parents=True,exist_ok=True)
def failure_hook(kind,error,tb):
 (OUT/'suite-summary.json').write_text(json.dumps({'status':'FAIL','error':str(error),'traceback':''.join(traceback.format_exception(kind,error,tb))},indent=2)+'\n')
 sys.__excepthook__(kind,error,tb)
sys.excepthook=failure_hook
parser=argparse.ArgumentParser();parser.add_argument('--rpc',default='http://127.0.0.1:18545');parser.add_argument('--artifacts',default='/tmp/disburse-m5c-artifacts');parser.add_argument('--phase',choices=['main','faults'],default='main');opts=parser.parse_args()
ART=pathlib.Path(opts.artifacts);rpc=LocalRPC(opts.rpc);records=[]
def save(name,data):
 (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
def call(who,target,method,args,gas=300_000_000_000_000,deposit=0):
 result=rpc.call(who,target,method,args,gas,deposit);success(result);return result

def evidence(result):
 data={'outcome':result,'receipts':[]}
 for row in result['receipts_outcome']:
  try:receipt=rpc.rpc('EXPERIMENTAL_receipt',{'receipt_id':row['id']})
  except Exception as err:receipt={'lookup_error':str(err)}
  data['receipts'].append(receipt)
 return data

def snap(campaign,payout=None,recipient=RECIPIENT):
 x={'contract_usdc':str(rpc.balance(CONTRACT)),'recipient_usdc':str(rpc.balance(recipient)),
    'accounting':rpc.view(CONTRACT,'get_campaign_payout_accounting',{'campaign_id':campaign}),'account':{k:v for k,v in rpc.account(CONTRACT).items() if k not in ['block_hash','block_height']}}
 if payout is not None:
  x['native']=rpc.view(CONTRACT,'get_native_payout',{'payout_id':payout});x['payout']=rpc.view(CONTRACT,'get_payout',{'payout_id':payout});x['execution_outcome']=rpc.view(CONTRACT,'get_native_execution_outcome',{'payout_id':payout,'attempt_id':1})
 return x

def campaign(title):
 result=call(OWNER,CONTRACT,'create_campaign',{'title':title,'token_id':TOKEN,'budget':1_000_000});n=json.loads(base64.b64decode(result['status']['SuccessValue']))
 call(OWNER,CONTRACT,'approve_campaign',{'campaign_id':n})
 call(OP,TOKEN,'ft_transfer_call',{'receiver_id':CONTRACT,'amount':'1000000','memo':None,'msg':json.dumps({'campaign_id':n})},deposit=1)
 call(OP,CONTRACT,'activate_campaign',{'campaign_id':n});return n

def reserved(title,recipient=RECIPIENT):
 n=campaign(title);result=call(OP,CONTRACT,'create_native_payout',{'campaign_id':n,'idempotency_key':'sandbox:'+title,'recipient_id':recipient,'amount':'100000'});p=json.loads(base64.b64decode(result['status']['SuccessValue']))
 auth='sandbox-auth:'+str(p);call(APPROVER,CONTRACT,'approve_native_execution',{'payout_id':p,'authorization_id':auth,'attempt_id':1,'expires_at_ns':str(rpc.block_time()+1_800_000_000_000)});return n,p,auth

def request(p,auth):return {'payout_id':p,'authorization_id':auth,'attempt_id':1}
def assert_failed(result):assert 'Failure' in result['status'],result['status']
def assert_locked(after,expected):
 assert after['native']['status']==expected,after
 assert after['accounting']['reserved']=='100000' and after['accounting']['spent']=='0',after

def reject_resend(p,auth):
 result=rpc.call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));assert_failed(result);return evidence(result)

def finish(name,n,p,before,result,recipient=RECIPIENT,extra=None):
 after=snap(n,p,recipient);data={'test':name,'framework':'NEAR Sandbox2.14.0, real JSON-RPC signed local transactions/WASM receipts','actual_receipts_executed':True,'chain_id':CHAIN_ID,'before':before,'after':after,'execution':evidence(result),'extra':extra or {}}
 save(name,data);records.append({'test':name,'result':'PASS','actual_receipts_executed':True,'evidence':name+'.json'});save('index',records);print('PASS',name,after['native']['status'],after['accounting'],flush=True);return after

def setup_and_migrate():
 success(rpc.send(OWNER,OWNER,[deploy((ART/'token/m5c_sandbox_token.wasm').read_bytes())]))
 call(OWNER,OWNER,'new',{'owner':OWNER})
 call(OWNER,TOKEN,'new',{'owner':OWNER})
 call(OWNER,TOKEN,'mint',{'account_id':OP,'amount':'100000000'})
 for acct in [CONTRACT,RECIPIENT,'other.testnet']:
  call(OWNER,TOKEN,'storage_deposit',{'account_id':acct,'registration_only':True},deposit=int(rpc.view(TOKEN,'storage_balance_bounds',{})['min']))
 call(OWNER,CONTRACT,'new',{})
 call(OWNER,CONTRACT,'add_accepted_token',{'token_id':TOKEN})
 for who,role in [(OP,'Operator'),('verifier.testnet','Verifier')]:call(OWNER,CONTRACT,'grant_role',{'account_id':who,'role':role})
 n=campaign('Historical local migration fixture')
 def legacy(key):
  result=call(OP,CONTRACT,'create_payout',{'campaign_id':n,'idempotency_key':key,'recipient_near_account_id':None,'destination':{'chain_id':'eip155:1','recipient_address':'0xrecipient'},'input_amount':{'token_id':{'Near':TOKEN},'atomic_amount':10000,'decimals':6},'expected_output_amount':{'token_id':{'External':'sol:usdc'},'atomic_amount':95,'decimals':6}})
  return json.loads(base64.b64decode(result['status']['SuccessValue']))
 a=legacy('old-settled');call(OP,CONTRACT,'start_payout_execution',{'payout_id':a,'execution_reference':'old-success'});call(OP,CONTRACT,'mark_payout_pending_verification',{'payout_id':a})
 # Explicitly synthetic legacy attestation; no actual cross-chain transfer is asserted.
 proof={'payout_id':a,'provider_id':'sandbox-fixture','destination_chain_id':'eip155:1','destination_transaction_reference':'fixture:old-success','transaction_event_identifier':'0','recipient_address':'0xrecipient','output_amount':{'token_id':{'External':'sol:usdc'},'atomic_amount':95,'decimals':6},'verifier_id':'verifier.testnet','verification_method':'synthetic-migration-fixture','verified_at_ns':1,'evidence_reference':'fixture:old-settlement','content_hash':'a'*64}
 call('verifier.testnet',CONTRACT,'settle_payout',{'payout_id':a,'evidence':proof})
 b=legacy('old-failed');call(OP,CONTRACT,'start_payout_execution',{'payout_id':b,'execution_reference':'old-failure'})
 call(OP,CONTRACT,'mark_payout_failed',{'payout_id':b,'evidence':{'kind':'TransactionReverted','evidence_reference':'fixture:old-failure','reason':'Synthetic terminal failure for local migration'}})
 recovery={'payout_id':b,'verifier_id':'verifier.testnet','outcome':'NonSettlementConfirmed','verification_method':'synthetic-migration-fixture','verified_at_ns':1,'evidence_reference':'fixture:old-resolution','content_hash':'b'*64,'reason':'Synthetic nonsettlement preserves resolution/replay history','external_execution':{'provider_id':'sandbox-fixture','destination_chain_id':'eip155:1','execution_reference':'fixture:old-failed','transaction_event_identifier':'0'}}
 call('verifier.testnet',CONTRACT,'release_failed_payout_reservation',{'payout_id':b,'evidence':recovery})
 call(OWNER,CONTRACT,'pause',{})
 before={'state':rpc.state(CONTRACT),'balance':str(rpc.balance(CONTRACT)),'owner':rpc.view(CONTRACT,'get_owner',{}),'accounting':rpc.view(CONTRACT,'get_campaign_payout_accounting',{'campaign_id':n}),'settled':rpc.view(CONTRACT,'get_payout',{'payout_id':a}),'failed':rpc.view(CONTRACT,'get_payout',{'payout_id':b})}
 candidate=(ROOT/'target/near/disburse_contract.wasm').read_bytes();upgrade=success(rpc.send(CONTRACT,CONTRACT,[deploy(candidate)]))
 assert rpc.state(CONTRACT)==before['state'];assert str(rpc.balance(CONTRACT))==before['balance']
 state_hash=hashlib.sha256(next(base64.b64decode(v['value']) for v in before['state'] if base64.b64decode(v['key'])==b'STATE')).hexdigest()
 init_args={'expected_legacy_state_hash':state_hash,'max_payout_amount':'100000','max_authorization_ttl_ns':'3600000000000'}
 unauthorized=rpc.call(OP,CONTRACT,'initialize_native_execution',init_args);assert_failed(unauthorized);assert rpc.state(CONTRACT)==before['state']
 bootstrap=call(OWNER,CONTRACT,'initialize_native_execution',init_args)
 repeated=rpc.call(OWNER,CONTRACT,'initialize_native_execution',init_args);assert_failed(repeated)
 after_state=rpc.state(CONTRACT);after_map={v['key']:v['value'] for v in after_state};assert all(after_map[v['key']]==v['value'] for v in before['state'])
 assert len(after_state)==len(before['state'])+1
 for name,args in [('get_payout',{'payout_id':a}),('get_payout',{'payout_id':b}),('get_payout_by_idempotency',{'campaign_id':n,'idempotency_key':'old-settled'})]:assert rpc.view(CONTRACT,name,args) is not None
 assert rpc.view(CONTRACT,'get_payout',{'payout_id':a})==before['settled'];assert rpc.view(CONTRACT,'get_payout',{'payout_id':b})==before['failed']
 assert rpc.view(CONTRACT,'get_owner',{})==before['owner'];assert rpc.view(CONTRACT,'get_campaign_payout_accounting',{'campaign_id':n})==before['accounting'];assert str(rpc.balance(CONTRACT))==before['balance']
 save('historical-wasm-migration',{'result':'PASS','actual_receipts_executed':True,'historical_wasm_sha256':hashlib.sha256((ART/'historical-deployed.wasm').read_bytes()).hexdigest(),'candidate_sha256':hashlib.sha256(candidate).hexdigest(),'before':before,'after_state':after_state,'after_token_balance':str(rpc.balance(CONTRACT)),'upgrade':evidence(upgrade),'bootstrap':evidence(bootstrap),'unauthorized':evidence(unauthorized),'repeated':evidence(repeated),'limitations':'State populated locally under authenticated historical deployed WASM. Legacy settlement proof is explicitly synthetic; not actual historical on-chain payout history.'})
 print('PASS historical deployed WASM migration',flush=True)
 for who,role in [(APPROVER,'Approver'),(EXECUTOR,'Executor')]:call(OWNER,CONTRACT,'set_native_role',{'account_id':who,'role':role,'enabled':True})
 for rec in [RECIPIENT,'other.testnet','unregistered.testnet']:call(OWNER,CONTRACT,'approve_native_recipient',{'recipient_id':rec,'evidence_hash':'a'*64})
 call(OWNER,CONTRACT,'unpause',{})

if opts.phase=='main':
 success(rpc.send(TOKEN,TOKEN,[deploy((ART/'token/m5c_sandbox_token.wasm').read_bytes())]))
 success(rpc.send(CONTRACT,CONTRACT,[deploy((ART/'historical-deployed.wasm').read_bytes())]))
 setup_and_migrate()
 n,p,auth=reserved('success');before=snap(n,p);result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));after=finish('successful-transfer',n,p,before,result)
 assert after['native']['status']=='Succeeded';assert int(after['contract_usdc'])==int(before['contract_usdc'])-100000;assert int(after['recipient_usdc'])==int(before['recipient_usdc'])+100000
 assert after['accounting']['available']=='900000' and after['accounting']['reserved']=='0' and after['accounting']['spent']=='100000'
 repeat=reject_resend(p,auth);save('successful-transfer-duplicate-rejected',repeat);assert rpc.balance(RECIPIENT)==int(after['recipient_usdc'])
 attacks=[]
 for method,args in [('on_native_transfer_result',request(p,auth)),('on_native_transfer_result',{'payout_id':p,'authorization_id':auth,'attempt_id':0}),('on_native_storage_checked',request(p,auth))]:
  rejected=rpc.call(CONTRACT,CONTRACT,method,args);assert_failed(rejected);attacks.append(evidence(rejected))
 assert rpc.balance(RECIPIENT)==int(after['recipient_usdc']) and rpc.view(CONTRACT,'get_campaign_payout_accounting',{'campaign_id':n})['spent']=='100000'
 save('stale-duplicate-self-callbacks',{'result':'PASS','actual_receipts_executed':True,'synthetic_root_self_calls':True,'attacks':attacks,'limitation':'Uses known synthetic contract FullAccess key to create self-predecessor calls. No key from a public chain is read.'});print('PASS stale/duplicate callbacks',flush=True)
 n,p,auth=reserved('missing-storage','unregistered.testnet');before=snap(n,p,'unregistered.testnet');result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));after=finish('missing-recipient-storage',n,p,before,result,'unregistered.testnet');assert_locked(after,'AttemptFailed');assert after['execution_outcome']['kind']=='RecipientUnregistered';assert after['contract_usdc']==before['contract_usdc'];reject_resend(p,auth)
 n,p,auth=reserved('token-rejection');call(OWNER,TOKEN,'set_reject_transfers',{'reject':True});before=snap(n,p);result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));after=finish('definitive-token-failure',n,p,before,result);assert_locked(after,'AttemptFailed');assert after['execution_outcome']['kind']=='TransferReceiptFailed';assert after['recipient_usdc']==before['recipient_usdc'] and after['contract_usdc']==before['contract_usdc'];reject_resend(p,auth);call(OWNER,TOKEN,'set_reject_transfers',{'reject':False})
 n,p,auth=reserved('concurrent-duplicate');before=snap(n,p);tx1=rpc.async_call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));tx2=rpc.async_call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));one=rpc.outcome(tx1,EXECUTOR);two=rpc.outcome(tx2,EXECUTOR);success(one);assert_failed(two);after=finish('concurrent-duplicate-execution',n,p,before,one,extra={'second':evidence(two)});assert int(after['recipient_usdc'])==int(before['recipient_usdc'])+100000;assert after['accounting']['spent']=='100000'
 n1,p1,a1=reserved('concurrent-one');n2,p2,a2=reserved('concurrent-two','other.testnet');before1=snap(n1,p1);before2=snap(n2,p2,'other.testnet');tx1=rpc.async_call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p1,a1));tx2=rpc.async_call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p2,a2));one=rpc.outcome(tx1,EXECUTOR);two=rpc.outcome(tx2,EXECUTOR);success(one);success(two);after1=finish('concurrent-payout-one',n1,p1,before1,one);after2=finish('concurrent-payout-two',n2,p2,before2,two,'other.testnet');assert after1['accounting']['spent']==after2['accounting']['spent']=='100000'
 n,p1,a1=reserved('same-campaign-one');result=call(OP,CONTRACT,'create_native_payout',{'campaign_id':n,'idempotency_key':'same-campaign-two','recipient_id':'other.testnet','amount':'100000'});p2=json.loads(base64.b64decode(result['status']['SuccessValue']));a2='sandbox-auth:'+str(p2);call(APPROVER,CONTRACT,'approve_native_execution',{'payout_id':p2,'authorization_id':a2,'attempt_id':1,'expires_at_ns':str(rpc.block_time()+1800000000000)})
 before=snap(n,p1);tx1=rpc.async_call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p1,a1));tx2=rpc.async_call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p2,a2));r1=rpc.outcome(tx1,EXECUTOR);r2=rpc.outcome(tx2,EXECUTOR);success(r1);success(r2);after=finish('same-campaign-concurrent-payouts',n,p1,before,r1,extra={'second':evidence(r2),'second_native':rpc.view(CONTRACT,'get_native_payout',{'payout_id':p2})});assert (after['accounting']['reserved'],after['accounting']['spent'],after['accounting']['available'])==('0','200000','800000')
 n,p,auth=reserved('gas-minimum');before=snap(n,p);rejected=rpc.call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth),gas=100000000000000);assert_failed(rejected)
 assert rpc.view(CONTRACT,'get_native_authorization',{'authorization_id':auth})['status']=='Approved'
 result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth),gas=220000000000000);after=finish('minimum-gas-and-low-gas-rejection',n,p,before,result,extra={'insufficient_gas':evidence(rejected)});assert after['native']['status']=='Succeeded'
 n,p,auth=reserved('near-headroom');before=snap(n,p);account=rpc.account(CONTRACT);price=int(rpc.rpc('EXPERIMENTAL_protocol_config',{'finality':'final'})['runtime_config']['storage_amount_per_byte']);amount=int(account['amount'])-account['storage_usage']*price-10**22
 drained=success(rpc.send(CONTRACT,OWNER,[transfer(amount)]));rejected=rpc.call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));assert_failed(rejected)
 assert rpc.view(CONTRACT,'get_native_authorization',{'authorization_id':auth})['status']=='Approved'
 restored=success(rpc.send(OWNER,CONTRACT,[transfer(amount)]));result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));after=finish('native-near-headroom',n,p,before,result,extra={'local_near_drain':evidence(drained),'rejected':evidence(rejected),'local_near_restore':evidence(restored)});assert after['native']['status']=='Succeeded'
 n,p,auth=reserved('external-callback');before=snap(n,p);attacks=[]
 for who in [OWNER,OP,EXECUTOR,'other.testnet']:
  for method in ['on_native_storage_checked','on_native_transfer_result']:
   result=rpc.call(who,CONTRACT,method,request(p,auth));assert_failed(result);attacks.append(evidence(result))
 assert snap(n,p)==before
 save('external-callbacks-rejected',{'result':'PASS','actual_receipts_executed':True,'before':before,'after':snap(n,p),'attacks':attacks});print('PASS external callback wrapper authentication',flush=True)
 result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));after=finish('external-callback-payout-success',n,p,before,result)
 # RPC timeout/restart MODEL: deliberately discard the completed response and recreate a client.
 restart=LocalRPC(opts.rpc);resend=restart.call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));assert_failed(resend)
 assert restart.balance(RECIPIENT)==int(after['recipient_usdc'])
 save('restart-uncertain-response-model',{'result':'PASS','actual_receipts_executed':True,'model':'Discarded response and fresh client; no actual execution-service worker or PostgreSQL process restarted.','resend':evidence(resend),'native':restart.view(CONTRACT,'get_native_payout',{'payout_id':p})});print('PASS restart/uncertain-response model',flush=True)
 save('suite-summary',{'status':'PASS','phase':'main','actual_receipts_executed':True,'cases':records});print('MAIN SCENARIOS COMPLETE',flush=True)

if opts.phase=='faults':
 # Test-only token/owner-proxy hook makes a REAL owner pause receipt precede final settlement.
 n,p,auth=reserved('verified-pause-after-dispatch');before=snap(n,p);call(OWNER,TOKEN,'set_pause_on_transfer',{'enabled':True})
 result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));after=finish('pause-after-dispatch',n,p,before,result,extra={'fixture_hook':'Test token returns the owner-proxy pause promise, so pause commits before token result/callback.'})
 callback_height=int(after['execution_outcome']['observed_at_block']);pause_rows=[]
 full=evidence(result)
 for receipt,outcome in zip(full['receipts'],result['receipts_outcome']):
  actions=receipt.get('receipt',{}).get('Action',{}).get('actions',[])
  if receipt.get('receiver_id')==CONTRACT and any(a.get('FunctionCall',{}).get('method_name')=='pause' for a in actions):pause_rows.append(outcome)
 assert len(pause_rows)==1,full
 pause_height=int(rpc.rpc('block',{'block_id':pause_rows[0]['block_hash']})['header']['height']);assert pause_height<callback_height,(pause_height,callback_height)
 pause_data=json.loads((OUT/'pause-after-dispatch.json').read_text());pause_data['extra'].update({'timing_proven':True,'pause_receipt_height':pause_height,'settlement_callback_height':callback_height});save('pause-after-dispatch',pause_data)
 assert after['native']['status']=='Succeeded' and rpc.view(CONTRACT,'is_paused',{}) is True
 call(OWNER,TOKEN,'set_pause_on_transfer',{'enabled':False});call(OWNER,CONTRACT,'unpause',{})
 # Run against the persisted synthetic main-suite chain. Each variant is locally deployed only.
 for mode in ['schedule-panic','panic-callback','oog-callback']:
  candidate=(ART/mode/'disburse_contract.wasm').read_bytes();success(rpc.send(CONTRACT,CONTRACT,[deploy(candidate)]))
  n,p,auth=reserved(mode);before=snap(n,p);result=rpc.call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));assert_failed(result)
  after=finish(mode,n,p,before,result,extra={'fault_fixture_artifact_sha256':hashlib.sha256(candidate).hexdigest(),'production_artifact':False})
  expected_phase='PreflightPending' if mode=='schedule-panic' else 'TransferPending'
  delta=0 if mode=='schedule-panic' else 100000
  assert_locked(after,expected_phase);assert int(after['recipient_usdc'])==int(before['recipient_usdc'])+delta
  assert int(after['contract_usdc'])==int(before['contract_usdc'])-delta
  assert after['execution_outcome']['kind']==('AwaitingStorage' if mode=='schedule-panic' else 'TransferScheduled')
  rejected=reject_resend(p,auth);assert rpc.balance(RECIPIENT)==int(after['recipient_usdc'])
  save(mode+'-duplicate-rejected',rejected)
  if mode=='schedule-panic':assert 'SANDBOX_ONLY_SCHEDULING_PANIC' in json.dumps(result)
  if mode=='panic-callback':assert 'SANDBOX_ONLY_AFTER_SETTLEMENT_PANIC' in json.dumps(result)
  if mode=='oog-callback':assert any(word in json.dumps(result) for word in ['GasExceeded','Exceeded the prepaid gas','gas limit','gas'])
  # Restore production candidate with unresolved attempt intact; upgrade must not reset replay locks.
  production=(ROOT/'target/near/disburse_contract.wasm').read_bytes();success(rpc.send(CONTRACT,CONTRACT,[deploy(production)]))
  reject_resend(p,auth);assert rpc.balance(RECIPIENT)==int(after['recipient_usdc'])
 # An incompatible local code upgrade while the token result is delayed must leave the lock.
 n,p,auth=reserved('in-flight-upgrade');before=snap(n,p);call(OWNER,TOKEN,'set_pause_on_transfer',{'enabled':True});tx=rpc.async_call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth))
 observed=None
 for _ in range(1000):
  current=rpc.view(CONTRACT,'get_native_payout',{'payout_id':p},finality='optimistic')
  if current['status']=='TransferPending':observed=current;break
  if current['status']=='Succeeded':break
  time.sleep(.005)
 assert observed is not None,'No pending upgrade window'
 incompatible=(ART/'missing-callback/disburse_contract.wasm').read_bytes();upgrade=success(rpc.send(CONTRACT,CONTRACT,[deploy(incompatible)]));result=rpc.outcome(tx,EXECUTOR);assert_failed(result)
 after=finish('upgrade-between-transfer-and-callback',n,p,before,result,extra={'upgrade':evidence(upgrade),'fixture_artifact_sha256':hashlib.sha256(incompatible).hexdigest(),'fault':'Renamed final callback in separate test artifact'});assert_locked(after,'TransferPending');assert int(after['recipient_usdc'])==int(before['recipient_usdc'])+100000
 assert 'MethodNotFound' in json.dumps(result) or 'MethodResolveError' in json.dumps(result)
 production=(ROOT/'target/near/disburse_contract.wasm').read_bytes();success(rpc.send(CONTRACT,CONTRACT,[deploy(production)]));call(OWNER,TOKEN,'set_pause_on_transfer',{'enabled':False});call(OWNER,CONTRACT,'unpause',{});reject_resend(p,auth);assert rpc.balance(RECIPIENT)==int(after['recipient_usdc'])
 n,p,auth=reserved('nonstandard-transfer-return');before=snap(n,p);call(OWNER,TOKEN,'set_bad_return',{'enabled':True});result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));after=finish('delivered-but-unexpected-result',n,p,before,result);assert_locked(after,'ManualReview');assert int(after['recipient_usdc'])==int(before['recipient_usdc'])+100000;assert after['execution_outcome']['kind']=='UnexpectedTransferResult';reject_resend(p,auth);call(OWNER,TOKEN,'set_bad_return',{'enabled':False})
 # Insufficient token balance is independent of the ledger; fixture burn models out-of-band custody loss.
 n,p,auth=reserved('insufficient-token-balance');burn=rpc.balance(CONTRACT)-50000;call(OWNER,TOKEN,'fixture_burn',{'account_id':CONTRACT,'amount':str(burn)})
 before=snap(n,p);result=call(EXECUTOR,CONTRACT,'begin_native_preflight',request(p,auth));after=finish('insufficient-token-balance',n,p,before,result);assert_locked(after,'AttemptFailed');assert after['execution_outcome']['kind']=='TransferReceiptFailed';assert after['contract_usdc']==before['contract_usdc'];assert after['recipient_usdc']==before['recipient_usdc'];reject_resend(p,auth)
 save('fault-suite-summary',{'status':'PASS','phase':'faults','actual_receipts_executed':True,'cases':records});print('FAULT SCENARIOS COMPLETE',flush=True)
