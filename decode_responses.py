import json, base64, sys

CAP = 'capture-full.json'
lines = [l for l in open(CAP, encoding='utf-8') if l.strip()
         and not l.startswith('{"rea_progress"')]
n = json.loads(lines[-1])['normalized_result']
items = n['events']['items']

# 建立 transaction_id -> url
url_by_tx = {}
for e in items:
    if e.get('kind') == 'response':
        u = (e.get('url') or {}).get('url', '')
        if u:
            url_by_tx[e['transaction_id']] = (e['step_index'], u)

sc = json.load(open('scenario-capture.json', encoding='utf-8'))
steps, cur = {}, '?'
for i, a in enumerate(sc['actions']):
    if a['action'] == 'goto':
        cur = a['destination']['url']
    steps[i] = cur

print('=' * 78)
print('SkyChess 运行时 API 响应体解码')
print('=' * 78)

results = []
for e in items:
    if e.get('kind') != 'network-content' or e['phase'] != 'response':
        continue
    tx = e['transaction_id']
    if tx not in url_by_tx:
        continue
    si, url = url_by_tx[tx]
    if '/play/api/' not in url:
        continue
    body = e['body']
    if body.get('state') != 'captured':
        continue
    raw = base64.b64decode(body['content'])
    short = url.replace('https://www.skychess.com', '')
    route = steps.get(si, '?').replace(
        'https://www.skychess.com/play/airline/833', '').rstrip('/') or '/(dashboard)'
    try:
        obj = json.loads(raw)
    except Exception:
        print(f'--- {short}  (非 JSON, {len(raw)} bytes)')
        continue
    results.append((route, short, obj, len(raw)))

print(f'成功解码 {len(results)} 个 JSON 响应\n')

for route, url, obj, size in results:
    print('=' * 78)
    print(f'路由: {route}')
    print(f'端点: {url}   ({size} bytes)')
    if isinstance(obj, dict):
        for k, v in obj.items():
            t = type(v).__name__
            if isinstance(v, list):
                print(f'   {k:34} list[{len(v)}]')
            elif isinstance(v, dict):
                print(f'   {k:34} object({len(v)} keys): '
                      f'{", ".join(list(v)[:10])}')
            else:
                print(f'   {k:34} {t} = {str(v)[:70]}')
    print()