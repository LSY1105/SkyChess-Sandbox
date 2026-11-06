"""把 capture-full.json 中所有 API 响应解码保存为基线快照，供明日对比。"""
import json, base64, os, sys

CAP = sys.argv[1] if len(sys.argv) > 1 else 'capture-full.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'state-baseline.json'

lines = [l for l in open(CAP, encoding='utf-8')
         if l.strip() and not l.startswith('{"rea_progress"')]
n = json.loads(lines[-1])['normalized_result']
items = n['events']['items']

sc = json.load(open('scenario-capture.json', encoding='utf-8'))
steps, cur = {}, '?'
for i, a in enumerate(sc['actions']):
    if a['action'] == 'goto':
        cur = a['destination']['url']
    steps[i] = cur

url_by_tx, step_by_tx = {}, {}
for e in items:
    if e.get('kind') == 'response':
        u = (e.get('url') or {}).get('url', '')
        if u:
            url_by_tx[e['transaction_id']] = u
            step_by_tx[e['transaction_id']] = e['step_index']

snapshot = {}
for e in items:
    if e.get('kind') != 'network-content' or e['phase'] != 'response':
        continue
    tx = e['transaction_id']
    u = url_by_tx.get(tx, '')
    if '/play/api/' not in u or e['body'].get('state') != 'captured':
        continue
    try:
        obj = json.loads(base64.b64decode(e['body']['content']))
    except Exception:
        continue
    key = u.replace('https://www.skychess.com', '')
    route = steps.get(step_by_tx.get(tx, 0), '?').replace(
        'https://www.skychess.com/play/airline/833', '').rstrip('/') or '/(dashboard)'
    if key in snapshot:
        continue
    snapshot[key] = {'route': route, 'payload': obj}

meta = {
    'capture_file': CAP,
    'evidence_id': json.loads(lines[-1])['evidence_id'],
    'endpoint_count': len(snapshot),
    'endpoints': sorted(snapshot),
}

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump({'meta': meta, 'snapshots': snapshot}, f,
              ensure_ascii=False, indent=1)

print(f'已保存 {OUT}')
print(f'  端点数: {len(snapshot)}')
print(f'  证据: {meta["evidence_id"]}')
for k in sorted(snapshot):
    size = len(json.dumps(snapshot[k]['payload'], ensure_ascii=False))
    print(f'    {k:48} {size:>8} bytes')