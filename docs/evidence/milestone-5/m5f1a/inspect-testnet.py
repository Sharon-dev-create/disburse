"""Read-only finalized queries only. No signer/key access or submission methods."""
import urllib.request,json,datetime,base64,pathlib,hashlib,struct
OUT=pathlib.Path(__file__).parent;PRIMARY='https://rpc.testnet.near.org';SECONDARY='https://rpc.testnet.near.org';CONTRACT='disburse-test-contract.testnet';TOKEN='usdc.tidepool-sandbox.testnet';OWNER='disburse-topg.testnet';OP='disburse-op-b966e36d.testnet';evidence=[]
def rpc(method,params,endpoint=PRIMARY,optional=False):
 assert method in ['status','block','query','gas_price','EXPERIMENTAL_protocol_config']
 request=urllib.request.Request(endpoint,data=json.dumps({'jsonrpc':'2.0','id':'m5f1-readonly','method':method,'params':params}).encode(),headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(request,timeout=20) as r:raw=r.read(4*1024*1024+1)
  assert len(raw)<=4*1024*1024
  body=json.loads(raw);row={'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'endpoint':endpoint,'method':method,'params':params,'response':body};evidence.append(row)
  if 'error' in body:
   if optional:return {'query_error':body['error']}
   raise RuntimeError('Read-only RPC query error')
  return body['result']
 except Exception as e:
  if optional:evidence.append({'endpoint':endpoint,'method':method,'params':params,'transport_error':type(e).__name__});return {'transport_error':type(e).__name__}
  raise
try:
 assert rpc('status',[])['chain_id']=='testnet'
 header=rpc('block',{'finality':'final'})['header'];block=header['hash'];height=header['height']
 def query(account,request_type,endpoint=PRIMARY,optional=False,**args):
  result=rpc('query',{'request_type':request_type,'account_id':account,'block_id':block,**args},endpoint,optional)
  if not ('query_error' in result or 'transport_error' in result):assert result['block_hash']==block and result['block_height']==height
  return result
 def view(account,method,args={},optional=False):
  result=query(account,'call_function',optional=optional,method_name=method,args_base64=base64.b64encode(json.dumps(args).encode()).decode())
  if 'query_error' in result or 'transport_error' in result:return result
  return json.loads(bytes(result['result'])) if 'result' in result else {'unavailable_response':result}
 accounts={account:{'account':query(account,'view_account'),'keys':query(account,'view_access_key_list'),'storage':view(TOKEN,'storage_balance_of',{'account_id':account}),'USDC_atomic':view(TOKEN,'ft_balance_of',{'account_id':account})} for account in [CONTRACT,OWNER,OP,TOKEN]}
 views={m:view(CONTRACT,m,a,optional=optional) for m,a,optional in [('get_owner',{},False),('is_paused',{},False),('get_campaign_count',{},False),('is_accepted_token',{'token_id':TOKEN},False),('get_native_config',{},True),('get_payout',{'payout_id':0},False)]}
 views['roles']={account:{role:view(CONTRACT,'has_role',{'account_id':account,'role':role}) for role in ['Owner','Administrator','Operator','Verifier']} for account in [OWNER,OP,CONTRACT]}
 n=views['get_campaign_count'];assert isinstance(n,int) and n<=100
 campaigns=[{'campaign':view(CONTRACT,'get_campaign',{'campaign_id':i}),'accounting':view(CONTRACT,'get_campaign_payout_accounting',{'campaign_id':i})} for i in range(n)]
 state=query(CONTRACT,'view_state',prefix_base64='',include_proof=False)
 decoded=[{'key_base64':x['key'],'value_base64':x['value'],'key_hex':base64.b64decode(x['key']).hex(),'value_sha256':hashlib.sha256(base64.b64decode(x['value'])).hexdigest(),'value_bytes':len(base64.b64decode(x['value']))} for x in state['values']]
 legacy=next(base64.b64decode(x['value']) for x in state['values'] if base64.b64decode(x['key'])==b'STATE');offset=0
 def read(n):
  global offset
  assert offset+n<=len(legacy);v=legacy[offset:offset+n];offset+=n;return v
 def string():return read(int.from_bytes(read(4),'little')).decode()
 owner=string();paused=read(1)[0];next_campaign=int.from_bytes(read(8),'little');prefixes=[string(),string(),string()];next_payout=int.from_bytes(read(8),'little');prefixes.extend([string(),string()]);assert offset==len(legacy)
 raw_summary={'owner':owner,'paused':bool(paused),'next_campaign_id':next_campaign,'next_payout_id':next_payout,'prefixes':prefixes,'bytes':len(legacy),'STATE_sha256':hashlib.sha256(legacy).hexdigest(),'entries':decoded}
 code=query(CONTRACT,'view_code');wasm=base64.b64decode(code['code_base64']);(OUT/'deployed-contract.wasm').write_bytes(wasm)
 alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
 def bs58(data):
  num=int.from_bytes(data,'big');s=''
  while num:num,i=divmod(num,58);s=alphabet[i]+s
  return '1'*(len(data)-len(data.lstrip(b'\0')))+s
 assert bs58(hashlib.sha256(wasm).digest())==accounts[CONTRACT]['account']['code_hash']
 secondary={'status':rpc('status',[],SECONDARY,True),'block':rpc('block',{'block_id':block},SECONDARY,True),'account':query(CONTRACT,'view_account',SECONDARY,True),'state':query(CONTRACT,'view_state',SECONDARY,True,prefix_base64='',include_proof=False)}
 corroborated=secondary['status'].get('chain_id')=='testnet' and secondary['block'].get('header',{}).get('hash')==block and secondary['account']==accounts[CONTRACT]['account'] and sorted(secondary['state'].get('values',[]),key=lambda x:x['key'])==sorted(state['values'],key=lambda x:x['key'])
 protocol=rpc('EXPERIMENTAL_protocol_config',{'block_id':block},optional=True);gas=rpc('gas_price',[block],optional=True)
 out={'result':'PASS_READ_ONLY_COLLECTION','snapshot':{'block_hash':block,'block_height':height,'block_timestamp_ns':str(header['timestamp_nanosec']),'endpoint':PRIMARY},'accounts':accounts,'views':views,'campaigns':campaigns,'raw_state':raw_summary,'deployed_wasm':{'bytes':len(wasm),'sha256':hashlib.sha256(wasm).hexdigest(),'code_hash':accounts[CONTRACT]['account']['code_hash']},'token_metadata':view(TOKEN,'ft_metadata'),'storage_bounds':view(TOKEN,'storage_balance_bounds'),'protocol_config':protocol,'gas_price':gas,'secondary_corroborated':corroborated,'secondary':secondary,'recipient':None,'native_approver':None,'native_executor':None,'emergency_human':None,'evidence':evidence}
except Exception as e:out={'result':'BLOCKED','error_type':type(e).__name__,'error':str(e),'evidence':evidence}
(OUT/'testnet-snapshot.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items() if k not in ['evidence','protocol_config','secondary','accounts','raw_state']},indent=2))
if out['result']=='BLOCKED':raise SystemExit(1)
