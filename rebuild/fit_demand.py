"""需求模型反推 —— 截尾回归（censored regression）。

观测结构:
    pax_observed = min(ASK_supply, D(market, fare, QSI))
    LF = pax_observed / ASK_supply

因此:
    LF < 100%  →  D >= pax_observed      (下界约束)
    LF = 100%  →  D  = pax_observed      (等式约束)

模型形式（物理动机）:
    D = K_market × (QSI / QSI_ref)^k × (fare_ref / fare)^|ε|

    k  = 质量弹性 (需求对服务的敏感度)
    |ε| = 价格弹性 (需求对票价的敏感度)
    K_market = 市场基量

求解: 对 (k, |ε|) 做网格搜索，每个市场独立解 K_market，
      要求所有等式/不等式约束同时满足且裕度最大。
"""
import json, math

D = json.load(open('observations.json', encoding='utf-8'))
fare = json.load(open('fares_by_turn.json', encoding='utf-8'))

TURN = {'Q4/2027': 0, 'Q1/2028': 1, 'Q2/2028': 2, 'Q3/2028': 3,
        'Q4/2028': 4, 'Q1/2029': 5, 'Q2/2029': 6}
CODE = {'Lewis': 'LEW', 'Simone': 'SIM', 'Fitzgerald': 'FTZ', 'Ellington': 'ETN',
        'Armstrong': 'ARM', 'Joplin': 'JOP', 'Broonzy': 'BZY'}
# 反推出的航段长度 (km)，含由 pax=RPK/km 反解的 Joplin
SECTOR = {'LEW': 415, 'SIM': 525, 'FTZ': 784, 'ETN': 1150,
          'ARM': 3780, 'JOP': 1433, 'BZY': None}
QSI_REF = 10.0
FARE_REF = 200.0


def collect():
    obs = []
    for q, v in D.items():
        tn = TURN.get(q)
        for m, mm in v['metrics'].items():
            if m == '_network':
                continue
            lf = (mm.get('Load Factor') or 0) / 100.0
            if not lf or not mm.get('Frequencies'):
                continue
            pax = (mm.get('Passengers (000)') or 0) * 1000
            if not pax:
                continue
            pnl = v['pnl'].get(m, {})
            rev = pnl.get('Passenger Revenue')
            # 用 F-01 反解当季实际执行运价（回合内改价会导致快照值失真）
            f = None
            if rev:
                f = (rev + 63026) / (0.9339 * pax)
            if not f or f <= 0:
                continue
            obs.append({
                'q': q, 'm': m, 'code': CODE.get(m), 'lf': lf, 'pax': pax,
                'fare': f, 'qsi': mm.get('QSI') or 0.0,
                'ask': mm.get('ASK (MM)') or 0.0,
                'freight': mm.get('Cargo (tonnes)') or 0.0,
                'freq': mm.get('Frequencies') or 0.0,
            })
    return obs


OBS = collect()


def solve_market(rows, k, eps):
    """给定 (k, eps)，求该市场的 K，使所有约束满足。

    等式约束（LF=100%）:  D = pax  →  K 固定
    不等式约束（LF<100%）: D >= pax → K >= 需求值

    返回 (K, 满足性, 最小裕度)
    """
    # 由等式约束定 K
    K_eq = None
    for r in rows:
        if r['lf'] >= 0.999:
            f = ((max(r['qsi'], 1e-6) / QSI_REF) ** k) * ((FARE_REF / r['fare']) ** eps)
            if not isinstance(f, float) or f <= 0 or f != f:
                return None, '复数域', 0.0
            Ki = r['pax'] / f
            if K_eq is None:
                K_eq = Ki
            elif abs(Ki - K_eq) / K_eq > 0.02:
                return None, '等式冲突', 0.0
    # 不等式给出 K 下界
    K_lo = 0.0
    for r in rows:
        if r['lf'] < 0.999:
            f = ((max(r['qsi'], 1e-6) / QSI_REF) ** k) * ((FARE_REF / r['fare']) ** eps)
            if not isinstance(f, float) or f <= 0 or f != f:
                return None, '复数域', 0.0
            K_lo = max(K_lo, r['pax'] / f)
    if K_eq is not None:
        if K_eq + 1e-9 < K_lo:
            return None, '等式<下界', 0.0
        K = K_eq
    else:
        K = K_lo
    # 裕度：所有不等式在 K 下的相对剩余
    margin = 1e9
    for r in rows:
        if r['lf'] < 0.999:
            f = ((max(r['qsi'], 1e-6) / QSI_REF) ** k) * ((FARE_REF / r['fare']) ** eps)
            if not isinstance(f, float) or f <= 0 or f != f:
                return None, '复数域', 0.0
            D = K * f
            margin = min(margin, (D - r['pax']) / r['pax'])
    return K, 'OK', margin


def grid():
    print('=' * 78)
    print('★ 截尾回归网格搜索  (k = 质量弹性, |ε| = 价格弹性)')
    print('=' * 78)
    by_market = {}
    for r in OBS:
        by_market.setdefault(r['m'], []).append(r)

    best = None
    for ki in range(0, 41):
        k = ki * 0.05                       # 0 .. 2.0
        for ei in range(0, 41):
            eps = ei * 0.05                  # 0 .. 2.0
            if eps == 0:
                continue
            ok_all = True
            margins = []
            for m, rows in by_market.items():
                K, st, mg = solve_market(rows, k, eps)
                if K is None:
                    ok_all = False
                    break
                margins.append(mg)
            if ok_all:
                mm_ = min(margins)
                if best is None or mm_ > best[0]:
                    best = (mm_, k, eps, len(by_market))
    if best is None:
        print('  无可行解 —— 需放宽形式')
        return
    mg, k, eps, nm = best
    print(f'\n  最优: k={k:.2f}  |ε|={eps:.2f}   覆盖市场 {nm}   最小裕度 {mg*100:.1f}%')
    print()
    for m, rows in sorted(by_market.items()):
        K, st, mg2 = solve_market(rows, k, eps)
        print(f'  {m:12} K={K:>12,.0f}   {st}   裕度 {mg2*100:6.1f}%')
        for r in rows:
            f = ((max(r['qsi'], 1e-6) / QSI_REF) ** k) * ((FARE_REF / r['fare']) ** eps)
            D = K * f
            print(f'      {r["q"]:9} LF{r["lf"]*100:5.1f}%  实测{r["pax"]:>8,.0f}  '
                  f'模型D={D:>9,.0f}  {"(等式)" if r["lf"]>=0.999 else ""}')
    return k, eps, best


if __name__ == '__main__':
    grid()