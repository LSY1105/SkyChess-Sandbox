"""M2：竞争结构标定 —— 用真实数据反推各市场的**目标均衡份额**与品牌优势。

★ 标定目标的重新定义（关键）
  M1 证明：CA 的季度份额**无法**从 CA 自身属性预测（样本外 15~30pp），
          因为份额波动主要由**观测不到的对手行为**（开航/退出/价格战）驱动。
  ⇒ 放弃"预测每季份额"，改为标定**市场级竞争结构**：
      每个市场的**长期均衡份额**是可以从真实数据直接读出的：
          target_share(market) = CA 在该市场 contested 季度的份额均值
      沙盘应复现这个"均衡位"，而不是逐期轨迹。

★ 从 target_share 反推市场级品牌优势 δ
  二航司 logit：ln(odds_CA) = a·ln(p_CA) + b·ln(f_CA) + c·QSI_CA + δ_market
  δ_market 即"该市场的竞争结构偏置"：
      δ > 0 → CA 在该市场有结构性优势（如 Joplin，CA 的主战场）
      δ < 0 → CA 在该市场结构性弱势（Fitzgerald / Ellington）
  反解：δ = ln(odds(target_share)) − [a·ln(p̄) + b·ln(f̄) + c·qsī]
  其中 p̄/f̄/qsī 取该市场 contested 季度的均值（CA 自身的常态状态）。

★ 产出
  1) 每个市场的目标均衡份额（直接来自真实数据）
  2) 每个市场的 δ_market（可解释：红海 / 强势区 / 弱势区）
  3) 全市场的均衡份额分布（沙盘应能复现这些"形态"）
"""
import io, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OBS = json.load(io.open(os.path.join(HERE, 'observations.json'), encoding='utf-8'))
CF = json.load(io.open(os.path.join(HERE, 'competition-fit.json'), encoding='utf-8'))

A_REV = 0.926228
QORDER = ['Q4/2027', 'Q1/2028', 'Q2/2028', 'Q3/2028', 'Q4/2028', 'Q1/2029', 'Q2/2029']
A, B, C = CF['price_weight'], CF['freq_weight'], CF['qsi_weight']


def load_all():
    """全部观测（含 share=100 与 share=0，用于识别独占/退出形态）"""
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
                        'active': (mm.get('Frequencies') or 0) > 0})
    return out


def main():
    rows = load_all()
    contested = [r for r in rows if 0.001 < r['share'] < 0.999]
    print('=' * 96)
    print('★ M2 竞争结构标定 —— 目标均衡份额 + 市场级品牌优势 δ')
    print('=' * 96)
    print()

    by_m = {}
    for r in rows:
        by_m.setdefault(r['m'], []).append(r)

    print('  【每个市场的竞争形态（真实数据全貌）】')
    print('  %-11s %3s %10s %10s %10s %10s %22s' % (
        'market', 'n', '独占期数', '竞争期数', '退出期数', '均衡份额', '形态判读'))
    cal = {}
    for m in sorted(by_m):
        seq = by_m[m]
        mono = sum(1 for r in seq if r['share'] >= 0.999)
        cont = sum(1 for r in seq if 0.001 < r['share'] < 0.999)
        out_ = sum(1 for r in seq if r['share'] <= 0.001)
        cs = [r for r in seq if 0.001 < r['share'] < 0.999]
        tgt = sum(r['share'] for r in cs) / len(cs) if cs else None
        if cont == 0:
            judge = 'CA 独占（或未参与）'
        elif tgt >= 0.60:
            judge = 'CA 主导区'
        elif tgt >= 0.40:
            judge = '均势市场'
        elif tgt >= 0.25:
            judge = 'CA 弱势区'
        else:
            judge = 'CA 极弱势（结构性劣势）'
        print('  %-11s %3d %10d %10d %10d %10s %22s' % (
            m, len(seq), mono, cont, out_,
            f'{tgt*100:.1f}%' if tgt is not None else '—', judge))
        if cs:
            pbar = sum(r['fare'] for r in cs) / len(cs)
            fbar = sum(r['freq'] for r in cs) / len(cs)
            qbar = sum(r['qsi'] for r in cs) / len(cs)
            # ★ 正确基准：市场级偏置就是"等条件下 CA 的相对竞争位"
            #   ln(odds_CA) = (V_CA − V_rival) + δ_player,m
            #   当双方 (价格,班次,QSI) 相同时，δ_player,m 直接给出均衡份额。
            #   该值等于 ΔV = V_CA − V_竞品 的市场均值（与 fit_rivals.py 一致）。
            delta = math.log(tgt / (1 - tgt))
            cal[m] = {
                'target_share': round(tgt, 4),
                'delta_brand': round(delta, 4),
                'ca_avg_fare': round(pbar, 2),
                'ca_avg_freq': round(fbar, 1),
                'ca_avg_qsi': round(qbar, 2),
                'n_contested': len(cs), 'n_monopoly': mono, 'n_exited': out_,
                'verdict': judge,
            }
    print()
    print('  【市场级品牌优势 δ】(δ>0 = CA 结构性占优；δ<0 = CA 结构性劣势)')
    print('  %-11s %10s %12s %10s %10s %10s' % (
        'market', '目标份额', 'δ_brand', '均价', '均班次', '均QSI'))
    for m in sorted(cal, key=lambda x: -cal[x]['delta_brand']):
        c = cal[m]
        print('  %-11s %9.1f%% %12.3f %10.2f %10.0f %10.2f' % (
            m, c['target_share'] * 100, c['delta_brand'], c['ca_avg_fare'],
            c['ca_avg_freq'], c['ca_avg_qsi']))
    print()

    # ── 全局形态分布（沙盘应能复现）──
    print('  【沙盘必须能复现的"竞争形态"清单】')
    regimes = {
        '独占市场 (share=100%)': sum(v['n_monopoly'] for v in cal.values()),
        '完全退出 (share=0%)': sum(v['n_exited'] for v in cal.values()),
        'CA 主导 (share>=60%)': sum(v['n_contested'] for v in cal.values() if v['target_share'] >= 0.60),
        '均势 (40%~60%)': sum(v['n_contested'] for v in cal.values() if 0.40 <= v['target_share'] < 0.60),
        'CA 弱势 (25%~40%)': sum(v['n_contested'] for v in cal.values() if 0.25 <= v['target_share'] < 0.40),
        'CA 极弱势 (<25%)': sum(v['n_contested'] for v in cal.values() if v['target_share'] < 0.25),
    }
    for k, v in regimes.items():
        print(f'    {k:26} {v:3d} 个市场-季度')
    print()
    print('  ⇒ 沙盘的验证目标：能产生上述全部形态，且各形态出现频率大致相当。')
    print('    这比"预测每季份额"更可达，且真正检验了竞争机制的完整性。')

    out = {
        'note': 'M2 竞争结构标定：目标均衡份额 + 市场级品牌优势',
        'weights': {'price': A, 'freq': B, 'qsi': C},
        'market_calibration': cal,
        'regime_counts': regimes,
        'caveat': ('目标份额是**长期均衡位**，不是逐期预测。'
                   'M1 已证明逐期份额无法从 CA 自身属性预测（样本外 15~30pp），'
                   '因为份额波动由观测不到的对手行为驱动。'),
    }
    with io.open(os.path.join(HERE, 'competition-calibration.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('  → rebuild/competition-calibration.json')


if __name__ == '__main__':
    main()
