import pathlib,json,base64,hashlib,struct
p=pathlib.Path(__file__).parent;rows=json.loads((p/'rpc-evidence.json').read_text());s=json.loads((p/'rpc-summary.json').read_text());n=0
for r in rows:
 b=r.get('response',{});result=b.get('result');params=r['params']
 if isinstance(result,dict) and 'error' in result:r['classification']='contract_method_error';r['error_classification']='METHOD_NOT_FOUND' if 'MethodNotFound' in result['error'] else 'CONTRACT_EXECUTION_ERROR'
 if 'error' in b:r['error_classification']=b['error'].get('cause',{}).get('name','RPC_ERROR')
 if r['method']=='query' and isinstance(result,dict):
  assert result['block_hash']==s['block_hash'] and result['block_height']==s['block_height'];n+=1
  if isinstance(params,dict) and params.get('method_name')=='get_native_config' and 'error' in result:s['views']['get_native_config']={'classification':r['error_classification'],'error':result['error']}
 if isinstance(params,dict) and params.get('account_id') in s['accounts'] and params.get('request_type')=='view_account':s['accounts'][params['account_id']]['classification']=r.get('error_classification',r['classification'])
b=next(base64.b64decode(v['value']) for v in s['state']['values'] if base64.b64decode(v['key'])==b'STATE');offset=0

def read(n):
 global offset
 v=b[offset:offset+n];assert len(v)==n;offset+=n;return v

def string():return read(int.from_bytes(read(4),'little')).decode()
owner=string();paused=read(1)[0];campaigns=int.from_bytes(read(8),'little');prefixes=[string() for _ in range(3)];payouts=int.from_bytes(read(8),'little');prefixes += [string(),string()];assert offset==len(b)
s['legacy_state']={'owner':owner,'paused':bool(paused),'campaign_count':campaigns,'payout_count':payouts,'prefixes':prefixes,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
s['pinned_query_responses_verified']=n
(p/'rpc-classified.json').write_text(json.dumps(rows,indent=2));(p/'rpc-summary.json').write_text(json.dumps(s,indent=2));print(s['legacy_state'])
