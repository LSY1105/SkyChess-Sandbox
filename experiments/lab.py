"""实验记录管理 + 报表解析 + 拟合。

配合 experiments/DESIGN.md 使用。

子命令:
  log      记录一次扰动
  report   从 a11y 树解析报表数值 -> report-<label>.json
  collect  汇总某实验的所有采样点 -> dataset
  fit      对某个因变量做拟合
"""
import json, os, re, sys, math, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
LEDGER = os.path.join(BASE, 'ledger.json')
CAPTURE_DIR = os.path.join(BASE, 'captures')


def ensure_dirs():
    os.makedirs(CAPTURE_DIR, exist_ok=True)


# ---------------------------------------------------------------- ledger
def cmd_log(argv):
    ensure_dirs()
    exp, var, base, value, note = (argv + [''] * 5)[:5]
    db = json.load(open(LEDGER, encoding='utf-8')) if os.path.exists(LEDGER) else []
    db.append({
        'seq': len(db) + 1,
        'experiment': exp,
        'variable': var,
        'baseline': base,
        'value': value,
        'ts': datetime.datetime.now().isoformat(timespec='seconds'),
        'note': note,
    })
    json.dump(db, open(LEDGER, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f'已记录 #{len(db)}  {exp}  {var}: {base} -> {value}')


# ---------------------------------------------------------------- report
RE_COL = re.compile(r'columnheader "([^"]+)"')
RE_ROW = re.compile(r'row "([^"]*)"')


def parse_report_a11y(path):
    """把无障碍树里的报表数值抽成 {section: {header: [rows]}}"""
    text = open(path, encoding='utf-8').read()
    out, cur = {}, 'root'

    # 按 H3 标题分节
    parts = re.split(r'\n\s*- heading "([^"]+)" \[level=3\]', text)
    if len(parts) > 1:
        cur = parts[0].strip() or 'root'
        out[cur] = {}
        for i in range(1, len(parts), 2):
            title, body = parts[i], parts[i + 1]
            out[title] = {'headers': re.findall(RE_COL, body),
                          'rows': re.findall(RE_ROW, body)}
    else:
        out['root'] = {'headers': re.findall(RE_COL, text),
                       'rows': re.findall(RE_ROW, text)}
    return out


def cmd_report(argv):
    label = argv[0]
    src = os.path.join(ROOT, 'a11y', f'step-19-nav19.yaml')
    if not os.path.exists(src):
        cands = sorted(f for f in os.listdir(os.path.join(ROOT, 'a11y'))
                       if f.startswith('step-19'))
        src = os.path.join(ROOT, 'a11y', cands[0]) if cands else None
    if not src:
        print('未找到报表页无障碍树，请先运行 ./capture.sh ' + label)
        return
    data = parse_report_a11y(src)
    dst = os.path.join(BASE, f'report-{label}.json')
    json.dump(data, open(dst, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f'已解析 {len(data)} 个报表区块 -> {dst}')
    for k, v in data.items():
        if v.get('rows'):
            print(f'  {k:42} rows={len(v["rows"]):3} cols={len(v["headers"])}')


# ---------------------------------------------------------------- collect
def cmd_collect(argv):
    exp = argv[0]
    db = json.load(open(LEDGER, encoding='utf-8')) if os.path.exists(LEDGER) else []
    pts = [r for r in db if r['experiment'] == exp]
    pts.sort(key=lambda r: _num(r['value']))
    dst = os.path.join(BASE, f'dataset-{exp}.json')
    json.dump({'experiment': exp, 'variable': pts[0]['variable'] if pts else '',
               'points': pts}, open(dst, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f'{exp}: {len(pts)} 个采样点 -> {dst}')
    for p in pts:
        print(f"   {p['value']:>10}  {p['ts']}  {p['note']}")


def _num(s):
    try:
        return float(str(s).replace(',', '').replace('$', ''))
    except Exception:
        return 1e18


# ---------------------------------------------------------------- fit
def linear_fit(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    a = my - b * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    r2 = 1 - ss_res / ss_tot if ss_tot else 1.0
    return {'form': 'y = a + b*x', 'a': a, 'b': b, 'r2': r2, 'n': n}


def log_fit(xs, ys):
    pts = [(x, y) for x, y in zip(xs, ys) if x > 0 and y > 0]
    if len(pts) < 2:
        return None
    return linear_fit([math.log(x) for x, _ in pts],
                      [math.log(y) for _, y in pts])


def power_fit(xs, ys):
    lf = log_fit(xs, ys)
    if not lf:
        return None
    # log y = a + b log x  ->  y = exp(a) * x^b
    return {'form': 'y = c * x^b', 'c': math.exp(lf['a']), 'b': lf['b'],
            'r2': lf['r2'], 'n': lf['n']}


def cmd_fit(argv):
    if len(argv) < 2:
        print('用法: fit <dataset.json> <xs:数据点x或"序号"> <ys...>')
        return
    ds = json.load(open(argv[0], encoding='utf-8'))
    pts = ds['points']
    if len(argv) == 2:
        print(f"变量: {ds['variable']}  采样点:")
        for i, p in enumerate(pts):
            print(f"  [{i}] {p['value']:>12}  ({p['ts']})")
        return
    xs = [_num(p['value']) for p in pts]
    if argv[1] == 'index':
        xs = list(range(len(pts)))
    ys = [_num(p.get(argv[2], 0)) for p in pts] if argv[2] in pts[0] else \
        [_num(p.get('note', 0)) for p in pts]

    print('原始点:', list(zip(xs, ys)))
    for name, fn in (('线性', linear_fit), ('对数', log_fit), ('幂律', power_fit)):
        r = fn(xs, ys)
        if r:
            if name == '线性':
                print(f"  {name}: {r['form']}  ->  a={r['a']:.6g} b={r['b']:.6g} "
                      f"R2={r['r2']:.4f}")
            elif name == '幂律':
                print(f"  {name}: {r['form']}  ->  c={r['c']:.6g} b={r['b']:.6g} "
                      f"R2={r['r2']:.4f}")
            else:
                print(f"  {name}: R2={r['r2']:.4f}")


# ---------------------------------------------------------------- main
CMDS = {'log': cmd_log, 'report': cmd_report,
        'collect': cmd_collect, 'fit': cmd_fit}

if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in CMDS:
        print(__doc__)
        sys.exit(1)
    CMDS[sys.argv[1]](sys.argv[2:])