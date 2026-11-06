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


def brief(o, depth=0, maxk=40):
    """紧凑展示嵌套结构"""
    ind = '  ' * depth
    if isinstance(o, dict):
        for k, v in list(o.items())[:maxk]:
            if isinstance(v, list):
                print(f'{ind}{k}: list[{len(v)}]')
                if v:
                    brief(v[0], depth + 1, 18)
            elif isinstance(v, dict):
                print(f'{ind}{k}: object({len(v)})')
                brief(v, depth + 1, 18)
            else:
                print(f'{ind}{k} = {str(v)[:80]}')
    elif isinstance(o, list):
        print(f'{ind}list[{len(o)}]')
        if o:
            brief(o[0], depth + 1, 18)


print('=' * 78)
print('★ 航线市场 (markets) 结构与首条样例')
print('=' * 78)
for u, o in seen.items():
    if 'airlineturn' in o and isinstance(o['airlineturn'].get('markets'), list) \
            and o['airlineturn']['markets']:
        mk = o['airlineturn']['markets']
        print(f'来源: {u.replace("https://www.skychess.com","")}')
        print(f'markets 共 {len(mk)} 条')
        brief(mk[:2], 0, 30)
        break

print()
print('=' * 78)
print('★ 运价 (fares) 结构')
print('=' * 78)
for u, o in seen.items():
    if '/fares/' in u:
        print(f'来源: {u.replace("https://www.skychess.com","")}')
        for k, v in o.items():
            if isinstance(v, list):
                print(f'  {k}: list[{len(v)}]')
                if v:
                    brief(v[0], 2, 22)
            elif isinstance(v, dict):
                print(f'  {k}: object({len(v)}) keys={list(v)[:14]}')
            else:
                print(f'  {k} = {str(v)[:60]}')
        break

print()
print('=' * 78)
print('★ 运价矩阵 (fare-matrix)')
print('=' * 78)
for u, o in seen.items():
    if '/fare-matrix/' in u:
        print(f'来源: {u.replace("https://www.skychess.com","")}')
        print('顶层键:', list(o.keys()))
        for k, v in o.items():
            if isinstance(v, list):
                print(f'  {k}: list[{len(v)}]')
                if v:
                    brief(v[0], 2, 22)
            elif isinstance(v, dict):
                print(f'  {k}: object({len(v)}) keys={list(v)[:16]}')
            else:
                print(f'  {k} = {str(v)[:60]}')
        break

print()
print('=' * 78)
print('★ 机队 (schedule.aircraft)')
print('=' * 78)
for u, o in seen.items():
    if '/schedules/' in u:
        sch = o.get('schedule', {})
        ac = sch.get('aircraft')
        print(f'来源: {u.replace("https://www.skychess.com","")}')
        if isinstance(ac, list):
            print(f'  schedule.aircraft: list[{len(ac)}]')
            if ac:
                brief(ac[0], 1, 26)
        else:
            print('  schedule keys:', list(sch.keys()))
        break