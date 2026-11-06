import re, sys, glob

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()

BS = chr(92)  # backslash


def expr_at(i):
    """从 i 处的字符串字面量开始，读取完整的 JS 拼接表达式"""
    out = []
    pos = i
    while pos < len(src):
        ch = src[pos]
        if ch == '"':
            j = pos + 1
            buf = []
            while j < len(src) and src[j] != '"':
                if src[j] == BS:
                    buf.append(src[j:j + 2])
                    j += 2
                else:
                    buf.append(src[j])
                    j += 1
            out.append('"' + ''.join(buf) + '"')
            pos = j + 1
        elif ch == '+' and out:
            k = pos + 1
            while k < len(src) and src[k] in ' \t':
                k += 1
            if k < len(src) and src[k] == '"':
                out.append('+')
                pos = k
            else:
                break
        else:
            break
    return ''.join(out)


seen = {}
for m in re.finditer(r'"(/(?:play|admin)/api/)', src):
    e = expr_at(m.start())
    if len(e) > 8:
        seen.setdefault(e, 0)

rows = sorted(seen.keys(), key=lambda s: (0 if '/play/api' in s else 1, s))
play = [r for r in rows if '/play/api' in r]
adm = [r for r in rows if '/admin/api' in r]

print('###### PLAYER API  /play/api  - %d 条完整路由模板' % len(play))
for e in play:
    print('  ', e)
print()
print('###### ADMIN API  /admin/api  - %d 条完整路由模板' % len(adm))
for e in adm:
    print('  ', e)