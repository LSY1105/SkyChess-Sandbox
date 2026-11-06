import re, glob

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()

print('=' * 78)
print('SkyChess 计算/解析方法体  (resolve* / compute* / prepare* / calculate*)')
print('=' * 78)

names = set(re.findall(
    r'(?:^|[,{\s])((?:[A-Za-z_$][\w$]{0,20})?(?:resolve|compute|calculate|prepare|derive|'
    r'interpolate|estimate)[A-Za-z0-9_$]{0,30})\s*:\s*function\s*\(', src))

print(f'识别到 {len(names)} 个方法：\n')
for n in sorted(names):
    print('   -', n)

print()
print('=' * 78)
print('方法实现 (最多 40 条)')
print('=' * 78)

shown = 0
seen = set()
for n in sorted(names):
    m = re.search(re.escape(n) + r'\s*:\s*function\s*\(([^)]*)\)\s*\{', src)
    if not m:
        continue
    start = m.end() - 1
    depth, i = 0, start
    while i < len(src):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = src[start:i + 1]
    key = re.sub(r'\b[a-zA-Z_$][\w$]{2,}\b', 'X', body)[:70]
    if key in seen:
        continue
    seen.add(key)
    shown += 1
    if shown > 40:
        break
    print(f'--- {n}({m.group(1)[:60]})  [{len(body)} 字符]')
    print('   ', body[:520].replace('\n', ' '))
    print()