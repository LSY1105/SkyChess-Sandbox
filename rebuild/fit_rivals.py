"""路线一：反解竞品的效用轨迹（用现有真实数据，不依赖任何新抓取）。

★ 前提
  真实报表有 per-market 的 Route Share（CA 在该市场的份额）。
  对"有对手"的市场（0%<share<100%），二航司 logit 给出：
      odds_CA = share/(1-share) = exp(V_CA - V_rival)
  ⇒ **V_rival = V_CA - ln(odds_CA)** —— 对手效用被**逐点反解**出来。

  权重 (a,b,c) 由 rebuild/fit_competition.py 从同一批数据最小二乘得到
  （价格 −0.562 / 班次 +1.160 / QSI +0.086）。

★ 为什么这条路线可行
  竞品的**路线级历史数据没抓到**（只拿到 airline 元数据），
  但"份额"是抓到���。份额是竞品行为的**因变量**，足以反解其效用的**时间序列**。
  有了效用轨迹，就能：
    ① 标定竞品 AI 的策略参数，使其生成的效用逼近这条真实轨迹
    ② 分解出市场级品牌/枢纽强度 δ_{rival,market}（跨季度相对稳定）
    ③ 用留出季度做样本外验证

★ 输出
  competition-rivals.json  —— 每个 (市场, 季度) 的反解效用、隐含班次价格、稳定性诊断
"""
import io, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OBS = json.load(io.open(os.path.join(HERE, 'observations.json'), encoding='utf-8'))
CF = json.load(io.open(os.path.join(HERE, 'competition-fit.json'), encoding='utf-8'))

A_REV = 0.926228
ELAS = {'Lewis': 1.10, 'Simone': 1.10, 'Fitzgerald': 1.05, 'Ellington': 1.05,
        'Armstrong': 1.10, 'Joplin': 1.10, 'Broonzy': 1.05}
QORDER = ['Q4/2027', 'Q1/2028', 'Q2/2028', 'Q3/2028', 'Q4/2028', 'Q1/2029', 'Q2/2029']
C = CF


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
            out.append({'q': q, 'm': m, 'share': share / 100.0,
                        'freq': mm.get('Frequencies') or 0,
                        'fare': rev / (A_REV * pax), 'qsi': mm.get('QSI') or 0.0,
                        'pax': pax, 'lf': lf})
    return out


def v_of(fare, freq, qsi, brand=0.0):
    return (C['price_weight'] * math.log(max(fare, 1.0))
            + C['freq_weight'] * math.log(max(freq, C.get('freq_floor', 30)))
            + C['qsi_weight'] * qsi + brand)


