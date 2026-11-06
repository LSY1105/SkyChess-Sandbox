#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
基线校验与沙盘对照  (rebuild/verify_baseline.py)

用途：
  1) 校验 baseline_real.json 中从一手材料提取的原版数值是否自洽（算术闭合）
  2) 与 sandbox 引擎的对应实现逐项对照，输出差异清单（可执行、可复查）

运行：python rebuild/verify_baseline.py
不依赖第三方库。
"""
import io, json, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
sys.path.insert(0, os.path.join(ROOT, 'sandbox'))

PASS, FAIL = [], []

def chk(cond, name, detail=''):
    (PASS if cond else FAIL).append(name)
    print(('  ✓ ' if cond else '  ✗ ') + name + (('  ' + detail) if detail else ''))

def close(a, b, tol=1.0):
    return abs(a - b) <= tol

def main():
    data = json.load(io.open(os.path.join(BASE, 'baseline_real.json'), encoding='utf-8'))
    g = data['global_baseline_q4_2027']
    ocs = g['operating_costs_statement']
    cfs = g['cash_flow_statement']

    print('=' * 72)
    print('① 原版 Q4/2027 报表算术闭合校验（来自 Reports-ECONOMICS 截图原值）')
    print('=' * 72)

    rev = ocs['revenues']
    doc = ocs['direct_cash_operating_costs']
    ioc = ocs['indirect_operating_costs']
    own = ocs['total_ownership_costs']
    tot = ocs['totals']

    chk(close(rev['Passenger Revenue'] + rev['Cargo Revenue'] + rev['Ancillary Revenue'],
              rev['TOTAL REVENUE']), '收入三项之和 = TOTAL REVENUE',
        f"{rev['TOTAL REVENUE']:,}")
    s_doc = sum(v for k, v in doc.items() if k != 'DIRECT CASH OPERATING COSTS')
    chk(close(s_doc, doc['DIRECT CASH OPERATING COSTS']), '11 项直接成本之和 = DCOC',
        f"{doc['DIRECT CASH OPERATING COSTS']:,}")
    s_ioc = sum(v for k, v in ioc.items() if k != 'INDIRECT OPERATING COSTS')
    chk(close(s_ioc, ioc['INDIRECT OPERATING COSTS']), '4 项间接成本之和 = IOC',
        f"{ioc['INDIRECT OPERATING COSTS']:,}")
    s_own = sum(v for k, v in own.items() if k != 'TOTAL OWNERSHIP COSTS')
    chk(close(s_own, own['TOTAL OWNERSHIP COSTS']), '4 项所有权成本之和 = TOTAL OWNERSHIP',
        f"{own['TOTAL OWNERSHIP COSTS']:,}")
    s_all = (doc['DIRECT CASH OPERATING COSTS'] + ioc['INDIRECT OPERATING COSTS']
             + own['TOTAL OWNERSHIP COSTS'])
    chk(close(s_all, tot['TOTAL OPERATING COSTS']), 'DCOC+IOC+Ownership = TOTAL OPERATING COSTS',
        f"{tot['TOTAL OPERATING COSTS']:,}")
    op = rev['TOTAL REVENUE'] - tot['TOTAL OPERATING COSTS']
    chk(close(op, tot['OPERATING PROFIT/LOSS']), '收入 − 总运营成本 = 经营利润',
        f"{op:,.0f}")
    pbt = op - tot['NET FINANCE CHARGES'] + tot['PROFIT/LOSS ON ASSET SALES']
    chk(close(pbt, tot['PROFIT/LOSS BEFORE TAX']), '经营利润 − 净财务费用 = 税前利润',
        f"{pbt:,.0f}")
    chk(close(pbt / rev['TOTAL REVENUE'], tot['Pre-tax Profit Margin'], 0.0001),
        '税前利润率自洽', f"{pbt/rev['TOTAL REVENUE']:.4%}")

    cf = cfs['CASH FLOW FROM OPERATING ACTIVITIES']
    cff = cfs['CASH FLOW FROM FINANCING ACTIVITIES']
    cfo = sum(v for k, v in cf.items() if k != 'Cash flow from operating activities')
    chk(close(cfo, cf['Cash flow from operating activities']), '经营现金流小计自洽',
        f"{cfo:,}")
    cff_sum = sum(v for k, v in cff.items() if k != 'Cash flow from financing activities')
    chk(close(cff_sum, cff['Cash flow from financing activities']), '融资现金流小计自洽',
        f"{cff_sum:,}")
    delta = cfo + cfs['CASH FLOW FROM INVESTING ACTIVITIES'] + cff_sum
    chk(close(delta, cfs['INCREASE OR DECREASE IN CASH FOR THE PERIOD']),
        '三类现金流之和 = 本期现金变动', f"{delta:,.0f}")
    end = cfs['Cash brought forward'] + delta
    chk(close(end, cfs['CASH IN HAND CARRIED FORWARD']), '期初 + 变动 = 期末现金',
        f"{end:,.0f}")

    print()
    print('=' * 72)
    print('② 沙盘引擎与原版报表结构对照')
    print('=' * 72)
    src = io.open(os.path.join(ROOT, 'sandbox', 'game.js'), encoding='utf-8').read()
    import re as _re
    _carbon = 'n/a'
    _gm = _re.search(r'export const GM = \{(.*?)\n\};', src, _re.S)
    if _gm:
        for _line in _gm.group(1).split('\n'):
            _m = _re.match(r'\s*(\w+):\s*([-\d.]+)', _line)
            if _m and 'carbon' in _m.group(1).lower():
                _carbon = _m.group(2)

    ORIG_LINES = [
        'Fuel', 'Sustainable Aviation Fuel', 'Carbon', 'Maintenance', 'Flight Crew',
        'Cabin Crew', 'Landing', 'Navigation', 'Aircraft Handling', 'Traffic Handling',
        'Cargo Handling', 'Passenger Services', 'Ticketing, Sales and Promotion',
        'General & Administration', 'Cargo Overheads',
    ]
    for line in ORIG_LINES:
        present = f"'{line}'" in src
        chk(present, f'沙盘损益含原版行项「{line}」')

    print()
    print('  ── 口径差异（需在 Cost Data 页向教师明示）──')
    # 碳价：原版是「每吨碳价」且随时间变化；沙盘是 GM.carbonPrice（按 ASK 系数）
    print(f'    · 原版碳成本 $458,843/季；VA 记录碳价从 $2,570/吨 → $6,072/吨（Q1→Q3）')
    print(f'    · 沙盘 GM 碳价字段 = {_carbon}（静态系数，非可变单价）')
    # 贷款还款口径
    print(f'    · 原版 Q4/2027：Loan Repayments -$2,570,420 且 Interest Paid -$892,838 是否重叠 → 未定（须裁判确认）')
    print(f'    · 沙盘 loans[].quarterlyRepay 是否含利息 → 需核对 game.js 实现')
    # IFRS16
    print(f'    · 原版 Q4/2027：Depreciation on RoU = 0、Wet Lease Payments = 0（该局未适用 IFRS16）')
    print(f'    · 沙盘租赁付款在 financing（等价旧口径）→ 与该局一致')
    # 辅营占比
    r = g['derived_ratios']
    print(f'    · 原版 Q4/2027 辅营占比 {r["ancillary_share_of_revenue"]:.2%}（远低于"40%"目标）')
    print(f'      → "辅营 40%"是沙盘考核目标而非原版现实，教学中须明示，否则学生误判目标可达性')

    print()
    print('=' * 72)
    print('③ 原版三家公司真实基线汇总（沙盘标定与验收目标）')
    print('=' * 72)
    ca, va = data['capital_airways']['quarters'], data['vision_air']['quarters']
    rows = []
    for k in ['Q4_2027', 'Q1_2028', 'Q2_2028', 'Q3_2028']:
        v = va.get(k)
        if v:
            rows.append(('VA', k, v['revenue'], v['net_margin'], v['closing_cash'],
                         v['load_factor'], v['break_even_lf'], v['market_share'], v['qsi']))
    for k, v in ca.items():
        rows.append(('CA', k.replace('_', ' '), v['revenue'],
                     v.get('net_margin', v.get('net_margin_target')),
                     v.get('closing_cash'), v.get('load_factor'), v.get('break_even_lf'),
                     v.get('market_share'), v.get('qsi')))
    rows = [r_ for r_ in rows if r_[3] is not None]
    print(f"  {'队':<3}{'季度':<10}{'收入':>12}{'净利率':>9}{'期末现金':>13}{'LF':>7}{'BELF':>7}{'份额':>8}{'QSI':>7}")
    for r_ in rows:
        def _f(v, fmt, dash='—'):
            return format(v, fmt) if isinstance(v, (int, float)) else dash
        print(f'  {r_[0]:<3}{r_[1]:<10}{_f(r_[2], ",.0f"):>12}{_f(r_[3], ".2%"):>9}'
              f'{_f(r_[4], ",.0f"):>13}{_f(r_[5], ".1%"):>7}{_f(r_[6], ".1%"):>7}'
              f'{_f(r_[7], ".2%"):>8}{_f(r_[8], ".2f"):>7}')

    print()
    print(f"  CA 收入 Q1→Q3：{ca['Q1_2028']['revenue']:,} → {ca['Q2_2028']['revenue']:,} → {ca['Q3_2028']['revenue']:,}")
    print(f"  VA 收入 Q4'27→Q3'28：{va['Q4_2027']['revenue']:,} → {va['Q1_2028']['revenue']:,} → {va['Q2_2028']['revenue']:,} → {va['Q3_2028']['revenue']:,}")
    print('  ⇒ 两家收入量级同为 $12M–$44M/季；沙盘起始机队 2 架、单市场，须验证可产出同量级')

    print()
    print('=' * 72)
    print(f'校验结果：{len(PASS)} 通过 / {len(FAIL)} 失败 / 共 {len(PASS)+len(FAIL)}')
    print('=' * 72)
    if FAIL:
        for f in FAIL:
            print('  未通过：', f)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
