"""从 7 个季度的报表中提取航线级观测点，建立回归数据集。

每条观测 = (季度, 市场) 的一组指标 + 该航线的损益/成本明细。
"""
import re, json, os, glob, sys

REPORTS = [
    ('Q4/2027', 'q0-2027-report.yaml'),
    ('Q1/2028', 'q1-2028-report.yaml'),
    ('Q2/2028', 'q2-2028-report.yaml'),
    ('Q3/2028', 'q3-2028-report.yaml'),
    ('Q4/2028', 'q4-2028-report.yaml'),
    ('Q1/2029', 'q5-2029-report.yaml'),
    ('Q2/2029', 'q6-report.yaml'),
]

METRICS = ['Frequencies', 'ASK (MM)', 'RPK (MM)', 'Load Factor',
           'Passengers (000)', 'Cargo (tonnes)', 'Route Share', 'QSI', 'ADU (BH)']


def num(s):
    s = s.strip().replace(',', '').replace('%', '').replace('$', '')
    try:
        return float(s)
    except ValueError:
        return None


def split_qytd(row):
    """'Capital Airways 360 / 360 19.3 / 19.3 ...' -> 9 个 Q 列指标

    '/' 是独立 token；去掉后取 [0::2] 即 Q 列。
    """
    toks = [x for x in row.split() if x != '/']
    # 去掉前导的公司名（最多两个词）
    if toks and toks[0] == 'Capital':
        toks = toks[2:]
    vals = [num(x) for x in toks[0::2]]
    return vals


def parse_report(path):
    txt = open(path, encoding='utf-8').read()
    # 定位报告期
    m = re.search(r'heading "End of (Q\d/\d{4}) Report"', txt)
    period = m.group(1) if m else '?'

    # Network Metrics 段
    obs = {}
    i = txt.find('heading "Network Metrics" [level=3]')
    if i >= 0:
        j = txt.find('heading "Route Metrics" [level=3]', i)
        seg = txt[i:j if j > 0 else i + 3000]
        for r in re.finditer(r'- row "Capital Airways ([^"]*)":', seg):
            vals = split_qytd(r.group(1))
            if len(vals) >= 9:
                obs.setdefault('_network', dict(zip(METRICS, vals[:9])))

    # Route Metrics 段（每个市场一个表）
    i = txt.find('heading "Route Metrics" [level=3]')
    if i >= 0:
        j = txt.find('heading "Operating Costs" [level=3]', i)
        seg = txt[i:j if j > 0 else len(txt)]
        # 市场名出现在 "- text: <Name> Q / YTD"
        blocks = list(re.finditer(r'- text: ([A-Z][\w ]+?) Q / YTD', seg))
        for k, bm in enumerate(blocks):
            name = bm.group(1)
            end = blocks[k + 1].start() if k + 1 < len(blocks) else len(seg)
            blk = seg[bm.end():end]
            rows = re.findall(r'- row "Capital Airways ([^"]*)":', blk)
            if not rows:
                continue
            vals = split_qytd(rows[0])
            if len(vals) >= 9:
                obs[name] = dict(zip(METRICS, vals[:9]))

    # 各航线损益
    pnl = {}
    for m2 in re.finditer(r'heading "([A-Z][\w ]+)" \[level=3\]\s*\n\s*- text: Operating Costs Statement', txt):
        name = m2.group(1)
        nxt = txt.find('heading "', m2.end())
        seg = txt[m2.end():nxt if nxt > 0 else len(txt)]
        d = {}
        for r in re.finditer(r'row "([^"]{3,60}?): \$([\-\d,]+)', seg):
            d[r.group(1)] = num(r.group(2))
        if d:
            pnl[name] = d

    # 总量损益
    i = txt.find('heading "Operating Costs" [level=3]')
    if i >= 0:
        j = txt.find('heading "Cash Flow"', i)
        seg = re.sub(r'\s+', ' ', txt[i:j if j > 0 else i + 6000])
        tot = {}
        for r in re.finditer(r'row "([^"]{3,60}?): \$([\-\d,]+)', seg):
            tot[r.group(1)] = num(r.group(2))
        if tot:
            pnl['_total'] = tot

    return period, obs, pnl


if __name__ == '__main__':
    out = {}
    for period, path in REPORTS:
        if not os.path.exists(path):
            print('跳过', path); continue
        p, obs, pnl = parse_report(path)
        if p != period:
            print(f'!! 期间不符: {path} 实际={p} 期望={period} —— 跳过')
            continue
        out[period] = {'metrics': obs, 'pnl': pnl}
        print(f'{p:9} 指标 {len(obs):2} 条  损益 {len(pnl):2} 条')

    json.dump(out, open('observations.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('\n已保存 observations.json')

    # 统计可用观测点
    n = 0
    for p, v in out.items():
        for m, d in v['metrics'].items():
            if m != '_network' and d.get('ASK (MM)') is not None:
                n += 1
    print(f'可用 (季度 × 市场) 观测点: {n}')