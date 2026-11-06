import json, base64

lines = [l for l in open('capture-full.json', encoding='utf-8')
         if l.strip() and not l.startswith('{"rea_progress"')]
n = json.loads(lines[-1])['normalized_result']
items = n['events']['items']

url_by_tx = {}
for e in items:
    if e.get('kind') == 'response':
        u = (e.get('url') or {}).get('url', '')
        if u:
            url_by_tx[e['transaction_id']] = u

seen = {}
for e in items:
    if e.get('kind') != 'network-content' or e['phase'] != 'response':
        continue
    u = url_by_tx.get(e['transaction_id'], '')
    if '/play/api/' not in u or e['body'].get('state') != 'captured':
        continue
    try:
        seen[u] = json.loads(base64.b64decode(e['body']['content']))
    except Exception:
        pass

print('=' * 78)
print('★ 游戏配置 (game)')
print('=' * 78)
for u, o in seen.items():
    if 'game' in o:
        print(f'来源端点: {u.replace("https://www.skychess.com", "")}')
        print(json.dumps(o['game'], ensure_ascii=False, indent=2))
        break

print()
print('=' * 78)
print('★ 航空公司 (airline)')
print('=' * 78)
for u, o in seen.items():
    if 'airline' in o:
        print(json.dumps(o['airline'], ensure_ascii=False, indent=2)[:1800])
        break

print()
print('=' * 78)
print('★ 回合 (airlineturn / turn)')
print('=' * 78)
for u, o in seen.items():
    if 'airlineturn' in o:
        at = o['airlineturn']
        print('airlineturn.id       =', at.get('id'))
        print('airlineturn.turn_id  =', at.get('turn_id'))
        t = at.get('turn')
        if t:
            print('turn =', json.dumps(t, ensure_ascii=False, indent=2)[:1200])
        mk = at.get('markets')
        if mk is not None:
            print(f'markets: {type(mk).__name__} len={len(mk) if hasattr(mk,"__len__") else "?"}')
            print('  样例:', json.dumps(mk[:2] if isinstance(mk, list) else mk,
                                     ensure_ascii=False)[:700])
        ac = at.get('aircraft')
        if ac is not None:
            print(f'aircraft: {type(ac).__name__} len={len(ac) if hasattr(ac,"__len__") else "?"}')
            print('  样例:', json.dumps(ac[:2] if isinstance(ac, list) else ac,
                                     ensure_ascii=False)[:900])
        break

print()
print('=' * 78)
print('★ 全部端点的顶层键与体积')
print('=' * 78)
for u, o in sorted(seen.items()):
    keys = list(o.keys()) if isinstance(o, dict) else type(o).__name__
    print(f'  {u.replace("https://www.skychess.com",""):52} {keys}')