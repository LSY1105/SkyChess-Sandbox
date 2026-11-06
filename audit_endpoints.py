"""全面枚举 app.js 中的所有路由构建器及其调用方法，用于缺口审计。
用括号配对扫描函数体，避免正则嵌套问题。"""
import re, glob, collections

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()


def body_after(open_idx):
    """给定 '{' 的位置，返回配对 '}' 的位置"""
    depth, i = 0, open_idx
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"':
            i += 1
            while i < n and src[i] != '"':
                i += 2 if src[i] == '\\' else 1
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


# 找所有 XxxRoute:function(...)  { ... }
head = re.compile(r'([A-Za-z_$][\w$]{0,25}Route)\s*:\s*function\s*\(([^)]*)\)\s*\{')
uniq = collections.defaultdict(set)

for m in head.finditer(src):
    name, params = m.group(1), m.group(2)
    close = body_after(m.end() - 1)
    if close == -1:
        continue
    body = src[m.end():close]

    r = re.search(r'return\s*"((?:[^"\\]|\\.)*)"((?:\s*\+\s*(?:this|[A-Za-z0-9_$.]+|"[^"]*"))*)', body)
    if not r:
        continue
    tmpl = (r.group(1) + (r.group(2) or '')).strip()
    if '/play/api' not in tmpl and '/admin/api' not in tmpl:
        continue

    ms = []
    for verb, tag in (('post', 'POST'), ('get', 'GET'), ('put', 'PUT'), ('delete', 'DELETE')):
        if re.search(r'axios\.' + verb + r'\s*\(', body):
            ms.append(tag)
    uniq[tmpl].add((name, '/'.join(ms) if ms else '?'))

play = {t: v for t, v in uniq.items() if '/play/api' in t}
adm = {t: v for t, v in uniq.items() if '/admin/api' in t}

print('=' * 84)
print('PLAYER API  /play/api   -- %d route templates' % len(play))
print('=' * 84)
for t in sorted(play):
    ms = sorted({m for _, m in play[t]})
    fns = sorted({f for f, _ in play[t]})
    print('  [%-10s] %s' % ('+'.join(ms), t))
    print('                 methods: ' + ', '.join(fns))

print()
print('=' * 84)
print('ADMIN API  /admin/api   -- %d route templates' % len(adm))
print('=' * 84)
for t in sorted(adm):
    ms = sorted({m for _, m in adm[t]})
    fns = sorted({f for f, _ in adm[t]})
    print('  [%-10s] %s' % ('+'.join(ms), t))
    print('                 methods: ' + ', '.join(fns))

print()
print('=' * 84)
print('ADMIN API resource buckets (gap audit)')
print('=' * 84)
buckets = collections.defaultdict(set)
for t in adm:
    m = re.search(r'/admin/api/([a-z]+)/', t)
    buckets[m.group(1) if m else '(root)'].add(t)
for k in sorted(buckets):
    print('  %-18s %3d' % (k, len(buckets[k])))

print()
print('=' * 84)
print('PLAYER API resource buckets')
print('=' * 84)
pb = collections.defaultdict(set)
for t in play:
    m = re.search(r'/play/api/([a-z]+)/?', t)
    pb[m.group(1) if m else '(root)'].add(t)
for k in sorted(pb):
    print('  %-18s %3d' % (k, len(pb[k])))