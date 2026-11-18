import pathlib,urllib.request,time,hashlib,concurrent.futures,json
p=pathlib.Path('/tmp/disburse-m5c-tools');total=35582480;size=1048576;url='https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz'
def part(i):
 a=i*size;b=min(total-1,a+size-1);f=p/f'chunk-{i}'
 if f.exists() and f.stat().st_size==b-a+1:return i,'cached'
 for attempt in range(1):
  try:
   deadline=time.monotonic()+90;data=bytearray();req=urllib.request.Request(url,headers={'Range':f'bytes={a}-{b}'})
   with urllib.request.urlopen(req,timeout=15) as r:
    assert r.status==206 and r.headers['Content-Range']==f'bytes {a}-{b}/{total}'
    while len(data)<b-a+1:
     if time.monotonic()>deadline:raise TimeoutError('part deadline')
     chunk=r.read(min(65536,b-a+1-len(data)))
     if not chunk:raise ValueError('incomplete range')
     data.extend(chunk)
   f.write_bytes(data);return i,'downloaded'
  except Exception as e:
   if attempt==0:return i,type(e).__name__
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 for future in concurrent.futures.as_completed([pool.submit(part,i) for i in range((total+size-1)//size)]):print(json.dumps(future.result()),flush=True)
f=p/'parallel.tar.gz'
with f.open('wb') as w:
 for i in range((total+size-1)//size):
  c=p/f'chunk-{i}';assert c.stat().st_size==min(size,total-i*size);w.write(c.read_bytes())
h=hashlib.sha256(f.read_bytes()).hexdigest();assert h=='a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691';print(json.dumps({'result':'PASS','sha256':h}))
