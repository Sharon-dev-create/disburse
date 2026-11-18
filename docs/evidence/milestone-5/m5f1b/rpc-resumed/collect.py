import urllib.request,json,datetime,base64,pathlib,time
out=pathlib.Path(__file__).parent; rows=[]; endpoint='https://rpc.testnet.near.org'; block=None; height=None

def rpc(method,params):
 for attempt in range(2):
  row=dict(network='testnet',endpoint=endpoint,method=method,params=params,finality='final' if block is None else 'pinned finalized block',block_hash=block,block_height=height,timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),attempt=attempt+1)
  try:
   req=urllib.request.Request(endpoint,json.dumps(dict(jsonrpc='2.0',id='readonly',method=method,params=params)).encode(),{'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=15) as r: raw=r.read(4194305)
   if len(raw)>4194304: raise ValueError('response-size-limit')
   body=json.loads(raw);row['response']=body
   if 'error' in body: row['classification']='rpc_error';rows.append(row);return None
   if 'result' not in body: row['classification']='malformed_rpc';rows.append(row);continue
   row['classification']='success';rows.append(row);return body['result']
  except Exception as e: row['classification']='transport_or_decode_error';row['error_type']=type(e).__name__;rows.append(row)
  finally: (out/'rpc-evidence.json').write_text(json.dumps(rows,indent=2))
 return None

status=rpc('status',[]); header=rpc('block',{'finality':'final'})
if not status or status.get('chain_id')!='testnet' or not header: raise SystemExit('No verified finalized Testnet block')
block=header['header']['hash'];height=header['header']['height']
def query(a,t,**kw):return rpc('query',dict(request_type=t,account_id=a,block_id=block,**kw))
def view(a,m,args={}):
 r=query(a,'call_function',method_name=m,args_base64=base64.b64encode(json.dumps(args).encode()).decode())
 if r is None:return None
 try:return json.loads(bytes(r['result']))
 except Exception:return {'decode_error':True}
c='disburse-test-contract.testnet';t='usdc.tidepool-sandbox.testnet';o='disburse-topg.testnet';op='disburse-op-b966e36d.testnet'
s=dict(block_hash=block,block_height=height,network='testnet',endpoint=endpoint,accounts={},views={},token={})
for a in [c,t,o,op,'disburse-m12.testnet','recipient.disburse-m12.testnet','approver.disburse-m12.testnet','executor.disburse-m12.testnet']:
 s['accounts'][a]=dict(account=query(a,'view_account'),ownership_verified=False)
for m,args in [('get_owner',{}),('is_paused',{}),('get_campaign_count',{}),('get_campaign',{'campaign_id':0}),('get_campaign_payout_accounting',{'campaign_id':0}),('is_accepted_token',{'token_id':t}),('get_native_config',{}),('get_payout',{'payout_id':0})]:s['views'][m]=view(c,m,args)
for a in [o,op,c]:
 s['views']['roles:'+a]={r:view(c,'has_role',{'account_id':a,'role':r}) for r in ['Owner','Administrator','Operator','Verifier']}
for m in ['ft_metadata','storage_balance_bounds']:s['token'][m]=view(t,m)
for a in [c,o,op]:s['token'][a]={m:view(t,m,{'account_id':a}) for m in ['storage_balance_of','ft_balance_of']}
s['state']=query(c,'view_state',prefix_base64='',include_proof=False)
s['gas_price']=rpc('gas_price',[block]);s['protocol']=rpc('EXPERIMENTAL_protocol_config',{'block_id':block})
(out/'rpc-summary.json').write_text(json.dumps(s,indent=2));print(json.dumps({k:v for k,v in s.items() if k not in ['state','protocol']},indent=2))
