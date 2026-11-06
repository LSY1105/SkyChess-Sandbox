import re, glob, collections

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()

print('=' * 74)
print('1) Vue 组件清单  (vue-component 工厂 (0,n(6262).A)(name,[...]))')
print('=' * 74)
# const X=(0,n(6262).A)(NAME,[...])   /  var X=(0,t.A)(NAME,...)
pat = re.compile(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]{1,40})\s*=\s*'
                 r'\(\s*0\s*,\s*[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*\s*\)\s*\(\s*'
                 r'(?:([A-Za-z_$][\w$]*)|"([^"]*)")')
comps = []
for m in pat.finditer(src):
    name = m.group(1)
    cname = m.group(2) or m.group(3)
    comps.append((name, cname))
print('   识别到的组件:', len(comps))

# 组件的 data() 字段 -> 推断组件职责
print()
print('=' * 74)
print('2) 每个组件的 data() 状态字段 (用于反推组件职责)')
print('=' * 74)
comp_pat = re.compile(
    r'\(\s*0\s*,\s*[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*\s*\)\s*\(\s*'
    r'(?:([A-Za-z_$][\w$]*)|"([^"]*)")\s*,\s*\[\[?\s*"(?:render|data|props)"(.{0,6000}?)(?:\]\]\s*\)|\]\s*,)', re.S)

rows = []
for m in comp_pat.finditer(src):
    cname = m.group(1) or m.group(2)
    body = m.group(3)
    keys = re.findall(r'(?:^|[,{\s])([a-zA-Z_$][\w$]{2,30})\s*:\s*(?:function|\[|\{|["\d])', body)
    keys = [k for k in keys if k not in ('function', 'return')]
    rows.append((cname, keys))

print(f'   解析到 {len(rows)} 个组件的内部结构\n')
for cname, keys in rows[:45]:
    ks = ', '.join(dict.fromkeys(keys))[:150]
    print(f'   {str(cname):26} {ks}')

print()
print('=' * 74)
print('3) 经济/物理模型公式候选')
print('=' * 74)
cands = []
for m in re.finditer(r'[^\n;{}]{40,300}', src):
    s = m.group(0)
    if s.count('*') >= 2 and re.search(
            r'(lease|depreciat|residual|fuel|payload|demand|burn|fare|yield|cost|price|seats)', s, re.I):
        cands.append(s.strip())
seen, out = set(), []
for s in cands:
    k = re.sub(r'[^A-Za-z_$*+\-()/ ]', '', s)[:50]
    if k in seen:
        continue
    seen.add(k)
    out.append(s)
print(f'   命中 {len(cands)}，去重 {len(out)}，展示前 25:\n')
for s in out[:25]:
    print('   ', s[:210])
    print()