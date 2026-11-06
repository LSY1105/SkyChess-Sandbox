"""算法轮子 — 用 38 个航线级观测点反推服务端成本公式。

思路：为每个观测点构造物理特征（起降次数、飞行小时、旅客、货物、距离、油价），
      对每个成本科目做无约束线性回归，检验是否能用已知物理量解释。
"""
import json, math, os

D = json.load(open('observations.json', encoding='utf-8'))

# ── 物理常数 ──
HUB_KM = {'LEW': 415, 'SIM': 525, 'FTZ': 784, 'ETN': 1150,
          'PKR': 1620, 'ARM': 3780, 'GEE': 5265, 'JOP': None, 'BZY': None,
          'CHA': None}
BHK = {'LEW': 1.00, 'SIM': 1.13, 'FTZ': 1.44, 'ETN': 1.88,
       'PKR': 2.44, 'ARM': 5.04, 'GEE': 6.82}
# 各回合的燃油价（turn.economics.fuel_price）
FUEL = {'Q4/2027': 2.40, 'Q1/2028': 2.50, 'Q2/2028': 2.60,
        'Q3/2028': 4.50, 'Q4/2028': 3.75, 'Q1/2029': 2.75, 'Q2/2029': 2.70}
CARBON = {'Q4/2027': 22.0, 'Q1/2028': 22.0, 'Q2/2028': 22.0,
          'Q3/2028': 52.0, 'Q4/2028': 52.0, 'Q1/2029': 52.0, 'Q2/2029': 52.0}

NAME2CODE = {'Lewis': 'LEW', 'Simone': 'SIM', 'Fitzgerald': 'FTZ',
             'Ellington': 'ETN', 'Parker': 'PKR', 'Armstrong': 'ARM',
             'McGee': 'GEE', 'Joplin': 'JOP', 'Broonzy': 'BZY',
             'Charles City': 'CHA'}


def build():
    """构造特征矩阵"""
    out = []
    for q, v in D.items():
        for m, mm in v['metrics'].items():
            if m == '_network':
                continue
            p = v['pnl'].get(m, {})
            if not p or mm.get('ASK (MM)') is None:
                continue
            freq = mm['Frequencies'] or 0
            adu = mm['ADU (BH)'] or 0
            pax_k = mm['Passengers (000)'] or 0
            cargo_t = mm['Cargo (tonnes)'] or 0
            lf = (mm['Load Factor'] or 0) / 100.0
            bh = freq * adu                    # 总飞行小时
            code = NAME2CODE.get(m, '?')
            km = HUB_KM.get(code)
            bk = BHK.get(code)
            fh = json.load(open('fare-history.json', encoding='utf-8')) if os.path.exists('fare-history.json') else {}
            _f = {}
            for _q, _d in fh.items():
                for _k, _v in _d.items():
                    _f[(_q, _k.split(':')[1])] = float(_v)
            fare = _f.get((q, code))
            out.append({
                'fare': fare,
                'fare_x_pax': (fare or 0) * pax_k * 1000,
                'bh_x_price': bh * (FUEL.get(q) or 0),
                'q': q, 'm': m, 'code': code,
                'freq': freq, 'adu': adu, 'bh': bh,
                'pax': pax_k * 1000, 'cargo': cargo_t,
                'lf': lf, 'km': km, 'bk': bk,
                'fuel_price': FUEL.get(q), 'carbon': CARBON.get(q),
                'pnl': p,
            })
    return out


def ols(X, y):
    n, k = len(y), len(X[0])
    A = [[sum(X[i][a] * X[i][b] for i in range(n)) for b in range(k)]
         + [sum(X[i][a] * y[i] for i in range(n))] for a in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(A[r][c]))
        A[c], A[p] = A[p], A[c]
        if abs(A[c][c]) < 1e-12:
            return None
        for r in range(k):
            if r == c:
                continue
            f = A[r][c] / A[c][c]
            for cc in range(c, k + 1):
                A[r][cc] -= f * A[c][cc]
    beta = [A[i][k] / A[i][i] for i in range(k)]
    yb = sum(y) / n
    pred = [sum(X[i][j] * beta[j] for j in range(k)) for i in range(n)]
    ssr = sum((y[i] - pred[i]) ** 2 for i in range(n))
    sst = sum((v - yb) ** 2 for v in y)
    return beta, (1 - ssr / sst if sst else 1.0), max(
        abs(y[i] - pred[i]) / abs(y[i]) if y[i] else 0 for i in range(n))


ROWS = build()
print('=' * 76)
print(f'建模观测集: {len(ROWS)} 个 (季度 × 市场) 组合')
print('=' * 76)

# ── 逐科目回归 ──
MODELS = [
    ('Fuel',                 [('bh_x_price', 1)],            'BH × 油价'),
    ('Sustainable Aviation Fuel', [('bh_x_price', 1)],       'SAF ~ BH × 油价'),
    ('Carbon',               [('pax', 1), ('cargo', 1)],    'RPK 基准(旅客+货物)'),
    ('Maintenance',          [('freq', 1), ('bh', 1)],      '周期(BH)混合'),
    ('Flight Crew',          [('freq', 1), ('bh', 1)],      '薪资+津贴'),
    ('Cabin Crew',           [('freq', 1), ('pax', 1)],    '按人头'),
    ('Landing',              [('freq', 1)],                 '起降次数'),
    ('Navigation',           [('freq', 1), ('km', 1)],      '起降 × 航距'),
    ('Aircraft Handling',    [('freq', 1)],                 '起降次数'),
    ('Traffic Handling',     [('pax', 1)],                  '旅客数'),
    ('Cargo Handling',       [('cargo', 1)],                '货物吨数'),
    ('Passenger Services',   [('pax', 1)],                  '旅客数'),
    ('Ticketing, Sales and Promotion', [('pax',1)],          '旅客数'),
    ('General & Administration', [('freq',1),('pax',1)],     '规模代理'),
    ('Cargo Overheads',      [('cargo', 1)],                '货物吨数'),
    ('Passenger Revenue',    [('fare_x_pax', 1)],           '运价 × 旅客'),
    ('Cargo Revenue',        [('cargo', 1)],                '货物 × 收益率'),
    ('Ancillary Revenue',    [('pax', 1)],                  '旅客数'),
]

print()
print('=' * 76)
print('线性回归结果 (y = a + Σ b_i · x_i)')
print('=' * 76)
for target, feats, desc in MODELS:
    pts = [r for r in ROWS if r['pnl'].get(target) is not None and r['freq'] > 0
           and (r.get('fare') is not None or 'fare' not in [f for f,_ in feats])]
    if len(pts) < 5:
        continue
    if any(r.get(f) is None for r in pts for f, _ in feats):
        continue
    X = [[1.0] + [float(r[f]) for f, _ in feats] for r in pts]
    y = [r['pnl'][target] for r in pts]
    res = ols(X, y)
    if not res:
        continue
    beta, r2, mpe = res
    names = ['const'] + [f for f, _ in feats]
    eq = ' + '.join(f'{b:,.4g}·{n}' for b, n in zip(beta, names))
    print(f'\n  {target:22} n={len(y):2}  R²={r2:6.4f}  最大误差={mpe*100:5.1f}%   [{desc}]')
    print(f'      y = {eq}')