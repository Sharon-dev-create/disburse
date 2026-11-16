"""One new synthetic payout to overlap a read-only observer with its real callback.
Never uses real keys or funds. Run only against the retained local M5-D fixture node.
"""
import json,pathlib,sys,subprocess,tempfile,time,base64
from local_rpc import *
ROOT=pathlib.Path(__file__).resolve().parents[2]
rpc=LocalRPC()
def call(who,target,method,args,deposit=0):return success(rpc.call(who,target,method,args,deposit=deposit))
def value(out):return json.loads(base64.b64decode(out['status']['SuccessValue']))
n=value(call(OWNER,CONTRACT,'create_campaign',{'title':'M5-D local callback observer overlap','token_id':TOKEN,'budget':1000000}))
call(OWNER,CONTRACT,'approve_campaign',{'campaign_id':n})
call(OP,TOKEN,'ft_transfer_call',{'receiver_id':CONTRACT,'amount':'1000000','memo':None,'msg':json.dumps({'campaign_id':n})},deposit=1)
call(OP,CONTRACT,'activate_campaign',{'campaign_id':n})
p=value(call(OP,CONTRACT,'create_native_payout',{'campaign_id':n,'idempotency_key':'m5d-local-race','recipient_id':RECIPIENT,'amount':'100000'}))
a='m5d-race:'+str(p);call(APPROVER,CONTRACT,'approve_native_execution',{'payout_id':p,'authorization_id':a,'attempt_id':1,'expires_at_ns':str(rpc.block_time()+1800000000000)})
b=rpc.view(CONTRACT,'get_native_payout',{'payout_id':p})['binding']
i={'chainId':CHAIN_ID,'contractId':CONTRACT,'campaignId':str(n),'payoutId':str(p),'attemptId':'1','authorizationId':a,
   'bindingHash':rpc.view(CONTRACT,'get_native_payout',{'payout_id':p})['binding_hash'],'tokenId':TOKEN,'recipientId':RECIPIENT,'amount':'100000','executorId':EXECUTOR}
before_contract=rpc.balance(CONTRACT);before_recipient=rpc.balance(RECIPIENT)
tx=rpc.async_call(EXECUTOR,CONTRACT,'begin_native_preflight',{'payout_id':p,'authorization_id':a,'attempt_id':1})
observed=None
for _ in range(1000):
 state=rpc.view(CONTRACT,'get_native_payout',{'payout_id':p},finality='optimistic')
 if state['status']=='TransferPending':observed=state;break
 if state['status']=='Succeeded':break
 time.sleep(.005)
assert observed is not None,'No observer-before-callback window'
f=pathlib.Path(tempfile.mkstemp(prefix='disburse-m5d-race-',suffix='.json')[1])
f.write_text(json.dumps({'identity':i,'locator':{'transactionHash':tx,'senderId':EXECUTOR},'optimisticBefore':observed}))
subprocess.run(['node','--experimental-strip-types',str(ROOT/'execution-service/tests/integration/native-race-observer.ts'),str(f)],cwd=ROOT/'execution-service',check=True)
assert rpc.balance(CONTRACT)==before_contract-100000
assert rpc.balance(RECIPIENT)==before_recipient+100000
print('PASS one exact synthetic transfer; no observer transfer or settlement')
