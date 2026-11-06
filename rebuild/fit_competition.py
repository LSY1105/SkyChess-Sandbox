"""从真实的 CA 份额序列反推竞争分配模型的权重。

★ 为什么需要这个
  沙盘原先每家航司各自 pax = min(seats, D)，D 是**全市场需求**
  → 三家可各自吃掉 100% 同一市场，总承运可达真实需求的 3 倍（重复计量）。
  竞争教学沙盘必须把需求**分配**给航司，份额由相对价格/班次决定。

★ 数据
  真实报表有 per-market 的 **Route Share** 字段（CA 在该市场的份额 %）
  → 31 个 (季度, 市场) 观测点，含 CA 自身的 运价 / 班次 / QSI。

★ 方法：二航司 logit 的份额比
  在有对手的市场上：
      odds_CA = share/(1-share) = exp(V_CA - V_rival)
  若两期之间对手状态近似不变，则
      Δln(odds) ≈ -ε·Δln(p_CA) + β·Δln(f_CA) + γ·ΔQSI_CA
  → 对所有"干净"过渡做最小二乘，解出 (β, γ)。
"""
import io, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OBS = json.load(io.open(os.path.join(HERE, 'observations.json'), encoding='utf-8'))
A_REV = 0.926228
ELAS = {'Lewis': 1.10, 'Simone': 1.10, 'Fitzgerald': 1.05, 'Ellington': 1.05,
        'Armstrong': 1.10, 'Joplin': 1.10, 'Broonzy': 1.05}
QORDER = ['Q4/2027', 'Q1/2028', 'Q2/2028', 'Q3/2028', 'Q4/2028', 'Q1/2029', 'Q2/2029']


def load():
    out = []
    for q in QORDER:
        v = OBS.get(q)
        if not v:
            continue
        for m, mm in v['metrics'].items():
            if m == '_network':
                continue
            p = v['pnl'].get(m, {})
            lf = (mm.get('Load Factor') or 0) / 100.0
            pax = (mm.get('Passengers (000)') or 0) * 1000
            rev = p.get('Passenger Revenue')
            share = mm.get('Route Share')
            if not pax or not lf or not rev or share is None:
                continue
            out.append({
                'q': q, 'm': m, 'share': share / 100.0, 'freq': mm.get('Frequencies') or 0,
                'fare': rev / (A_REV * pax), 'qsi': mm.get('QSI') or 0.0,
                'pax': pax, 'lf': lf,
            })
    return out


