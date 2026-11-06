"""重建运价时间序列 —— 从所有 API 快照中提取每个回合每条航线的运价。

回合编号 → 期间:
  turn0=2027Q4  turn1=2028Q1  turn2=2028Q2  turn3=2028Q3
  turn4=2028Q4  turn5=2029Q1  turn6=2029Q2
"""
import json, glob, os

PERIOD = {0: 'Q4/2027', 1: 'Q1/2028', 2: 'Q2/2028', 3: 'Q3/2028',
          4: 'Q4/2028', 5: 'Q1/2029', 6: 'Q2/2029'}

# 汇总所有快照，turns[N].markets[].fare（同名取最新非空）
acc = {}
for f in sorted(glob.glob('state-*.json')):
    try:
        b = json.load(open(f, encoding='utf-8'))['snapshots']
        airline = b['/play/api/airline/833']['payload']['airline']
    except Exception:
        continue
    for idx, t in enumerate(airline.get('turns', [])):
        tn = t.get('turn')
        if isinstance(tn, dict):
            tn = idx            # turns[].turn 是关联对象，用列表位置
        if tn is None:
            continue
        for m in (t.get('markets') or []):
            gm = (m.get('gamemarket') or {}).get('market') or {}
            code = gm.get('code')
            fare = m.get('fare')
            if code and fare is not None:
                acc.setdefault((tn, code), set()).add(float(fare))

print('=' * 74)
print('运价时间序列（括号内为同一回合在不同快照中出现过的不同取值）')
print('=' * 74)
codes = sorted({c for _, c in acc})
hdr = [PERIOD[t] for t in range(7)]
print(f'{"市场":<6}' + ''.join(f'{h:>16}' for h in hdr))
fare_tab = {}
for c in codes:
    line = f'{c:<6}'
    for t in range(7):
        v = acc.get((t, c))
        if not v:
            line += f'{"-":>16}'
        elif len(v) == 1:
            line += f'{list(v)[0]:>16,.0f}'
        else:
            line += ('{%s}' % '/'.join(f'{x:,.0f}' for x in sorted(v))).rjust(16)
        fare_tab[(t, c)] = sorted(v)[-1] if v else None
    print(line)

json.dump({f'{t}:{c}': fare_tab[(t, c)] for (t, c) in fare_tab},
          open('fares_by_turn.json', 'w', encoding='utf-8'), indent=1)
print('\n已保存 fares_by_turn.json')

print()
print('=' * 74)
print('校验：单值回合的运价变化轨迹')
print('=' * 74)
for c in ['SIM', 'LEW', 'ETN', 'ARM', 'JOP', 'BZY']:
    seq = [fare_tab.get((t, c)) for t in range(7)]
    if any(x is not None for x in seq):
        print(f'  {c:5} ' + ' '.join(f'{x:>8,.0f}' if x else f'{"-":>8}' for x in seq))