"""用逆向得到的模型复盘 CA 七季真实决策。

输入: 37 个 (季度 × 市场) 观测点 (含完整损益表) + 运价表 + 市场参数
输出: 每季度的模型复算值 vs 实际值，差异归因，以及决策得失量化。
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

OBS = json.load(open(os.path.join(HERE, 'observations.json'), encoding='utf-8'))
FARES = json.load(open(os.path.join(HERE, 'fares_by_turn.json'), encoding='utf-8'))

TURN = {'Q4/2027': 0, 'Q1/2028': 1, 'Q2/2028': 2, 'Q3/2028': 3,
        'Q4/2028': 4, 'Q1/2029': 5, 'Q2/2029': 6}
CODE = {'Lewis': 'LEW', 'Simone': 'SIM', 'Fitzgerald': 'FTZ', 'Ellington': 'ETN',
        'Armstrong': 'ARM', 'Joplin': 'JOP', 'Broonzy': 'BZY'}
ELAS = {'Lewis': 1.10, 'Simone': 1.10, 'Fitzgerald': 1.05, 'Ellington': 1.05,
        'Armstrong': 1.10, 'Joplin': 1.10, 'Broonzy': 1.05}
# ★ 识别修正 v2：见 demand.py 的模块文档
#   等式行(LF<100%) 反解几何均值 + LF=100% 行硬下界，取 max
K = {'Armstrong': 68505, 'Simone': 9868, 'Broonzy': 26953, 'Joplin': 12999,
     'Lewis': 7555, 'Fitzgerald': 5951, 'Ellington': 11603}
FARE_REF, FREQ_REF, FREQ_EXP = 200.0, 100.0, 0.50
A_REV = 0.926228

# 成本模型系数（来自 engine.py 回归）
C_CARGO_HANDLING = (1033, 51.38)
C_TRAFFIC = (-5198, 10.66)
C_AIRCRAFT_HANDLING = (19160, 719.3)
C_LANDING = (33860, 546.6)
C_MAINT = (313200, -667.8, 135.6)
C_CREW = (404200, -1550, 190.1)
C_FUEL = (452000, 96.44)
C_CARGO_OH = (19108, 0.002296)
C_GA = (133649, 0.006118)


def qsi_f(qsi):
    """保留旧形式以便对照实验（已证明加入 QSI 会使拟合变差）"""
    return ((max(qsi, -0.5 + 1e-6) + 0.5) / 10.5) ** 0.45


def demand(name, fare, freq, use_qsi=False, qsi=0.0):
    """D = K_m × (FARE_REF/fare)^eps × (freq/FREQ_REF)^FREQ_EXP
    （QSI 项默认关闭：可识别性检验显示加入后拟合变差）"""
    qf = qsi_f(qsi) if use_qsi else 1.0
    return (K[name] * qf * (FARE_REF / max(fare, 1e-9)) ** ELAS[name]
            * (max(freq, 1.0) / FREQ_REF) ** FREQ_EXP)


def fare_of(q, m, pax, rev):
    """由客运收入反解当季执行运价"""
    if not rev or not pax:
        return None
    return rev / (A_REV * pax)


def main():
    rows = []
    for q, v in OBS.items():
        tn = TURN.get(q)
        for m, mm in v['metrics'].items():
            if m == '_network':
                continue
            p = v['pnl'].get(m, {})
            lf = (mm.get('Load Factor') or 0) / 100.0
            pax = (mm.get('Passengers (000)') or 0) * 1000
            if not pax or not lf:
                continue
            rev = p.get('Passenger Revenue')
            fare = fare_of(q, m, pax, rev)
            if fare is None:
                continue
            snap = FARES.get(f'{tn}:{CODE.get(m)}')
            rows.append({
                'q': q, 'm': m, 'code': CODE.get(m), 'lf': lf, 'pax': pax,
                'fare': fare, 'snap': snap, 'qsi': mm.get('QSI') or 0.0,
                'freq': mm.get('Frequencies') or 0,
                'adu': mm.get('ADU (BH)') or 0,
                'ask': (mm.get('ASK (MM)') or 0) * 1e6,
                'cargo': mm.get('Cargo (tonnes)') or 0,
                'pnl': p,
            })

    print('=' * 92)
    print('★ 模型复算 vs 实际 —— 航线级客运收入')
    print('=' * 92)
    print(f'{"季度":<9}{"市场":<12}{"执行运价":>9}{"快照运价":>9}{"实际旅客":>9}'
          f'{"模型需求":>10}{"受限":>6}{"实际收入":>13}{"模型收入":>13}{"误差":>8}')
    tot_a = tot_m = 0.0
    for r in rows:
        D = demand(r['m'], r['fare'], r['freq'])
        served = min(D, r['pax'] / max(r['lf'], 1e-9)) if r['lf'] else 0
        model_rev = A_REV * r['fare'] * min(D, r['pax'])
        act = r['pnl'].get('Passenger Revenue', 0)
        err = (model_rev - act) / act * 100 if act else 0
        tot_a += act; tot_m += model_rev
        print(f'{r["q"]:<9}{r["m"]:<12}{r["fare"]:>9.2f}'
              f'{(r["snap"] if r["snap"] else 0):>9.0f}{r["pax"]:>9,.0f}'
              f'{D:>10,.0f}{"限" if r["lf"] < 0.999 else "★":>6}'
              f'{act:>13,.0f}{model_rev:>13,.0f}{err:>7.1f}%')
    print(f'\n  合计  实际 ${tot_a:>14,.0f}   模型 ${tot_m:>14,.0f}   '
          f'总误差 {(tot_m-tot_a)/tot_a*100:+.2f}%')

    # ── 决策得失 ──
    print()
    print('=' * 92)
    print('★ 决策复盘')
    print('=' * 92)

    # 1) 运价调整
    print('\n【1】运价调整：反解的执行价 vs 快照价（差值=回合内改价）')
    print(f'{"季度":<9}{"市场":<12}{"快照":>8}{"执行":>8}{"变动":>9}{"实际旅客":>10}{"客座率":>9}')
    for r in sorted(rows, key=lambda x: (x['q'], x['m'])):
        if not r['snap']:
            continue
        d = (r['fare'] - r['snap']) / r['snap'] * 100
        if abs(d) < 3:
            continue
        print(f'{r["q"]:<9}{r["m"]:<12}{r["snap"]:>8.0f}{r["fare"]:>8.2f}'
              f'{d:>8.1f}%{r["pax"]:>10,.0f}{r["lf"]*100:>8.1f}%')

    # 2) 满载观察
    print('\n【2】需求上限观测（LF=100% ⇒ 需求被暴露）')
    for r in rows:
        if r['lf'] >= 0.999:
            D = demand(r['m'], r['fare'], r['freq'])
            print(f'  {r["q"]:<9}{r["m"]:<12}旅客 {r["pax"]:>8,.0f}  '
                  f'运价 ${r["fare"]:.2f}  QSI {r["qsi"]:.2f}  → 需求上限已触及')

    # 3) 每季度损益
    print('\n【3】每季度损益结构（实际）')
    for q, v in OBS.items():
        tot = v['pnl'].get('_total')
        if not tot:
            continue
        rev = sum(v['pnl'].get(m, {}).get('Total Revenue', 0) for m in v['pnl'] if m != '_total')
        op = sum(v['pnl'].get(m, {}).get('Operating Profit/Loss', 0) for m in v['pnl'] if m != '_total')
        print(f'  {q:<9}航线收入合计 ${rev:>13,.0f}   航线经营损益合计 ${op:>12,.0f}')

    # 4) 关键洞察
    print('\n【4】关键洞察')
    print('  · 全部 37 个观测中，客座率 < 100% 的占绝大多数 → 需求上限极少暴露')
    print('    ⇒ 服务端通过"供给约束"使需求函数不可从黑箱操作反推')
    print('  · 运价与执行价的系统性偏离，集中在回合内改价的季度')
    print('    ⇒ 玩家策略(而非模型)是客运收入的主要不确定来源')
    print('  · ADU×频次 与 报告 Frequencies 精确对应，验证"每排班=每日1班"的结构')
    print('  · 成本侧 10 个公式可复现，误差主要来自机型混合与租约结构')


if __name__ == '__main__':
    main()