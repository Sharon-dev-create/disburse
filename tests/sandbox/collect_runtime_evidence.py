"""Read only: collect local runtime limits, per-receipt gas, storage and upgrade ordering."""
import pathlib,json,base64,collections
from local_rpc import *
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'docs/evidence/milestone-5/m5c-implementation';cases=OUT/'sandbox';rpc=LocalRPC()
protocol=rpc.rpc('EXPERIMENTAL_protocol_config',{'finality':'final'})
(OUT/'local-protocol-config.json').write_text(json.dumps(protocol,indent=2)+'\n')
metrics=[]
for file in sorted(cases.glob('*.json')):
 x=json.loads(file.read_text())
 if 'execution' not in x or 'outcome' not in x['execution']:continue
 execution=x['execution'];rows=[]
 for receipt,result in zip(execution['receipts'],execution['outcome']['receipts_outcome']):
  actions=receipt.get('receipt',{}).get('Action',{}).get('actions',[])
  for a in actions:
   if 'FunctionCall' not in a:continue
   f=a['FunctionCall'];rows.append({'receipt_id':result['id'],'executor':result['outcome']['executor_id'],'predecessor':receipt.get('predecessor_id'),'method':f['method_name'],'arguments':json.loads(base64.b64decode(f['args'])),'deposit_yocto':f['deposit'],'prepaid_gas':f['gas'],'burnt_gas':result['outcome']['gas_burnt'],'status':result['outcome']['status'],'block_hash':result['block_hash']})
 all_results=[execution['outcome']['transaction_outcome']]+execution['outcome']['receipts_outcome'];unique={v['id']:v for v in all_results}
 item={'test':file.stem,'source':str(file.relative_to(ROOT)),'receipts':rows,'total_unique_burnt_gas':sum(o['outcome']['gas_burnt'] for o in unique.values()),'total_tokens_burnt_yocto':str(sum(int(o['outcome']['tokens_burnt']) for o in unique.values())),'storage_delta_bytes':x['after']['account']['storage_usage']-x['before']['account']['storage_usage'],'recipient_delta_atomic':str(int(x['after']['recipient_usdc'])-int(x['before']['recipient_usdc'])),'contract_delta_atomic':str(int(x['after']['contract_usdc'])-int(x['before']['contract_usdc'])),'native_status':x['after']['native']['status'],'accounting':x['after']['accounting']}
 metrics.append(item)
 if file.stem=='upgrade-between-transfer-and-callback':
  ft=next(row for row in rows if row['method']=='ft_transfer');cb=next(row for row in rows if row['method']=='on_native_transfer_result')
  upgrade=x['extra']['upgrade'];u=next(o for o in upgrade['outcome']['receipts_outcome'] if o['outcome']['executor_id']==CONTRACT)
  heights={name:int(rpc.rpc('block',{'block_id':h})['header']['height']) for name,h in [('transfer',ft['block_hash']),('upgrade',u['block_hash']),('callback',cb['block_hash'])]}
  assert heights['transfer']<=heights['upgrade']<=heights['callback'],heights
  x['extra']['verified_block_order']=heights;x['extra']['upgrade_applied_before_callback']=True
  file.write_text(json.dumps(x,indent=2)+'\n')
prefixes=[b'native-payout-mode-v1',b'native-payout-records-v1',b'native-authorization-records-v1',b'native-attempt-records-v1',b'native-execution-outcomes-v1']
sizes=collections.defaultdict(list)
for entry in rpc.state(CONTRACT):
 key=base64.b64decode(entry['key']);value=base64.b64decode(entry['value'])
 for prefix in prefixes:
  if key.startswith(prefix):sizes[prefix.decode()].append(len(key)+len(value))
summary={'scope':'Synthetic local protocol88; no production Tidepool gas guarantee','protocol_version':protocol['protocol_version'],'storage_price_yocto_per_byte':protocol['runtime_config']['storage_amount_per_byte'],'wasm_limits':protocol['runtime_config']['wasm_config']['limit_config'],'cases':metrics,'native_key_value_sizes':{p:{'records':len(v),'raw_key_value_min_bytes':min(v),'raw_key_value_max_bytes':max(v),'raw_key_value_total_bytes':sum(v)} for p,v in sizes.items()},'storage_size_limit':'Raw key/value sizes exclude protocol record overhead and WASM. Storage delta in case snapshots is actual account storage_usage.','fault_artifact_scope':'Panic, OOG, schedule-panic and incompatible-callback variants are separate test artifacts; production has no fault flag.'}
(OUT/'gas-and-storage-measurements.json').write_text(json.dumps(summary,indent=2)+'\n')
print('Collected',len(metrics),'receipt-executing cases, gas/storage/protocol metadata; no transactions submitted',flush=True)
