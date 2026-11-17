import urllib.request,json,datetime,base64,pathlib
endpoint='https://rpc.testnet.fastnear.com';evidence=[]
def rpc(method,params):
 req=urllib.request.Request(endpoint,data=json.dumps({'jsonrpc':'2.0','id':'m5e1-audit','method':method,'params':params}).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=15) as r:
  raw=r.read(4*1024*1024+1);assert len(raw)<=4*1024*1024
  body=json.loads(raw)
 assert 'error' not in body,body
 value=body['result'];evidence.append({'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'endpoint':endpoint,'method':method,'params':params,'result':value});return value
try:
 status=rpc('status',[]);assert status['chain_id']=='testnet'
 h=rpc('block',{'finality':'final'})['header'];snap={'hash':h['hash'],'height':str(h['height']),'network':'testnet'}
 def query(account,kind,**args):
  result=rpc('query',{'request_type':kind,'account_id':account,'block_id':h['hash'],**args});assert result['block_hash']==h['hash'] and result['block_height']==h['height'];return result
 def view(method,args):return json.loads(bytes(query('usdc.tidepool-sandbox.testnet','call_function',method_name=method,args_base64=base64.b64encode(json.dumps(args).encode()).decode())['result']))
 token=query('usdc.tidepool-sandbox.testnet','view_account');metadata=view('ft_metadata',{});bounds=view('storage_balance_bounds',{})
 assert metadata['spec']=='ft-1.0.0' and metadata['symbol']=='USDC' and metadata['decimals']==6
 accounts=[]
 for account in ['disburse-test-contract.testnet','disburse-op-b966e36d.testnet']:
  a=query(account,'view_account');storage=view('storage_balance_of',{'account_id':account});balance=view('ft_balance_of',{'account_id':account});accounts.append({'id':account,'account':a,'storage':storage,'balance':balance})
 out={'result':'PASS_READ_ONLY_INSPECTION','snapshot':snap,'token':token,'metadata':metadata,'bounds':bounds,'accounts':accounts,'recipient':'RECIPIENT_OWNERSHIP_NOT_VERIFIED','transferCompatibility':'NOT VERIFIED','evidence':evidence}
except Exception as e:out={'result':'BLOCKED','error':str(e),'evidence':evidence}
p=pathlib.Path(__file__).with_name('tidepool-python-readonly.json');p.write_text(json.dumps(out,indent=2));print(json.dumps({k:v for k,v in out.items() if k!='evidence'},indent=2))
if out['result']=='BLOCKED':raise SystemExit(1)
