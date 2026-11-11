#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重写远端仓库历史：剔除误提交过的**隔离测试密钥文件**，保留全部提交信息与内容。
用法：
  python rewrite_history.py <repo> <branch> --dry-run     # 只报告将要发生什么
  python rewrite_history.py <repo> <branch> --apply       # 真正执行（本地 git 为权威备份）
"""
import json, sys, urllib.request, urllib.error, time

TOKEN = None
def token():
    global TOKEN
    if TOKEN: return TOKEN
    import subprocess
    out = subprocess.run(['git', 'credential', 'fill'],
                         input=('protocol=https' + chr(10) + 'host=github.com' + chr(10) + chr(10)),
                         capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    for line in out.splitlines():
        if line.startswith('password='):
            TOKEN = line.split('=', 1)[1].strip(); return TOKEN
    raise SystemExit('未找到 GitHub 凭据')

def api(method, path, payload=None, retries=4, timeout=90):
    url = 'https://api.github.com' + path
    data = json.dumps(payload).encode() if payload is not None else None
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method=method)
            req.add_header('Authorization', 'Bearer ' + token())
            req.add_header('Accept', 'application/vnd.github+json')
            req.add_header('User-Agent', 'skychess-rewrite')
            if data: req.add_header('Content-Type', 'application/json')
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode() or '{}')
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            last = f'HTTP {e.code}: {body}'
            if e.code in (403, 429): time.sleep(3 * (i + 1))
            else: break
        except Exception as e:
            last = str(e); time.sleep(2 * (i + 1))
    raise RuntimeError(f'{method} {path} 失败: {last}')

# 要从历史中剔除的路径（隔离测试实例的密钥）
DROP = [
    'sandbox/.sandbox-test-keys.json',
    'sandbox/.sandbox-test-keys-8767.json',
    'sandbox/.sandbox-t8.json',
    'sandbox/.sandbox-panel-keys-0.json',
    'sandbox/.sandbox-panel-keys-1.json',
]
def is_drop(path):
    return path in DROP or path.startswith('sandbox/.sandbox-test-keys-') \
        or path.startswith('sandbox/.sandbox-panel-keys-') or path == 'sandbox/.sandbox-t8.json'

def main():
    repo = sys.argv[1]; branch = sys.argv[2]
    apply = '--apply' in sys.argv
    ref = api('GET', f'/repos/{repo}/git/ref/heads/{branch}')
    head = ref['object']['sha']
    print(f'远端 {branch} 当前 HEAD = {head[:7]}')

    # 1) 取提交链（新 → 旧）
    chain, sha = [], head
    while sha:
        c = api('GET', f'/repos/{repo}/git/commits/{sha}')
        chain.append(c)
        sha = c['parents'][0]['sha'] if c.get('parents') else None
    chain.reverse()   # 旧 → 新
    print(f'共 {len(chain)} 个提交')

    # 2) 报告将要删除的路径
    hits = set()
    for c in chain:
        t = api('GET', f"/repos/{repo}/git/trees/{c['tree']['sha']}?recursive=1")
        for e in t.get('tree', []):
            if e.get('type') == 'blob' and is_drop(e['path']):
                hits.add(e['path'])
    print('历史中出现的密钥文件：', sorted(hits) if hits else '（无）')
    if not hits:
        print('无需重写。'); return
    if not apply:
        print('\n--dry-run：未改动任何东西。确认后加 --apply 执行。'); return

    # 3) 逐个重建（tree 剔除密钥 → 新 commit，parent 指向新父）
    new_parent = None
    for i, c in enumerate(chain, 1):
        t = api('GET', f"/repos/{repo}/git/trees/{c['tree']['sha']}?recursive=1")
        rm = [{'path': e['path'], 'mode': e['mode'], 'type': 'blob', 'sha': None}
              for e in t.get('tree', []) if e.get('type') == 'blob' and is_drop(e['path'])]
        tree_sha = c['tree']['sha']
        if rm:
            payload = {'base_tree': c['tree']['sha'], 'tree': rm}
            tree_sha = api('POST', f'/repos/{repo}/git/trees', payload)['sha']
        body = {
            'message': c['message'],
            'tree': tree_sha,
            'parents': [new_parent] if new_parent else [],
            'author': c.get('author'), 'committer': c.get('committer'),
        }
        nc = api('POST', f'/repos/{repo}/git/commits', body)
        new_parent = nc['sha']
        if i % 10 == 0 or i == len(chain):
            print(f'  重建 {i}/{len(chain)} → {new_parent[:7]}')

    # 4) 强制更新分支指针
    api('PATCH', f'/repos/{repo}/git/refs/heads/{branch}', {'sha': new_parent, 'force': True})
    print(f'\n✓ 历史已重写：{branch} → {new_parent[:7]}（旧 HEAD {head[:7]}）')

if __name__ == '__main__':
    main()
