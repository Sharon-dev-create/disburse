import concurrent.futures,urllib.request,pathlib,hashlib,json,time
p=pathlib.Path('/tmp/disburse-m5c-tools');url='https://s3.us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz';started=time.time()
req=urllib.request.Request(url,headers={'Range':'bytes=0-0'})
with urllib.request.urlopen(req,timeout=15) as r:
 total=int(r.headers['Content-Range'].split('/')[-1]);r.read(1)
size=1024*1024

def part(i):
 a=i*size;b=min(total-1,a+size-1);f=p/f'chunk-{i}'
 req=urllib.request.Request(url,headers={'Range':f'bytes={a}-{b}'})
 with urllib.request.urlopen(req,timeout=15) as r:
  if r.status!=206:raise ValueError('Range unavailable')
  data=r.read(size+1)
 if len(data)!=b-a+1:raise ValueError('Incomplete range')
 f.write_bytes(data);return i
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 for i in pool.map(part,range((total+size-1)//size)): print('chunk',i,flush=True)
f=p/'parallel.tar.gz'
with f.open('wb') as w:
 for i in range((total+size-1)//size): w.write((p/f'chunk-{i}').read_bytes())
h=hashlib.sha256(f.read_bytes()).hexdigest();assert h=='a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691';print(json.dumps({'bytes':total,'sha256':h,'seconds':time.time()-started}))
