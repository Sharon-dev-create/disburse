"""Read-only public artifact fetch. NO signer, transaction, account or keychain access."""
import base64,hashlib,json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2];ART=pathlib.Path('/tmp/disburse-m5c-artifacts');ART.mkdir(exist_ok=True)
EXPECTED='a7eaa8a4f035ac34a75271a9dda3fabc9074c47e4908c8e315a432c6472ad530'
path=ART/'historical-deployed.wasm'
if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()==EXPECTED:
 print('Authenticated historical WASM already available');raise SystemExit(0)
url='https://rpc.testnet.fastnear.com'
params={'jsonrpc':'2.0','id':'m5c-read-only-artifact','method':'query','params':{'request_type':'view_code','finality':'final','account_id':'disburse-test-contract.testnet'}}
req=urllib.request.Request(url,json.dumps(params).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=60) as response:data=json.loads(response.read(2000000))
result=data['result'];code=base64.b64decode(result.pop('code_base64'))
assert hashlib.sha256(code).hexdigest()==EXPECTED and len(code)==299058,'Historical code changed: obtain an independently authenticated old artifact; do not substitute current code.'
assert result['hash']=='CJUcu5UqBYA4ZV47TJMABQJWc7MdvdaYYMNdDeB1mxcf'
path.write_bytes(code)
(ROOT/'docs/evidence/milestone-5/m5c-implementation/historical-wasm-provenance.json').write_text(json.dumps({'rpc':url,'query':params,'result':result,'sha256':EXPECTED,'bytes':len(code)},indent=2)+'\n')
print('Saved authenticated public historical code; no blockchain state changed')
