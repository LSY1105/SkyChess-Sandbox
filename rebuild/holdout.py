"""M1：样本外（hold-out）检验框架。

★ 为什么必须做
  此前所有标定都是**样本内**的（在同一批点上拟合并检验）。
  数据窗口已关闭，"与真实数据误差"不再是可靠信号，
  → 必须引入**样本外**误差来证明标定不是过拟合。

★ 设计
  7 个季度按时间切成两段：
    训练段 = 前 N 个有 contested 观测的季度
    测试段 = 剩余季度（严格靠后，不与训练段重叠）
  在训练段上标定 (a, b, c) 与各市场的竞争强度 α_m，
  再用训练参数预测测试段的 CA 份额，与真实 Route Share 比较。

  报告：
    ① 样本内 vs 样本外 的 log-odds 误差（看是否显著劣化）
    ② 逐季度、逐市场的份额预测误差
    ③ 多种切分下的稳定性（避免单一划分的偶然性）
"""
import io, json, math, os, itertools

HERE = os.path.dirname(os.path.abspath(__file__))
OBS = json.load(io.open(os.path.join(HERE, 'observations.json'), encoding='utf-8'))

A_REV = 0.926228
QORDER = ['Q4/2027', 'Q1/2028', 'Q2/2028', 'Q3/2028', 'Q4/2028', 'Q1/2029', 'Q2/2029']
# 训练用的权重初值（上一轮全样本最小二乘结果）作为对照
BASE = {'a': -0.562, 'b': 1.160, 'c': 0.086}


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


def fit(rows, iters=400, step=0.02):
    """在给定行上最小二乘拟合 (a, b, c) + 每市场 α_m

    模型：ln(odds_CA) = α_m + a·ln(p_CA) + b·ln(f_CA) + c·QSI_CA
    α_m 用残差均值吸收（等价于"市场级竞争强度"）
    """
    a, b, c = BASE['a'], BASE['b'], BASE['c']

    def loss(a, b, c):
        by_m = {}
        for r in rows:
            y = math.log(r['share'] / (1 - r['share']))
            x = (math.log(max(r['fare'], 1.0)), math.log(max(r['freq'], 30.0)), r['qsi'])
            by_m.setdefault(r['m'], []).append((x, y))
        tot = 0.0
        for m, seq in by_m.items():
            alpha = sum(y - (a * x[0] + b * x[1] + c * x[2]) for x, y in seq) / len(seq)
            for x, y in seq:
                pred = alpha + a * x[0] + b * x[1] + c * x[2]
                tot += (y - pred) ** 2
        return tot / max(len(rows), 1)

    cur = loss(a, b, c)
    for _ in range(iters):
        for name in ('a', 'b', 'c'):
            if name == 'a':
                trial = (a + step, b, c)
            elif name == 'b':
                trial = (a, b + step, c)
            else:
                trial = (a, b, c + step)
            l = loss(*trial)
            if l < cur:
                if name == 'a':
                    a = trial[0]
                elif name == 'b':
                    b = trial[1]
                else:
                    c = trial[2]
                cur = l
    # 收敛后的 α_m
    by_m = {}
    for r in rows:
        y = math.log(r['share'] / (1 - r['share']))
        x = (math.log(max(r['fare'], 1.0)), math.log(max(r['freq'], 30.0)), r['qsi'])
        by_m.setdefault(r['m'], []).append((x, y))
    alpha = {}
    for m, seq in by_m.items():
        alpha[m] = sum(y - (a * x[0] + b * x[1] + c * x[2]) for x, y in seq) / len(seq)
    return (a, b, c), alpha


def predict(r, params, alpha):
    a, b, c = params
    al = alpha.get(r['m'], 0.0)
    z = al + a * math.log(max(r['fare'], 1.0)) + b * math.log(max(r['freq'], 30.0)) + c * r['qsi']
    return 1 / (1 + math.exp(-z))


