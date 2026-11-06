"""终局（2029Q1）现金流生存模拟。

已知 Q4/2028 实际值，各方案下测算 2029Q1 能否存活。
所有输入均来自逆向获取的真实数据；未观测到的系数标注为假设。
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import formulas as F

C = F.CASHFLOW_Q4_2028
Q4 = {
    'revenue': 28_098_604.8 + 1_664_332.076 + 2_214_720,   # 客运+货运+辅营
    'op_costs': 8_956_080 + 2_985_084.9 + 3_847_732.839
                + 2_550_647.7 + 2_071_767.24,              # 燃油+维护+机组+地面+起降
    'indirect': 5_493_905.9,
    'ownership': 6_756_305.874,
    'profit': -1_744_370.554,
    'ocf': C['operating_total'],
    'cash': C['closing_cash'],
    'rou_repay': abs(C['rou_repayments']),
    'loan_repay': abs(C['loan_repayments']),
}

print('=' * 88)
print('终局基线 —— Q4/2028 实际值')
print('=' * 88)
rev = Q4['revenue']; costs = Q4['op_costs'] + Q4['indirect'] + Q4['ownership']
print(f'  总收入        ${rev:>15,.0f}')
print(f'  总成本        ${costs:>15,.0f}')
print(f'  净利润        ${Q4["profit"]:>15,.0f}')
print(f'  经营现金流    ${Q4["ocf"]:>15,.0f}')
print(f'  固定债务      ${Q4["rou_repay"] + Q4["loan_repay"]:>15,.0f}   (租赁还款+贷款)')
print(f'  现金余额      ${Q4["cash"]:>15,.0f}')
print(f'  → 缺口        ${Q4["ocf"] - Q4["rou_repay"] - Q4["loan_repay"]:>15,.0f}')

print()
print('=' * 88)
print('2029Q1 方案模拟（假设已标注）')
print('=' * 88)

SCENARIOS = [
    ('S0 维持现状', dict(
        rev_delta=0.0, cut_rou=0.0, cut_loan=0.0, invest=0,
        note='全部运力维持，42.98 BH')),
    ('S1 退租 CA:009 (G160XLR 13.74BH)', dict(
        rev_delta=-0.14, cut_rou=3_012_000, cut_loan=0, invest=0,
        note='去掉 Broonzy 长航程，运力 -32%')),
    ('S2 退租 CA:005 + CA:009 (28.08BH)', dict(
        rev_delta=-0.27, cut_rou=5_883_606, cut_loan=0, invest=0,
        note='只剩两架 APT100，放弃所有远端市场')),
    ('S3 S2 + 聚焦提价', dict(
        rev_delta=-0.22, cut_rou=5_883_606, cut_loan=0, invest=0,
        note='聚焦 Simone/Joplin 高价航线，假设客座率回到 76%')),
    ('S4 S2 + 继续投 SAF', dict(
        rev_delta=-0.27, cut_rou=5_883_606, cut_loan=0, invest=-2_000_000,
        note='维持碳抵消投入（ESG 形象但耗现金）')),
]

hdr = ('方案', '收入Δ', '租赁还款', '经营现金流', '融资流出', '期末现金', '判定')
print(f'{hdr[0]:<34}{hdr[1]:>8}{hdr[2]:>13}{hdr[3]:>15}{hdr[4]:>14}{hdr[5]:>14}  {hdr[6]}')
print('-' * 110)
results = []
for name, p in SCENARIOS:
    r = rev * (1 + p['rev_delta'])
    # 成本随运力缩减：可变成本按运力比例，刚性(持有/租金)不全降
    variable_share = 0.55
    c = costs * (variable_share + (1 - variable_share) * (1 + p['rev_delta']))
    ebit = r - c
    ocf = ebit + Q4['ownership'] * 0.6 + F.SAF_PROJECT_Q4_2028 * 0  # 折旧加回
    # 折旧非现金，需加回；用 Q4 实际关系近似
    dep = 520_200 + 4_408_615 * (1 + p['rev_delta'])
    ocf = ebit + dep
    fin = -(Q4['rou_repay'] - p['cut_rou']) - Q4['loan_repay'] + p['invest']
    closing = Q4['cash'] + ocf + fin
    ok = '存活' if closing > 0 else '★ 破产'
    results.append((name, closing, ok))
    print(f'{name:<34}{p["rev_delta"]*100:>7.0f}%{Q4["rou_repay"]-p["cut_rou"]:>13,.0f}'
          f'{ocf:>15,.0f}{fin:>14,.0f}{closing:>14,.0f}  {ok}')

print()
print('=' * 88)
print('★ 关键结论')
print('=' * 88)
surv = [r for r in results if r[2] == '存活']
dead = [r for r in results if r[2] != '存活']
if dead:
    print(f'  {len(dead)}/{len(SCENARIOS)} 个方案在 2029Q1 破产')
    print(f'  包括「维持现状」→ 不作为则必败')
if surv:
    print(f'  可存活方案: {", ".join(r[0] for r in surv)}')
print()
print('  核心矛盾:')
print(f'    租赁还款 ${Q4["rou_repay"]:,.0f}/季 是刚性支出')
print(f'    经营现金流需 > ${Q4["rou_repay"] + Q4["loan_repay"]:,.0f} 才能维持')
print(f'    Q4 实际经营现金流 ${Q4["ocf"]:,.0f}，缺口 ${Q4["rou_repay"]+Q4["loan_repay"]-Q4["ocf"]:,.0f}')
print()
print('  退租虽然立刻损失收入，但同时消除刚性支出 ——')
print('  这是 2029Q1 唯一的正向杠杆动作。')