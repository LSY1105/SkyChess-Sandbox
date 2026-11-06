"""枚举页面级路由(非 API)，用于缺口审计。"""
import re, glob, collections

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()

print('=' * 80)
print('1) app.js 中的页面路由字符串')
print('=' * 80)
# /play/... 但不是 /play/api
pages = set(re.findall(r'"(/play/[a-zA-Z0-9/_-]*)"', src))
pages = {p for p in pages if not p.startswith('/play/api')}
for p in sorted(pages):
    print('  ', p)

print()
print('=' * 80)
print('2) app.js 中出现的报表/视图标识 (reports 相关)')
print('=' * 80)
for kw in ['report', 'Report', 'summary', 'Summary', 'metric', 'Metric',
           'economics', 'Economics', 'demand', 'Demand', 'liveboard', 'Liveboard',
           'ledger', 'csv', 'export', 'chart', 'Chart', 'graph', 'Graph']:
    n = src.count(kw)
    if n:
        print('  %-14s %5d' % (kw, n))

print()
print('=' * 80)
print('3) 前端路由 path 定义 (vue-router 风格 path:"..." )')
print('=' * 80)
paths = set(re.findall(r'path:\s*"([^"]{1,90})"', src))
for p in sorted(paths):
    print('  ', p)

print()
print('=' * 80)
print('4) app.js 中的组件/视图 name 标识')
print('=' * 80)
names = collections.Counter(re.findall(r'name:\s*"([A-Za-z][\w-]{2,40})"', src))
print(f'  共 {len(names)} 个 name 字段; 展示含关键词的:')
kw = ['report', 'Report', 'fleet', 'Fleet', 'fare', 'Fare', 'invest', 'Invest',
      'schedul', 'Schedul', 'catalog', 'Catalog', 'asset', 'Asset', 'board',
      'Board', 'market', 'Market', 'fuel', 'Fuel', 'aircraft', 'Aircraft']
for n, c in names.most_common():
    if any(k in n for k in kw):
        print('   %-34s %d' % (n, c))