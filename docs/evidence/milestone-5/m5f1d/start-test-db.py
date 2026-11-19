import subprocess,pathlib,json,tempfile
h=pathlib.Path(tempfile.mkdtemp(prefix='disburse-m5f1d-pg-'));b='/usr/lib/postgresql/17/bin/'
subprocess.run([b+'initdb','-D',str(h/'data'),'-A','trust','--no-locale'],check=True,stdout=subprocess.DEVNULL)
subprocess.run([b+'pg_ctl','-D',str(h/'data'),'-l',str(h/'server.log'),'-o',f'-h 127.0.0.1 -p 19556 -k {h}','-w','start'],check=True)
subprocess.run([b+'createuser','-h','127.0.0.1','-p','19556','disburse_test'],check=True)
subprocess.run([b+'createdb','-h','127.0.0.1','-p','19556','-O','disburse_test','disburse_test'],check=True)
pathlib.Path('/tmp/m5f1d-db.json').write_text(json.dumps({'home':str(h),'port':19556}))
