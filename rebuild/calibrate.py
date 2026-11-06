"""持有成本与融资结构校准器。

用途: 用 Cash Flow Statement 的实际流水，校准 formulas.ownership_cost()
      并分离出 GM 参数无法解释的部分（贷款本金摊还）。

数据来源: 报表 "Cash Flow" 区块（服务端渲染，无 API）

用法:
    python calibrate.py <report.yaml> [label]
    python calibrate.py q2-2028-report.yaml Q2/2028
"""
import re, sys, os, json, glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import formulas as F

ROW = re.compile(r'(?:\'|")row "([^"]+)"(?:\'|")')


def parse_cash_flow(text: str) -> dict:
    """从无障碍树抽取 Cash Flow Statement 的每一行"""
    i = text.find('heading "Cash Flow"')
    if i < 0:
        return {}
    j = text.find('heading "', i + 30)
    seg = text[i:j if j > 0 else len(text)]
    out = {}
    for m in ROW.finditer(seg):
        raw = m.group(1)
        nums = re.findall(r'-?\$?([\d,]+\.?\d*)', raw)
        label = re.sub(r'\s*\$[\d,]+\.?\d*\s*', ' ', raw).strip()
        label = re.sub(r'\s+', ' ', label)
        if nums:
            try:
                out[label] = float(nums[-1].replace(',', ''))
            except ValueError:
                pass
    return out


def calibrate(report_file: str, label: str = ''):
    text = open(report_file, encoding='utf-8').read()

    # 报表头部指标
    m = re.search(r'Average Load Factor\s+([\d.]+)\s+Quality Service Indicator\s+(-?[\d.]+)'
                  r'\s+Market Share\s+([\d.]+)%\s+Break-even Load Factor\s+([\d.]+)%'
                  r'\s+Margin\s+(-?[\d.]+)%\s+Closing Cash\s+\$([\d,]+)', text)
    head = dict(zip(
        ['load_factor', 'qsi', 'market_share', 'break_even_lf', 'margin', 'closing_cash'],
        [float(m.group(i)) for i in range(1, 7)])) if m else {}

    cf = parse_cash_flow(text)
    costs = {}
    ci = text.find('heading "Costs Summary"')
    cj = text.find('heading "Network Metrics"')
    if ci > 0:
        for mm in ROW.finditer(text[ci:cj]):
            raw = mm.group(1)
            nums = re.findall(r'([\d,]+\.?\d*)\s*"?\s*$', raw)
            if not nums:
                continue
            parts = [p.strip() for p in raw.split('" "')] if '" "' in raw else None
            try:
                costs[raw.split(' Quarter ')[-1] if 'Quarter' in raw else raw] = \
                    float(nums[-1].replace(',', ''))
            except ValueError:
                pass

    print('=' * 84)
    print(f'持有成本校准 —— {label or os.path.basename(report_file)}')
    print('=' * 84)
    if head:
        print(f"  客座率 {head['load_factor']:.0f}%  QSI {head['qsi']:.2f}  "
              f"市占率 {head['market_share']:.2f}%  Margin {head['margin']:.2f}%  "
              f"期末现金 ${head['closing_cash']:,.0f}")

    print('\n【现金流三段】')
    for k, v in cf.items():
        if any(w in k for w in ('brought forward', 'Operating Profit', 'Depreciation',
                                'Interest Paid', 'Taxation', 'Fee for', 'ETOPS',
                                'operating activities:', 'investing activities:',
                                'financing activities:', 'Increase or decrease',
                                'Fuel hedge', 'Deposit', 'Repayments', 'Loan Repayments',
                                'sold for')):
            print(f'  {k[:66]:68} {v:>16,.0f}')

    dep = cf.get('Depreciation on Owned Assets', 0.0)
    intp = cf.get('Interest Paid', 0.0)
    own_total = None
    for k, v in cf.items():
        pass
    return head, cf, dep, intp


def ownership_reconciliation(depreciation: float, interest_paid: float,
                             total_price: float, label: str):
    """用 GM 参数校验折旧与利息是否自洽"""
    p = F.GM_COST_PARAMS
    residual = total_price * p['residual_value'] / 100.0
    dep_annual = (total_price - residual) / p['depreciation_years']
    dep_quarter = dep_annual / 4
    int_quarter_on_price = total_price * p['interest_rate'] / 100.0 / 4

    print()
    print('=' * 84)
    print(f'【持有成本拆解校验】{label}')
    print('=' * 84)
    print(f'  资产账面价(假设)          ${total_price:>16,.0f}')
    print(f'  残值率 {p["residual_value"]}%  折旧年限 {p["depreciation_years"]} 年')
    print(f'  → 年折旧 = ({total_price:,.0f} - {residual:,.0f}) / {p["depreciation_years"]}'
          f' = {dep_annual:,.0f}')
    print(f'  → 季折旧 = {dep_annual:,.0f} / 4 = {dep_quarter:,.0f}')
    print(f'  报表实际折旧            ${depreciation:>16,.0f}')
    ratio = depreciation / dep_quarter if dep_quarter else 0
    print(f'  → 比值 {ratio:.3f}  ⟹ 实际持有资产账面价 ≈ ${total_price*ratio:,.0f}'
          f'  (约 {total_price*ratio/40_000_000:.2f} 架 APT100@40M)')

    print()
    print(f'  利率 {p["interest_rate"]}%  贷款年限 {p["interest_years"]} 年')
    print(f'  按资产账面价估算季利息 = ${total_price*ratio*p["interest_rate"]/100/4:,.0f}'
          if False else '', end='')
    implied_principal = interest_paid / (p['interest_rate'] / 100.0) * 4
    print(f'  报表实际利息            ${interest_paid:>16,.0f}')
    print(f'  → 按 {p["interest_rate"]}% 年利率反推贷款本金 ≈ ${implied_principal:,.0f}')
    print(f'  → 每季应还本金 ≈ ${interest_paid/(p["interest_rate"]/100):,.0f}'
          f' (等额本息近似: 本金/({p["interest_years"]}*4 季))')

    print()
    print('★ 结论: Total Ownership Costs = 折旧 + 保险 + 利息')
    print(f'  折旧 {depreciation:,.0f} + 利息 {interest_paid:,.0f} '
          f'= {depreciation + interest_paid:,.0f}  (与报表 Total Ownership 对照)')


if __name__ == '__main__':
    f = sys.argv[1] if len(sys.argv) > 1 else 'q2-2028-report.yaml'
    lb = sys.argv[2] if len(sys.argv) > 2 else ''
    head, cf, dep, intp = calibrate(f, lb)
    # 从现金流推算持有资产规模：用 Loan Repayments 或用折旧反推
    print()
    print('提示: 把报表 Total Ownership Costs 的数值填入下面进行完整对照')
    tot = float(input('  Total Ownership Costs = ').strip() or 0) if sys.stdin.isatty() else 0
    if tot:
        print(f'\n  折旧 + 利息 = {dep + intp:,.0f}   报表总额 = {tot:,.0f}'
              f'   差额(应≈保险) = {tot - dep - intp:,.0f}')
        if dep:
            print(f'  差额/折旧 = {(tot-dep-intp)/dep:.3f}')