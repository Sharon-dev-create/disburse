import urllib.request,json,pathlib,concurrent.futures
names=['disburse-m12.testnet','recipient.disburse-m12.testnet','approver.disburse-m12.testnet','executor.disburse-m12.testnet']
def get(a):
 try:
  q={'jsonrpc':'2.0','id':'read','method':'query','params':{'request_type':'view_account','account_id':a,'finality':'final'}}
  with urllib.request.urlopen(urllib.request.Request('https://rpc.testnet.near.org',data=json.dumps(q).encode(),headers={'Content-Type':'application/json'}),timeout=10) as r:b=json.load(r)
  return {'account':a,'response':b,'ownership':'UNVERIFIED'}
 except Exception as e:return {'account':a,'status':'UNVERIFIED_RPC_UNAVAILABLE','error_type':type(e).__name__}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as x:out=list(x.map(get,names))
pathlib.Path(__file__).with_name('proposed-accounts.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
