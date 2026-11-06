import re, glob, collections

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()

print('=' * 72)
print('1) Vuex STORE 模块 (store.registerModule / new Vuex.Store)')
print('=' * 72)
mods = set(re.findall(r"registerModule\(\s*['\"]([A-Za-z0-9_/-]+)['\"]", src))
print('  store modules:', sorted(mods) if mods else '(未发现命名模块)')

print()
print('=' * 72)
print('2) HTTP 请求方法 (axios 调用形态)')
print('=' * 72)
verbs = collections.Counter(re.findall(r'axios\.(get|post|put|patch|delete)\s*\(', src))
print('  ', dict(verbs))

print()
print('=' * 72)
print('3) 领域对象上的属性访问 (this.X / 响应体 .X)')
print('=' * 72)
# 形如 .airlineturns  .payload_range 这类蛇形/驼峰领域字段
domain = collections.Counter(
    re.findall(r'\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b', src)   # 蛇形下划线字段
)
print('  蛇形字段出现次数 top 40:')
for k, v in domain.most_common(40):
    print(f'    {k:34} {v}')

print()
print('=' * 72)
print('4) Vue 组件 data() 返回的状态字段')
print('=' * 72)
pat = re.compile(r'data\s*:\s*function\s*\(\s*\)\s*\{\s*return\s*\{(.{1,900}?)\}\s*\}', re.S)
keys = collections.Counter()
for m in pat.finditer(src):
    body = m.group(1)
    for k in re.findall(r'(?:^|[,{\s])([a-zA-Z_$][A-Za-z0-9_$]{1,28})\s*:', body):
        keys[k] += 1
print(f'  组件数量(含 data()): {len(pat.findall(src))}')
print('  状态字段 top 60:')
for k, v in keys.most_common(60):
    print(f'    {k:32} {v}')