def main():
    rows = load()
    print('=' * 96)
    print('★ M1 样本外检验框架（首次引入真正的 out-of-sample 误差）')
    print('=' * 96)
    print(f'  contested 观测 {len(rows)} 个')
    qs = sorted({r['q'] for r in rows}, key=QORDER.index)
    print(f'  涉及季度: {", ".join(qs)}')
    print()

    # ── 单一切分：前 4 季度训练，后 3 季度测试 ──
    def split(qs_train, qs_test):
        tr = [r for r in rows if r['q'] in qs_train]
        te = [r for r in rows if r['q'] in qs_test]
        return tr, te

    results = []
    print('  【逐切分的样本内 vs 样本外】')
    print('  %-26s %6s %6s %10s %10s %10s' % (
        '切分', '训练n', '测试n', '训练误差pp', '测试误差pp', '劣化'))
    for k in range(3, len(qs) - 1):
        tr_q, te_q = set(qs[:k]), set(qs[k:])
        tr, te = split(tr_q, te_q)
        if len(tr) < 4 or not te:
            continue
        params, alpha = fit(tr)
        # 训练内误差
        e_in = sum(abs(predict(r, params, alpha) - r['share']) for r in tr) / len(tr)
        # 测试误差（只用训练得到的参数与 α）
        e_out = sum(abs(predict(r, params, alpha) - r['share']) for r in te) / len(te)
        results.append({'train_q': sorted(tr_q, key=QORDER.index), 'test_q': sorted(te_q, key=QORDER.index),
                        'n_train': len(tr), 'n_test': len(te),
                        'params': {'a': params[0], 'b': params[1], 'c': params[2]},
                        'err_in_pct': e_in * 100, 'err_out_pct': e_out * 100})
        print('  %-26s %6d %6d %9.2f%% %9.2f%% %9.2f' % (
            '+'.join(q.split('/')[0] for q in sorted(tr_q, key=QORDER.index)),
            len(tr), len(te), e_in * 100, e_out * 100, (e_out - e_in) * 100))
    print()

    # ── 全样本基准（对照：此前的做法）──
    params_all, alpha_all = fit(rows)
    e_all = sum(abs(predict(r, params_all, alpha_all) - r['share']) for r in rows) / len(rows)
    print(f'  全样本拟合（样本内，对照）: 权重 a={params_all[0]:+.3f} b={params_all[1]:+.3f} '
          f'c={params_all[2]:+.4f}  平均份额误差 {e_all*100:.2f}pp')
    print()

    # ── 最严格切分的逐点明细 ──
    if results:
        worst = max(results, key=lambda x: x['err_out_pct'])
        tr = [r for r in rows if r['q'] in set(worst['train_q'])]
        te = [r for r in rows if r['q'] in set(worst['test_q'])]
        params, alpha = fit(tr)
        print(f'  【最严苛切分的逐点明细】训练={"+".join(q.split("/")[0] for q in worst["train_q"])} '
              f'测试={"+".join(q.split("/")[0] for q in worst["test_q"])}')
        print('  %-9s %-11s %8s %9s %9s %8s' % ('quarter', 'market', '真实份额', '预测份额', '误差pp', '市场α'))
        for r in sorted(te, key=lambda x: (QORDER.index(x['q']), x['m'])):
            p = predict(r, params, alpha)
            print('  %-9s %-11s %7.1f%% %8.1f%% %8.2f %8.3f' % (
                r['q'], r['m'], r['share'] * 100, p * 100, (p - r['share']) * 100, alpha.get(r['m'], 0)))
        print()
        print(f'  该切分：样本内 {worst["err_in_pct"]:.2f}pp  →  样本外 {worst["err_out_pct"]:.2f}pp')
        print()

    # ── 稳健性：多种划分的样本外误差分布 ──
    outs = [r['err_out_pct'] for r in results]
    if outs:
        outs_s = sorted(outs)
        med = outs_s[len(outs_s) // 2]
        print(f'  跨 {len(outs)} 种切分的样本外误差: 中位 {med:.2f}pp  '
              f'范围 [{min(outs):.2f}, {max(outs):.2f}]pp')
        print(f'  （若样本外 ≈ 样本内，说明未过拟合；若显著劣化，说明标定吃样本太深）')

    out = {
        'note': 'M1 样本外检验（留出法）结果',
        'base_weights_in_sample': BASE,
        'full_sample_fit': {'a': params_all[0], 'b': params_all[1], 'c': params_all[2],
                            'err_in_pct': e_all * 100},
        'splits': results,
    }
    with io.open(os.path.join(HERE, 'holdout-result.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('  → rebuild/holdout-result.json')


if __name__ == '__main__':
    main()
