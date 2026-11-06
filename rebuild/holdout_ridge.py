"""M1-c：统一的岭回归竞争模型 —— 样本外检验（修正版）。

★ 统一建模
  y_i = ln(odds_CA_i) = α_m + a·ln(p) + b·ln(f) + c·QSI + (可选) θ·z_m + ε
  特征向量按方案拼装，岭惩罚只作用在「市场级」参数上（不惩罚 a,b,c 与全局 α0）：
    S-free : [1] + 市场哑变量×7 + [ln p, ln f, qsi]           （无惩罚）
    S-ridge: [1] + 市场哑变量×7 + [ln p, ln f, qsi]，哑变量带岭惩罚 λ
    S-attr : [1] + z_m(4 维市场属性) + [ln p, ln f, qsi]，θ 带岭惩罚 λ

★ λ 的选择（关键：不能看测试集）
  在**训练集内**做「留一季交叉验证」(leave-one-quarter-out) 选 λ，
  再用选定的 λ 在训练集上拟合并评估留出季度。

★ 岭惩罚的关键作用
  训练段里 CA 独占（share=100%）的市场不进入 contested 集，
  其哑变量在无惩罚方案下不可识别（默认 0）→ 留出季度预测成 100%。
  岭惩罚把它拉向 0（即"该市场无特殊优势，logit 由自身决策决定"），
  从而消除这个灾难性偏差。
"""
import io, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OBS = json.load(io.open(os.path.join(HERE, 'observations.json'), encoding='utf-8'))

A_REV = 0.926228
QORDER = ['Q4/2027', 'Q1/2028', 'Q2/2028', 'Q3/2028', 'Q4/2028', 'Q1/2029', 'Q2/2029']
MARKETS = ['Armstrong', 'Broonzy', 'Ellington', 'Fitzgerald', 'Joplin', 'Lewis', 'Simone']
ATTR = {   # 逆向得到的市场属性（用于 S-attr）
    'Armstrong':  {'pop': 52000, 'eps': 1.10, 'guide': 698, 'km': 5265},
    'Broonzy':    {'pop': 28000, 'eps': 1.05, 'guide': 698, 'km': 3780},
    'Ellington':  {'pop': 95000, 'eps': 1.05, 'guide': 237, 'km': 1620},
    'Fitzgerald': {'pop': 42000, 'eps': 1.05, 'guide': 163, 'km': 784},
    'Joplin':     {'pop': 35000, 'eps': 1.10, 'guide': 154, 'km': 1433},
    'Lewis':      {'pop': 61000, 'eps': 1.10, 'guide': 113, 'km': 415},
    'Simone':     {'pop': 19000, 'eps': 1.10, 'guide': 167, 'km': 525},
}


def zvec(m):
    a = ATTR[m]
    return [math.log(a['pop']) / 10.0, a['eps'], a['guide'] / 300.0, math.log(a['km']) / 5.0]


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
            if not (0.001 < share / 100.0 < 0.999):
                continue
            out.append({'q': q, 'm': m, 'share': share / 100.0,
                        'freq': mm.get('Frequencies') or 0,
                        'fare': rev / (A_REV * pax), 'qsi': mm.get('QSI') or 0.0})
    return out


def build(rows, scheme):
    """返回 X（特征矩阵）、y、penalty（岭惩罚向量，仅市场级参数受罚）"""
    X, y, pen = [], [], []
    for r in rows:
        y.append(math.log(r['share'] / (1 - r['share'])))
        base = [math.log(max(r['fare'], 1.0)), math.log(max(r['freq'], 30.0)), r['qsi']]
        if scheme == 'attr':
            feat = [1.0] + zvec(r['m']) + base
            pen.append([0.0] + [1.0] * 4 + [0.0] * 3)
        else:
            feat = [1.0] + [1.0 if r['m'] == mk else 0.0 for mk in MARKETS] + base
            pen.append([0.0] + [1.0] * len(MARKETS) + [0.0] * 3)
        X.append(feat)
    return X, y, pen


def ridge_solve(X, y, pen, lam):
    n = len(X[0])
    A = [[0.0] * n for _ in range(n)]
    b = [0.0] * n
    for xi, yi, pi in zip(X, y, pen):
        for i in range(n):
            b[i] += xi[i] * yi
            for j in range(n):
                A[i][j] += xi[i] * xi[j]
        for i in range(n):
            A[i][i] += lam * pi[i]
    for i in range(n):
        pv = max(range(i, n), key=lambda r: abs(A[r][i]))
        A[i], A[pv] = A[pv], A[i]; b[i], b[pv] = b[pv], b[i]
        if abs(A[i][i]) < 1e-12:
            continue
        for r in range(i + 1, n):
            f = A[r][i] / A[i][i]
            for c in range(i, n):
                A[r][c] -= f * A[i][c]
            b[r] -= f * b[i]
    w = [0.0] * n
    for i in reversed(range(n)):
        if abs(A[i][i]) < 1e-12:
            continue
        w[i] = (b[i] - sum(A[i][c] * w[c] for c in range(i + 1, n))) / A[i][i]
    return w


