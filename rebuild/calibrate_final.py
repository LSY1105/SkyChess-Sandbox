"""需求模型最终标定 —— 以**财务保真度**为目标函数。

背景
  fit_demand_v2.py 用 log-RMS 标定 D 的预测误差（等式行），得到 log-RMS ≈ 34%。
  但沙盘的用途是**财务仿真**：目标应是让航线收入贴近真实报表，
  因此最终参数应以「收入加权误差最小」标定，而不是 D 的对数误差。

  收入 = a × fare × min(D, ASK)
    · 等式行 (LF<100%)：D = pax，故 revenue = a·fare·pax → 与 K 无关
    · 下界行 (LF=100%)：D ≥ ASK，revenue = a·fare·min(D,ASK)
      只有当模型 D < ASK 时才会有偏差
  ⇒ 纯收入目标对"等式行"不敏感，信息量低 → 采取**双目标**：
     1) 硬约束：所有下界行满足 D ≥ ASK
     2) 软目标：等式行上 log-RMS 最小
     3) 报告口径：收入加权误差（用于与真实报表对账）
  这与 fit_demand_v2.py 完全一致，本脚本只补齐**收入侧对账表**与参数导出。

输出
  demand-fit.json —— 沙盘与 rebuild 共用的最终参数
"""
import io, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import demand as DM

OBS = json.load(io.open(os.path.join(HERE, 'observations.json'), encoding='utf-8'))
FARES = json.load(io.open(os.path.join(HERE, 'fares_by_turn.json'), encoding='utf-8'))

A_REV = 0.926228
TURN = {'Q4/2027': 0, 'Q1/2028': 1, 'Q2/2028': 2, 'Q3/2028': 3,
        'Q4/2028': 4, 'Q1/2029': 5, 'Q2/2029': 6}
CODE = {'Lewis': 'LEW', 'Simone': 'SIM', 'Fitzgerald': 'FTZ', 'Ellington': 'ETN',
        'Armstrong': 'ARM', 'Joplin': 'JOP', 'Broonzy': 'BZY'}
QORDER = ['Q4/2027', 'Q1/2028', 'Q2/2028', 'Q3/2028', 'Q4/2028', 'Q1/2029', 'Q2/2029']


def load_rows():
    rows = []
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
            if not pax or not lf or not rev:
                continue
            rows.append({
                'q': q, 'm': m, 'lf': lf, 'pax': pax, 'ask': pax / lf,
                'fare': rev / (A_REV * pax),
                'freq': mm.get('Frequencies') or 0,
                'qsi': mm.get('QSI') or 0.0,
                'rev': rev,
                'snap': FARES.get(f"{TURN.get(q)}:{CODE.get(m)}"),
            })
    return rows


def main():
    rows = load_rows()
    eq = [r for r in rows if r['lf'] < 0.999]
    bd = [r for r in rows if r['lf'] >= 0.999]

    print('=' * 96)
    print('★ 需求模型最终参数对账（财务保真度口径）')
    print('=' * 96)
    print()

    tot_a = tot_m = 0.0
    print('  %-9s %-12s %9s %7s %10s %10s %14s %14s %8s' % (
        '季度', '市场', '执行运价', '班次', '实际D', '模型D', '实际收入', '模型收入', '误差'))
    for r in rows:
        D = DM.demand(r['m'], r['fare'], r['freq'])
        model_rev = A_REV * r['fare'] * min(D, r['ask'])
        err = (model_rev - r['rev']) / r['rev'] * 100 if r['rev'] else 0
        tot_a += r['rev']; tot_m += model_rev
        mark = '★' if r['lf'] >= 0.999 else ('限' if r['lf'] < 0.999 else '')
        print('  %-9s %-12s %9.2f %7.0f %10s %10s %14s %14s %7.1f%% %s' % (
            r['q'], r['m'], r['fare'], r['freq'],
            f"{r['pax']:,.0f}", f"{D:,.0f}", f"{r['rev']:,.0f}", f"{model_rev:,.0f}", err, mark))
    print()
    print(f'  合计  实际 ${tot_a:,.0f}   模型 ${tot_m:,.0f}   总误差 {(tot_m-tot_a)/tot_a*100:+.2f}%')
    print()

    # 等式行的 D 精度（模型精度的直接度量）
    sq = 0.0
    for r in eq:
        D = DM.demand(r['m'], r['fare'], r['freq'])
        sq += math.log(D / r['pax']) ** 2
    rms = math.sqrt(sq / len(eq))
    print(f'  等式行 D 预测 log-RMS = {rms*100:.2f}%  ({len(eq)} 行)')
    print()

    # 下界检验
    okb = 0
    for r in bd:
        D = DM.demand(r['m'], r['fare'], r['freq'])
        okb += D >= r['ask'] * (1 - 1e-5)   # 相对容差：K 正好卡在下界上时避免浮点误判
    print(f'  下界检验（LF=100% ⇒ D≥ASK）: {okb}/{len(bd)} 满足')
    print()

    out = {
        'version': 'v2-final',
        'form': 'D = K_market * (FARE_REF/fare)^eps_market * (freq/FREQ_REF)^FREQ_EXP',
        'fare_ref': DM.FARE_REF,
        'freq_ref': DM.FREQ_REF,
        'freq_exp': DM.FREQ_EXP,
        'revenue_coef': A_REV,
        'demand_K': {m: int(v) for m, v in DM.DEMAND_K.items()},
        'elasticity': DM.ELASTICITY,
        'qsi_in_model': False,
        'identification': ('LF<100% ⇒ D=pax（精确等式，31 行）；LF=100% ⇒ D>=ASK（下界，3 行）。'
                           '旧模型方向相反，丢弃了全部含信息量的等式行。'),
        'log_rms_pct': round(rms * 100, 2),
        'revenue_total_err_pct': round((tot_m - tot_a) / tot_a * 100, 2),
        'eq_rows': len(eq), 'bound_rows': len(bd),
        'known_limits': [
            '运价回合内变更使反解执行价 = 旅客加权均价（测量误差，31 行中 10 行偏差 >8%）',
            '价格弹性不可独立识别（K 与 eps 共线），采用 API 逆向值',
            '报告列 QSI 为季度级变量、与隐含需求非单调，加入后拟合反而变差 → 不入模型',
            '存在未建模的市场-季度效应（残差最大 ±70%，同频次同价下需求可差 3 倍）',
        ],
    }
    with io.open(os.path.join(HERE, 'demand-fit.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('  最终参数 → rebuild/demand-fit.json')
    print('  可直接同步到 sandbox/engine.js 的 DEMAND_K 与需求函数')


if __name__ == '__main__':
    main()
