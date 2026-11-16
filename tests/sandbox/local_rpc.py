"""Local-only NEAR JSON-RPC/Borsh test client. Never reads an existing user keychain.
All keys are reproducible PUBLIC TEST FIXTURE secrets; NEVER use them on a public chain.
The client refuses non-loopback endpoints and a chain ID other than disburse-m5c-local.
"""
import base64, hashlib, json, struct, time, urllib.request, urllib.parse
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
CHAIN_ID='disburse-m5c-local'
CONTRACT='disburse-test-contract.testnet'
TOKEN='usdc.tidepool-sandbox.testnet'
OWNER='owner.testnet'; OP='operator.testnet'; APPROVER='approver.testnet'; EXECUTOR='executor.testnet'
RECIPIENT='recipient.testnet'
ACCOUNTS=['testnet',CONTRACT,TOKEN,OWNER,OP,APPROVER,EXECUTOR,RECIPIENT,'other.testnet','unregistered.testnet','verifier.testnet','disburse-topg.testnet','disburse-op-b966e36d.testnet']
def b58(data):
 n=int.from_bytes(data,'big');s=''
 while n:n,k=divmod(n,58);s=ALPHABET[k]+s
 return '1'*(len(data)-len(data.lstrip(b'\0')))+s

def un58(text):
 n=0
 for c in text:n=n*58+ALPHABET.index(c)
 return b'\0'*(len(text)-len(text.lstrip('1')))+(n.to_bytes((n.bit_length()+7)//8,'big') if n else b'')

def key(account):
 return Ed25519PrivateKey.from_private_bytes(hashlib.sha256(('PUBLIC-DISBURSE-LOCAL-ONLY:'+account).encode()).digest())

def pub(account):return key(account).public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
def blob(b):return struct.pack('<I',len(b))+b
def string(s):return blob(s.encode())
def uint128(n):return int(n).to_bytes(16,'little')
def function(name,args,gas=300_000_000_000_000,deposit=0):
 return b'\x02'+string(name)+blob(json.dumps(args,separators=(',',':')).encode())+struct.pack('<Q',gas)+uint128(deposit)
def transfer(amount):return b'\x03'+uint128(amount)
def deploy(code):return b'\x01'+blob(code)
class LocalRPC:
 def __init__(self,url='http://127.0.0.1:18545'):
  p=urllib.parse.urlparse(url)
  assert p.scheme=='http' and p.hostname=='127.0.0.1' and p.port is not None,'LOCAL RPC ONLY'
  self.url=url;self.nonces={}
  status=self.rpc('status',[])
  assert status['chain_id']==CHAIN_ID,'Refusing signing outside synthetic local chain'
 def rpc(self,method,params):
  request=urllib.request.Request(self.url,json.dumps({'jsonrpc':'2.0','id':'local-m5c','method':method,'params':params}).encode(),headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(request,timeout=60) as response:out=json.load(response)
  if 'error' in out:raise RuntimeError(json.dumps(out['error']))
  return out['result']
 def view(self,account,method,args,finality='final'):
  result=self.rpc('query',{'request_type':'call_function','finality':finality,'account_id':account,'method_name':method,'args_base64':base64.b64encode(json.dumps(args).encode()).decode()})
  return json.loads(bytes(result['result']))
 def account(self,account):return self.rpc('query',{'request_type':'view_account','finality':'final','account_id':account})
 def state(self,account):return self.rpc('query',{'request_type':'view_state','finality':'final','account_id':account,'prefix_base64':''})['values']
 def raw_transaction(self,signer,target,actions):
  # Endpoint/chain identity is rechecked before EVERY signature; no public RPC fallback exists.
  assert self.rpc('status',[])['chain_id']==CHAIN_ID
  access=self.rpc('query',{'request_type':'view_access_key','finality':'final','account_id':signer,'public_key':'ed25519:'+b58(pub(signer))})
  nonce=max(access['nonce'],self.nonces.get(signer,0))+1;self.nonces[signer]=nonce
  tx=string(signer)+b'\0'+pub(signer)+struct.pack('<Q',nonce)+string(target)+un58(access['block_hash'])+struct.pack('<I',len(actions))+b''.join(actions)
  digest=hashlib.sha256(tx).digest();signature=key(signer).sign(digest)
  key(signer).public_key().verify(signature,digest)
  return base64.b64encode(tx+b'\0'+signature).decode()
 def send(self,signer,target,actions):
  result=self.rpc('broadcast_tx_commit',[self.raw_transaction(signer,target,actions)])
  return self.outcome(result['transaction']['hash'],signer)
 def call(self,signer,target,method,args,gas=300_000_000_000_000,deposit=0):return self.send(signer,target,[function(method,args,gas,deposit)])
 def async_call(self,signer,target,method,args,gas=300_000_000_000_000,deposit=0):return self.rpc('broadcast_tx_async',[self.raw_transaction(signer,target,[function(method,args,gas,deposit)])])
 def outcome(self,tx,signer):return self.rpc('tx',{'tx_hash':tx,'sender_account_id':signer,'wait_until':'FINAL'})
 def balance(self,account):return int(self.view(TOKEN,'ft_balance_of',{'account_id':account}))
 def block_time(self):return int(self.rpc('block',{'finality':'final'})['header']['timestamp_nanosec'])

def success(result):
 assert 'SuccessValue' in result['status'],json.dumps(result['status'])
 return result