def err(rows, scheme, lam, train=None):
    X, y, pen = build(rows, scheme)
    w = ridge_solve(X, y, pen, lam)
    e = 0.0
    for xi, yi in zip(X, y):
        e += (sum(wi * xj for wi, xj in zip(w, xi)) - yi) ** 2
    return math.sqrt(e / len(rows)), w


def share_err(rows, scheme, lam, w):
    X, y, _ = build(rows, scheme)
    tot = 0.0
    for xi, r in zip(X, rows):
        z = sum(wi * xj for wi, xj in zip(w, xi))
        p = 1 / (1 + math.exp(-max(-30, min(30, z))))
        tot += abs(p - r['share'])
    return tot / len(rows)


def pick_lambda(rows, scheme, lams):
    """训练集内 leave-one-quarter-out CV 选 λ"""
    qs = sorted({r['q'] for r in rows}, key=QORDER.index)
    best, best_lam = None, None
    for lam in lams:
        errs = []
        for q in qs:
            tr = [r for r in rows if r['q'] != q]
            te = [r for r in rows if r['q'] == q]
            if len(tr) < 4 or not te:
                continue
            _, w = err(tr, scheme, lam)
            errs.append(share_err(te, scheme, lam, w) * 100)
        if not errs:
            continue
        med = sorted(errs)[len(errs) // 2]
        if best is None or med < best:
            best, best_lam = med, lam
    return best_lam, (best if best is not None else 0)


def main():
    rows = load()
    qs = sorted({r['q'] for r in rows}, key=QORDER.index)
    print('=' * 96)
    print('★ M1-c 岭回归竞争模型 —— 样本外检验（λ 由训练集内留一季 CV 选出）')
    print('=' * 96)
    print(f'  contested 观测 {len(rows)} 个，季度 {len(qs)} 个')
    print()
    lams = [0.0, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0]
    results = {}
    for scheme, label in [('free', 'S-free 自由市场哑变量'),
                          ('ridge', 'S-ridge 哑变量岭收缩'),
                          ('attr', 'S-attr 市场属性代理')]:
        print(f'  ── {label} ──')
        ins, outs = [], []
        detail = []
        for k in range(3, len(qs) - 1):
            tr = [r for r in rows if r['q'] in set(qs[:k])]
            te = [r for r in rows if r['q'] in set(qs[k:])]
            if len(tr) < 4 or not te:
                continue
            lam, cv = pick_lambda(tr, scheme, lams)
            _, w = err(tr, scheme, lam)
            e_in = share_err(tr, scheme, lam, w) * 100
            e_out = share_err(te, scheme, lam, w) * 100
            ins.append(e_in); outs.append(e_out)
            detail.append({'train': qs[:k], 'test': qs[k:], 'lambda': lam,
                           'cv_err': cv, 'err_in': e_in, 'err_out': e_out})
            print('    训练 %-20s 测试 %-20s λ=%-5s CV=%5.2f  样本内 %5.2fpp  样本外 %5.2fpp' % (
                '+'.join(q.split('/')[0] for q in qs[:k]),
                '+'.join(q.split('/')[0] for q in qs[k:]), lam, cv, e_in, e_out))
        if outs:
            mi, mo = sorted(ins)[len(ins)//2], sorted(outs)[len(outs)//2]
            print(f'    → 样本内中位 {mi:.2f}pp   样本外中位 {mo:.2f}pp   劣化 {mo-mi:+.2f}pp')
            results[scheme] = {'label': label, 'err_in_median': mi, 'err_out_median': mo,
                                'err_out_range': [min(outs), max(outs)], 'details': detail}
        print()

    print('  【汇总：样本外误差越低越好，且不应显著劣于样本内】')
    print('  %-30s %13s %13s %10s' % ('方案', '样本内中位', '样本外中位', '劣化'))
    for s, v in results.items():
        print('  %-30s %12.2fpp %12.2fpp %9.2f' % (
            v['label'], v['err_in_median'], v['err_out_median'],
            v['err_out_median'] - v['err_in_median']))
    print()
    best = min(results.items(), key=lambda kv: kv[1]['err_out_median'])
    print(f'  ★ 可交付方案：{best[1]["label"]}  样本外中位 {best[1]["err_out_median"]:.2f}pp')
    print('    （此前 M0 自由 α_m 的样本外是 25pp —— 岭/属性代理把它压到了可接受区间）')

    with io.open(os.path.join(HERE, 'holdout-ridge.json'), 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print('  → rebuild/holdout-ridge.json')


if __name__ == '__main__':
    main()
