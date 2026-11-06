import re, glob, collections

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()

# 收集所有蛇形领域字段
fields = collections.Counter(re.findall(r'\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b', src))

GROUPS = {
    '机队 / 租赁经济': ['lease', 'residual', 'depreciat', 'rent', 'owned', 'on_operating'],
    '融资 / 对冲': ['interest', 'funding', 'strike', 'hedge', 'loan', 'debt', 'bond'],
    '机型容量': ['seats_', 'cargo_', 'payload', 'capacity', 'range', 'bh', 'minimum_bh'],
    '运行成本': ['fuel', 'fee', 'burn', 'cost', 'price', 'expense'],
    '需求 / 收益': ['demand', 'pricing', 'fare', 'revenue', 'yield', 'load'],
    '时间 / 回合': ['turn', 'minutes', 'schedule', 'departure', 'arrival', 'slot'],
    '航线 / 市场': ['market', 'route', 'sector', 'hub', 'connecting', 'origin', 'destination'],
}

used = set()
print('=' * 74)
print('SkyChess 航空公司经营模型 — 领域字段分组')
print('=' * 74)
for gname, kws in GROUPS.items():
    rows = [(k, v) for k, v in fields.items() if any(w in k for w in kws)]
    rows.sort(key=lambda kv: -kv[1])
    if not rows:
        continue
    print(f'\n### {gname}  ({len(rows)} 个字段)')
    for k, v in rows[:26]:
        used.add(k)
        print(f'    {k:36} {v:4}')

rest = [(k, v) for k, v in fields.items() if k not in used]
rest.sort(key=lambda kv: -kv[1])
print(f'\n### 其他领域字段  ({len(rest)} 个)')
for k, v in rest[:30]:
    print(f'    {k:36} {v:4}')

print()
print('=' * 74)
print('识别到的计算方法名 (compute/calculate/resolve/derive 形态)')
print('=' * 74)
calc = collections.Counter(re.findall(
    r'\b(compute[A-Za-z0-9]{2,40}|calculate[A-Za-z0-9]{2,40}|[a-z]+[Nn]et[A-Za-z0-9]{2,30})\b', src))
for k, v in calc.most_common(45):
    print(f'    {k:42} {v:4}')