"""对比两次抓取的 API 数据快照，输出变化报告。

用法: python compare_state.py state-baseline.json state-turn1.json
"""
import json, sys

a = json.load(open(sys.argv[1], encoding='utf-8'))['snapshots']
b = json.load(open(sys.argv[2], encoding='utf-8'))['snapshots']

SEV = {'removed': '!! 消失', 'added': '++ 新增'}


def dig(o, path):
    cur = o
    for p in path:
        if isinstance(cur, dict):
            cur = cur.get(p)
        elif isinstance(cur, list) and isinstance(p, int) and p < len(cur):
            cur = cur[p]
        else:
            return None
    return cur


def walk(x, path=()):
    """产出 (路径, 标量值) 对"""
    if isinstance(x, dict):
        for k, v in x.items():
            yield from walk(v, path + (k,))
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from walk(v, path + (i,))
    else:
        yield path, x


fa, fb = dict(walk(a)), dict(walk(b))

print('=' * 78)
print(f'基线: {sys.argv[1]}   ({len(fa)} 个标量路径)')
print(f'本次: {sys.argv[2]}   ({len(fb)} 个标量路径)')
print('=' * 78)

only_a = sorted(set(fa) - set(fb))
only_b = sorted(set(fb) - set(fa))
changed = [(p, fa[p], fb[p]) for p in sorted(set(fa) & set(fb)) if fa[p] != fb[p]]

print(f'\n消失的路径: {len(only_a)}')
print(f'新增的路径: {len(only_b)}')
print(f'值变化的路径: {len(changed)}')

if changed:
    print('\n' + '-' * 78)
    print('★ 值变化明细 (前 120 条)')
    print('-' * 78)
    for p, x, y in changed[:120]:
        print(f'  {".".join(str(i) for i in p)}')
        print(f'      {x!r}  ->  {y!r}')

if only_b:
    print('\n' + '-' * 78)
    print('★ 新增路径 (前 60 条) — 通常代表系统开放后新出现的数据')
    print('-' * 78)
    for p in only_b[:60]:
        print(f'  {".".join(str(i) for i in p)} = {fb[p]!r}')

if only_a:
    print('\n' + '-' * 78)
    print('★ 消失路径 (前 40 条)')
    print('-' * 78)
    for p in only_a[:40]:
        print(f'  {".".join(str(i) for i in p)} = {fa[p]!r}')