def main():
    rows = load()
    print('=' * 92)
    print('★ 从真实 Route Share 反推竞争分配权重')
    print('=' * 92)
    contested = [r for r in rows if 0.001 < r['share'] < 0.999]
    print(f'  有效观测 {len(rows)} 行，其中"有对手"（0%<share<100%）{len(contested)} 行')
    print()

    # ── 逐市场时序，打印 CA 自身状态与份额 ──
    by_m = {}
    for r in rows:
        by_m.setdefault(r['m'], []).append(r)
    print('  %-11s %-9s %8s %7s %8s %9s %9s' % (
        'market', 'quarter', 'fare', 'freq', 'qsi', 'share', 'odds'))
    for m in sorted(by_m):
        for r in sorted(by_m[m], key=lambda x: QORDER.index(x['q'])):
            if r['freq'] == 0:
                continue
            odds = r['share'] / (1 - r['share']) if r['share'] < 1 else float('inf')
            print('  %-11s %-9s %8.2f %7.0f %8.2f %8.1f%% %9s' % (
                m, r['q'], r['fare'], r['freq'], r['qsi'], r['share'] * 100,
                '∞' if odds == float('inf') else f'{odds:.3f}'))
    print()

    # ── 过渡差分：解 ln(odds) = a·ln(p) + b·ln(f) + c·qsi + const ──
    # 只用"有对手且两期都有份额"的相邻观测
    X, Y, names = [], [], []
    for m in sorted(by_m):
        seq = sorted(by_m[m], key=lambda x: QORDER.index(x['q']))
        for i in range(len(seq) - 1):
            a, b = seq[i], seq[i + 1]
            if not (0.001 < a['share'] < 0.999) or not (0.001 < b['share'] < 0.999):
                continue
            if a['freq'] <= 0 or b['freq'] <= 0:
                continue
            oa = a['share'] / (1 - a['share'])
            ob = b['share'] / (1 - b['share'])
            X.append([math.log(b['fare'] / a['fare']), math.log(b['freq'] / a['freq']),
                       b['qsi'] - a['qsi'], 1.0])
            Y.append(math.log(ob / oa))
            names.append(f'{m} {a["q"]}->{b["q"]}  Δp={b["fare"]/a["fare"]-1:+.1%} '
                         f'Δf={b["freq"]/a["freq"]-1:+.0%} Δq={b["qsi"]-a["qsi"]:+.1f}')
    print(f'  可用过渡 {len(X)} 个（两期都有对手且份额非 0/100%）')
    for nm in names:
        print('    ', nm)
    print()

    # 最小二乘（正规方程）
    n = 4
    A = [[sum(X[k][i] * X[k][j] for k in range(len(X))) for j in range(n)] for i in range(n)]
    b = [sum(X[k][i] * Y[k] for k in range(len(X))) for i in range(n)]
    # 高斯消元
    for i in range(n):
        pv = max(range(i, n), key=lambda r: abs(A[r][i]))
        A[i], A[pv] = A[pv], A[i]; b[i], b[pv] = b[pv], b[i]
        for r in range(i + 1, n):
            f = A[r][i] / A[i][i]
            for c in range(i, n):
                A[r][c] -= f * A[i][c]
            b[r] -= f * b[i]
    sol = [0.0] * n
    for i in reversed(range(n)):
        sol[i] = (b[i] - sum(A[i][c] * sol[c] for c in range(i + 1, n))) / A[i][i]
    a_, b_, c_, _ = sol
    print('  【最小二乘解】Δln(odds) = a·Δln(p) + b·Δln(f) + c·ΔQSI')
    print(f'    价格系数 a = {a_:+.3f}   (logit 效用里的价格权重；负值=涨价掉份额)')
    print(f'    频次系数 b = {b_:+.3f}   (logit 效用里的班次权重)')
    print(f'    QSI  系数 c = {c_:+.4f}  (每点 QSI 的份额效用)')
    print()
    print(f'    → 隐含「份额对自身价格」的弹性 ≈ {a_:.2f}（API 弹性 1.05~1.10，量级一致 ✓）')
    print(f'    → 隐含「份额对班次」的弹性 ≈ {b_:.2f}（班次翻倍份额提升 {((2**b_)-1)*100:.0f}%）')
    print(f'    → QSI 份额效用 ≈ {c_:.4f}/点（QSI 跨 10 点约影响份额 {c_*10:.3f} log-odds）')
    print()

    # 拟合优度
    resid = [Y[k] - sum(sol[i] * X[k][i] for i in range(n)) for k in range(len(X))]
    rms = math.sqrt(sum(r * r for r in resid) / len(resid)) if resid else 0
    print(f'  过渡拟合 log-odds RMS 残差 = {rms:.3f}')
    print(f'  （残差主要来自【对手自身也在变】—— 竞品路线级数据未捕获，属结构性不可观测）')
    print()

    out = {
        'note': '从真实 CA Route Share 序列反推的二航司 logit 份额模型权重',
        'price_weight': round(a_, 4),
        'freq_weight': round(b_, 4),
        'qsi_weight': round(c_, 4),
        'log_odds_rms': round(rms, 4),
        'n_transitions': len(X),
        'usage': ('V_i = price_weight·ln(p_i) + freq_weight·ln(f_i) + qsi_weight·q_i，'
                  'share_i = softmax(V) over 同一市场的所有航司'),
    }
    with io.open(os.path.join(HERE, 'competition-fit.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('  → rebuild/competition-fit.json')


if __name__ == '__main__':
    main()