def main():
    rows = load()
    contested = [r for r in rows if 0.001 < r['share'] < 0.999]
    print('=' * 96)
    print('★ 路线一：反解竞品效用轨迹（零新增抓取）')
    print('=' * 96)
    print(f'  权重: 价格 {C["price_weight"]:+.3f}  班次 {C["freq_weight"]:+.3f}  QSI {C["qsi_weight"]:+.4f}')
    print(f'  观测: {len(rows)} 行，其中 contested {len(contested)} 行')
    print()

    # ── 逐点反解对手效用 ──
    out = []
    for r in contested:
        v_ca = v_of(r['fare'], r['freq'], r['qsi'])
        odds = r['share'] / (1 - r['share'])
        v_rival = v_ca - math.log(odds)
        out.append({**r, 'v_ca': v_ca, 'odds': odds, 'v_rival': v_rival,
                    'ln_odds': math.log(odds)})
    out.sort(key=lambda x: (x['m'], QORDER.index(x['q'])))

    print('  %-11s %-9s %8s %7s %7s %8s %9s %9s %9s' % (
        'market', 'quarter', 'fare', 'freq', 'share', 'ln(odds)', 'V_CA', 'V_竞品', '差值'))
    for x in out:
        print('  %-11s %-9s %8.2f %7.0f %6.1f%% %9.3f %9.3f %9.3f %9.3f' % (
            x['m'], x['q'], x['fare'], x['freq'], x['share'] * 100, x['ln_odds'],
            x['v_ca'], x['v_rival'], x['v_ca'] - x['v_rival']))
    print()

    # ── 分解：市场级品牌强度 δ_{market} + 残差 ──
    # 假设对手效用 = a·ln(p_r) + b·ln(f_r) + c·qsi_r + δ_market
    # 其中 p_r/f_r 未知 → 先把每期的"对手有效竞争力"记为
    #   E_r = V_rival − (该市场当期 CA 的价格/班次基准项)
    # 即把对手与 CA 的相对定价/相对频次优势先归零，剩余部分即市场结构性差异。
    print('  【市场级结构分解】竞品相对 CA 的效用差 ΔV = V_CA − V_竞品')
    print('  （正值 = CA 相对占优；负值 = CA 处于守势）')
    by_m = {}
    for x in out:
        by_m.setdefault(x['m'], []).append(x)
    print()
    print('  %-11s %5s %10s %10s %10s %12s' % ('market', 'n', 'ΔV 均值', 'ΔV 标准差', 'CA占优期数', '判读'))
    summary = {}
    for m in sorted(by_m):
        seq = by_m[m]
        dv = [x['v_ca'] - x['v_rival'] for x in seq]
        mu = sum(dv) / len(dv)
        sd = (sum((d - mu) ** 2 for d in dv) / len(dv)) ** 0.5
        win = sum(1 for d in dv if d > 0)
        if win == len(dv):
            judge = 'CA 全程占优'
        elif win == 0:
            judge = 'CA 全程守势'
        else:
            judge = '此消彼长'
        summary[m] = {'n': len(seq), 'dv_mean': mu, 'dv_sd': sd, 'ca_wins': win,
                      'quarters': [x['q'] for x in seq]}
        print('  %-11s %5d %10.3f %10.3f %10d %12s' % (m, len(seq), mu, sd, win, judge))
    print()

    # ── 稳定性诊断：ΔV 的跨季度波动是否可由 CA 自身决策解释 ──
    print('  【可解释性检验】ΔV 的变化 vs CA 自身决策变化')
    print('  %-11s %-9s %10s %10s %10s' % ('market', '区间', 'ΔV 变化', 'Δln(p_CA)', 'Δln(f_CA)'))
    resid = []
    for m in sorted(by_m):
        seq = by_m[m]
        for i in range(len(seq) - 1):
            a, b = seq[i], seq[i + 1]
            dv = (b['v_ca'] - b['v_rival']) - (a['v_ca'] - a['v_rival'])
            dp = math.log(max(b['fare'], 1) / max(a['fare'], 1))
            df = math.log(max(b['freq'], 1) / max(a['freq'], 1))
            # CA 自身决策能解释的部分：a·Δln(p) + b·Δln(f) + c·Δqsi
            explained = C['price_weight'] * dp + C['freq_weight'] * df + C['qsi_weight'] * (b['qsi'] - a['qsi'])
            resid.append(dv - explained)
            print('  %-11s %-9s %10.3f %10.3f %10.3f   (CA 决策可解释 %+.3f，残差 %+.3f)' % (
                m, f"{a['q']}→{b['q']}", dv, dp, df, explained, dv - explained))
    if resid:
        rms = math.sqrt(sum(r * r for r in resid) / len(resid))
        print()
        print(f'  → CA 自身决策可解释的残差 RMS = {rms:.3f} log-odds')
        print(f'    （残差即"对手自身在做什么"——这是我们无法直接观测、但可由 AI 策略补齐的部分）')

    outp = {
        'weights': {k: C[k] for k in ('price_weight', 'freq_weight', 'qsi_weight')},
        'implied_rival_utility': [
            {'market': x['m'], 'quarter': x['q'], 'share_ca': x['share'],
             'fare_ca': x['fare'], 'freq_ca': x['freq'], 'qsi_ca': x['qsi'],
             'v_ca': x['v_ca'], 'v_rival': x['v_rival'], 'ln_odds': x['ln_odds']}
            for x in out],
        'market_structure': summary,
        'residual_rms': (math.sqrt(sum(r * r for r in resid) / len(resid)) if resid else None),
    }
    with io.open(os.path.join(HERE, 'competition-rivals.json'), 'w', encoding='utf-8') as f:
        json.dump(outp, f, ensure_ascii=False, indent=2)
    print()
    print('  → rebuild/competition-rivals.json')


if __name__ == '__main__':
    main()
