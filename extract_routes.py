import re, glob

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()

# 找到 "...Route:function(){ ... return "/play|admin/api/..." }" 的方法名与完整表达式
pat = re.compile(
    r'([A-Za-z0-9_$]{2,40}Route)\s*:\s*function\s*\(\s*\)\s*\{(.{0,600}?return\s*)'
    r'"((?:[^"\\]|\\.)*)"((?:\s*\+\s*(?:this|[A-Za-z0-9_$.]+|"[^"]*"))*)'
)

rows = {}
for m in pat.finditer(src):
    name = m.group(1)
    head = m.group(3)
    tail = m.group(4) or ''
    # 把 tail 里的变量名整理成模板
    tmpl = head + ''.join(tail)
    key = tmpl
    if '/play/api' not in key and '/admin/api' not in key:
        continue
    rows.setdefault(key, set()).add(name)

play = sorted(k for k in rows if '/play/api' in k)
adm = sorted(k for k in rows if '/admin/api' in k)

print('#'*70)
print('# PLAYER API  (/play/api)   - %d routes' % len(play))
print('#'*70)
for k in play:
    print('  ' + k)
    print('       methods: ' + ', '.join(sorted(rows[k])))
    print()

print('#'*70)
print('# ADMIN / GAME-MASTER API  (/admin/api)   - %d routes' % len(adm))
print('#'*70)
for k in adm:
    print('  ' + k)
    print('       methods: ' + ', '.join(sorted(rows[k])))
    print()