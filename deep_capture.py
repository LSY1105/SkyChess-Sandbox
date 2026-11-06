"""深度采集执行器 —— 生成场景、执行、导出全部工件。

用法: python deep_capture.py [标签]
"""
import json, os, sys, subprocess, time, base64, glob

HERE = os.path.dirname(os.path.abspath(__file__))
NODE64 = 'C:/Users/qjl10/AppData/Local/rea-node64/node-v22.23.3-win-x64/node.exe'
REA = ('C:/Users/qjl10/AppData/Local/pi-node/current/node_modules/'
       'rea-agents/scripts/rea.mjs')
CDP = 'http://127.0.0.1:9222'
ORIGIN = 'https://www.skychess.com'


def py(script, *args):
    return subprocess.run(['python', script] + list(args), capture_output=True,
                          text=True, encoding='utf-8', errors='replace', cwd=HERE)


def get_target():
    try:
        out = subprocess.run(['curl', '-s', '-m', '8', CDP + '/json/list'],
                             capture_output=True, text=True).stdout
        for t in json.loads(out):
            if t['type'] == 'page' and 'skychess' in t['url']:
                return t['id']
    except Exception:
        pass
    return None


def run(label):
    os.chdir(HERE)
    sc_file = f'scenario-deep-{label}.json'
    cap_file = f'capture-deep-{label}.json'

    tid = get_target()
    if not tid:
        print('!! 未找到 SkyChess 标签页'); return False
    print(f'  target={tid}')

    r = py('make_deep_scenario.py', tid, sc_file)
    print('  ' + r.stdout.strip())
    if r.returncode != 0:
        print(r.stderr[:400]); return False

    # 刷新 target（场景生成期间页面可能被导航）
    tid2 = get_target() or tid
    if tid2 != tid:
        sc = json.load(open(sc_file, encoding='utf-8'))
        sc['browser']['target_id'] = tid2
        json.dump(sc, open(sc_file, 'w', encoding='utf-8'), ensure_ascii=False)
        print(f'  target 已刷新 -> {tid2}')

    print('  执行中（约 3-6 分钟）...')
    t0 = time.time()
    p = subprocess.run([NODE64, REA, 'capture-browser-scenario', sc_file,
                        '--format', 'json'],
                       capture_output=True, text=True,
                       encoding='utf-8', errors='replace', cwd=HERE)
    open(cap_file, 'w', encoding='utf-8').write(p.stdout)
    el = time.time() - t0
    print(f'  完成 {el:.0f}s, 输出 {os.path.getsize(cap_file):,} bytes')

    if '"normalized_result"' not in p.stdout:
        try:
            err = json.loads([l for l in p.stdout.splitlines()
                              if l.strip()][-1])
            print('  失败:', err.get('code'), err.get('message'))
        except Exception:
            print('  失败:', p.stdout[:300])
        return False
    return True


def export(label):
    cap = f'capture-deep-{label}.json'
    lines = [l for l in open(cap, encoding='utf-8')
             if l.strip() and not l.startswith('{"rea_progress"')]
    d = json.loads(lines[-1])
    n = d['normalized_result']

    out = f'a11y/deep-{label}'
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(f'{out}/*.yaml'):
        os.remove(f)

    # step -> 目标 URL
    url_by_step = {}
    for e in n['events']['items']:
        if e.get('kind') == 'response' and e.get('resource_type') == 'document':
            u = (e.get('url') or {}).get('url', '')
            if 'skychess.com' in u:
                url_by_step[e['step_index']] = u

    tab_of = {}
    for i, s in enumerate(n['steps']):
        if s['action'] == 'goto':
            tab_of[i] = url_by_step.get(i, '')
        elif s['action'] == 'click':
            tab_of[i] = 'TAB:' + s['step_id']

    cnt = 0
    for i, s in enumerate(n['steps']):
        a = (s.get('artifacts') or {}).get('accessibility') or {}
        v = a.get('value') or {}
        txt = v.get('text') if isinstance(v, dict) else None
        if not txt:
            continue
        tag = str(tab_of.get(i, ''))
        tag = (tag.replace('https://www.skychess.com/play/airline/833', '')
                  .replace('https://www.skychess.com', '')
                  .strip('/').replace('/', '_') or 'dash')
        fn = f'{out}/step{i:03d}-{s["step_id"]}-{tag[:26]}.yaml'
        open(fn, 'w', encoding='utf-8').write(txt)
        cnt += 1

    ev = n['events']
    print(f'  导出 {cnt} 份无障碍树 -> {out}/')
    print(f'  事件 retained={ev.get("retained")} dropped={ev.get("dropped")}')
    om = ev.get('omissions', {}).get('by_kind', [])
    if om:
        print(f'  丢弃: {json.dumps(om, ensure_ascii=False)[:200]}')
    return cnt


def summarise(label):
    cap = f'capture-deep-{label}.json'
    lines = [l for l in open(cap, encoding='utf-8')
             if l.strip() and not l.startswith('{"rea_progress"')]
    n = json.loads(lines[-1])['normalized_result']
    rt = {}
    for e in n['events']['items']:
        if e.get('kind') == 'response':
            rt[e['transaction_id']] = ((e.get('url') or {}).get('url', ''),
                                        e.get('resource_type'))
    api = {}
    for e in n['events']['items']:
        if e.get('kind') == 'request' and str(e.get('resource_type')).lower() \
                in ('xhr', 'fetch'):
            u = rt.get(e['transaction_id'], ('', ''))[0] or \
                (e.get('url') or {}).get('url', '')
            if '/api/' in u:
                api[u.replace(ORIGIN, '')] = api.get(
                    u.replace(ORIGIN, ''), 0) + 1
    print('  捕获 API:')
    for u, c in sorted(api.items()):
        print(f'    x{c:<4} {u}')
    return api


if __name__ == '__main__':
    label = sys.argv[1] if len(sys.argv) > 1 else time.strftime('%H%M')
    print(f'=== 深度采集 {label} ===')
    if run(label):
        export(label)
        summarise(label)
        print('\n完成')