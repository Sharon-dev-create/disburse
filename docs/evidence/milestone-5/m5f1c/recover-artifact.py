import concurrent.futures, pathlib, urllib.request, time, hashlib, tarfile, json
root=pathlib.Path('/tmp/disburse-m5c-tools'); total=35582480; size=1048576; start=time.monotonic(); deadline=start+180
urls=['https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz','https://s3.us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz']
missing=[i for i in range((total+size-1)//size) if not (root/f'chunk-{i}').exists() or (root/f'chunk-{i}').stat().st_size!=min(size,total-i*size)]
print(json.dumps({'missing':missing,'deadline_seconds':180}),flush=True)
def fetch(task):
 i,j=task;a=i*size+j*65536;b=min(a+65536,total,(i+1)*size)-1;p=root/f'c-sub-{i}-{j}'
 if p.exists() and p.stat().st_size==b-a+1:return True
 for attempt in range(2):
  if time.monotonic()>deadline:return False
  try:
   req=urllib.request.Request(urls[attempt%2],headers={'Range':f'bytes={a}-{b}'})
   with urllib.request.urlopen(req,timeout=10) as r:
    if r.status!=206 or r.headers.get('Content-Range')!=f'bytes {a}-{b}/{total}':raise ValueError('range mismatch')
    data=r.read(b-a+2)
    if len(data)!=b-a+1:raise ValueError('length mismatch')
   p.write_bytes(data);return True
  except Exception as e:
   if attempt==1:print(json.dumps({'chunk':i,'part':j,'error':type(e).__name__}),flush=True)
 return False
work=[(i,j) for i in missing for j in range((min(size,total-i*size)+65535)//65536)]
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(fetch,work))
if not all(results):print(json.dumps({'status':'BLOCKED','parts':sum(results),'required':len(results),'elapsed':time.monotonic()-start}),flush=True);raise SystemExit(2)
for i in missing:(root/f'chunk-{i}').write_bytes(b''.join((root/f'c-sub-{i}-{j}').read_bytes() for j in range((min(size,total-i*size)+65535)//65536)))
archive=root/'m5f1c-verified.tar.gz';archive.write_bytes(b''.join((root/f'chunk-{i}').read_bytes() for i in range((total+size-1)//size)))
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691'
with tarfile.open(archive) as t:t.extractall(root,filter='data')
p=root/'Linux-x86_64/near-sandbox';assert hashlib.sha256(p.read_bytes()).hexdigest()=='797b9d7a9a23907048d68a427e86a55c94f1de232dbfb8b8a1eec09ecef3bf13'
print(json.dumps({'status':'PASS','elapsed':time.monotonic()-start,'binary_sha256':hashlib.sha256(p.read_bytes()).hexdigest()}),flush=True)
