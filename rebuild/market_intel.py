"""合并 API 数据与游戏内购买的市场情报报告，产出完整市场需求模型。

来源:
  A) /play/api/airline/833/scheduler/{turn}  ->  在营航线的完整 market 对象
  B) SkyChess Market Intelligence Report v4 (游戏内购买) -> 全部 7 个市场的文字参数
  C) game.turns[].markets[].elasticity_resolved  -> 服务端解析后的弹性
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# ── B) 情报报告（人工转录自 PDF，逐条核对原文）────────────────────────
INTELLIGENCE = {
    'Lewis': {
        'pop': 12000,
        'pop_growth_pct_q': 2.0, 'gdp_growth_pct_q': 1.7,
        'pop_elasticity': 1.15, 'gdp_elasticity': 1.4,
        'pax_potential_per_day': '150-200', 'guide_fare': 110.0,
        'cargo_tonnes_day': 12.0, 'cargo_yield_per_tkm': 0.35,
        'notes': '旅游目的地，人口稳定无季节波动；建议价格有弹性',
    },
    'Simone': {
        'pop': 19000,
        'pop_growth_pct_q': 2.0, 'gdp_growth_pct_q': 1.5,
        'pop_elasticity': 1.2, 'gdp_elasticity': 1.3,
        'pax_potential_per_day': 115, 'current_flights_Q1_2028': 3,
        'cargo_tonnes_day': 5.0,
        'notes': '沿海旅游热点+新建鱼类加工厂；冬季假期旺季；当前运量偏低有增长潜力',
    },
    'Fitzgerald': {
        'pop': 42000,
        'pop_growth_pct_q': 1.0, 'gdp_growth_pct_q': 1.0,
        'pop_elasticity': 1.15, 'gdp_elasticity': 1.3,
        'cargo_tonnes_day': 10.0, 'cargo_yield_per_tkm': 0.20,
        'current_flights_Q1_2028': 4,
        'notes': '每天三个需求高峰，反映到枢纽的通勤需求；到枢纽飞行约 85 分钟',
    },
    'Ellington': {
        'pop': 35000,
        'pop_growth_pct_q': 1.0, 'gdp_growth_pct_q': 1.0,
        'pop_elasticity': 1.2, 'gdp_elasticity': 1.4,
        'cargo_tonnes_day': 4.0, 'cargo_yield_per_tkm': 0.30,
        'current_flights_Q1_2028': 4,
        'notes': '旅游+退休定居点；佐格山活火山风险；到枢纽便利性重要',
    },
    'Parker': {
        'pop': 22000,
        'pop_growth_pct_q': 2.0, 'gdp_growth_pct_q': 1.0,
        'pop_elasticity': 1.2, 'gdp_elasticity': 1.5,
        'cargo_tonnes_day': 5.0, 'cargo_yield_per_tkm': 0.08,
        'current_flights_Q1_2028': 2,
        'notes': '2003 年建成的生物燃料工业城；公路发达，航空影响小',
    },
    'Armstrong': {
        'pop': 38000,
        'pop_growth_pct_q': 2.0, 'gdp_growth_pct_q': 3.0,
        'pop_elasticity': 1.25, 'gdp_elasticity': 1.65,
        'pax_potential_per_day': '80-150', 'guide_fare': 650.0,
        'cargo_tonnes_day': 12.0, 'cargo_yield_per_tkm': 0.09,
        'requires': 'ETOPS 运营批准',
        'notes': '新机场；需民航局 ETOPS 批准才能排班；GDP 前景最佳',
    },
    # ── Q3 新增市场（来自 supplement v4，2028-07 获得）──
    'Joplin': {
        'pop': 1500,
        'pop_growth_pct_q': 1.0, 'gdp_growth_pct_q': 4.0,
        'pop_elasticity': 0.2, 'gdp_elasticity': 1.7,
        'guide_fare': 170.0,          # 经济舱往返
        'cargo_tonnes_day': 40.0, 'cargo_yield_per_tkm': 0.15,
        'pax_potential_per_day': '120-150',
        'seasonal': '北半球夏季高峰；深秋至初春明显下降',
        'business_yield_multiple': 3.0,
        'notes': '奢华岛屿度假村，人口仅1500（几乎全在酒店业）；渡轮曾是唯一交通；'
                 '商务舱收益预计为经济舱 3 倍；需求由弹性+非弹性混合组成',
    },
    'Charles City': {
        'pop': 27000,
        'pop_growth_pct_q': 3.0, 'gdp_growth_pct_q': 3.0,
        'pop_elasticity': 1.5, 'gdp_elasticity': 1.5,
        'guide_fare': 220.0,          # 经济舱往返
        'cargo_tonnes_day': 20.0, 'cargo_yield_per_tkm': 0.60,
        'pax_potential_per_day': 130,
        'requires': 'ESG 环保项目（影响票价 AND 时刻获取）',
        'notes': '崛起中的金融中心，政府税收优惠；机场重大升级；十家精品商务酒店；'
                 '货物以 IT 类为主，收益最高(0.60)；市场预计相对缺乏弹性',
    },
    'Broonzy': {
        'pop': 28000,
        'pop_growth_pct_q': 2.0, 'gdp_growth_pct_q': 3.0,
        'pop_elasticity': 1.2, 'gdp_elasticity': 1.5,
        'guide_fare': 700.0,          # 经济舱往返
        'cargo_tonnes_day': 30.0, 'cargo_yield_per_tkm': 0.40,
        'pax_potential_per_day': '90-120',
        'requires': 'ETOPS 运营许可',
        'notes': '蓝调与爵士乐文化之旅基地；康利-布拉德利山脉户外游；'
                 '客运需求全天稳定；新开放航权',
    },
    'McGee': {
        'pop': 14000,
        'pop_growth_pct_q': 1.0, 'gdp_growth_pct_q': 1.0,
        'pop_elasticity': 1.05, 'gdp_elasticity': 1.35,
        'pax_potential_per_day': '70-140', 'guide_fare': 825.0,
        'cargo_tonnes_day': 12.0, 'cargo_yield_per_tkm': 0.09,
        'requires': 'ETOPS 运营批准',
        'notes': '新机场；需求预测不确定；建议不超过 1 个承运人',
    },
}

# 官方航线图 "SkyChess_map of routes with additional destinations 2022"
# 表头: "BH = Block Hours one way"
HUB_BH = {   # 单程 block hours
    'LEW': 1.00, 'SIM': 1.13, 'FTZ': 1.44, 'ETN': 1.88,
    'PKR': 2.44, 'ARM': 5.04, 'GEE': 6.82,
}
HUB_KM = {
    'LEW': 415, 'SIM': 525, 'FTZ': 784, 'ETN': 1150,
    'PKR': 1620, 'ARM': 3780, 'GEE': 5265,
}
ETOPS_REQUIRED = {'ARM', 'GEE'}      # 航线图上标注 ETOPS

MACRO = {
    'global_gdp_growth': {'2028': 2.2, '2029': 2.2},
    'regional_gdp_growth': {'2028': 3.9, '2029': 4.2},
    'global_pop_growth': {'2027': 1.1},
    'regional_pop_growth': {'2028': 2.5, '2029': 3.2},
    'bank_annual_interest_rate_pct': 4.0,
    'carbon_scheme': 'CORSIA 自 2027-01 起强制；已纳入自愿阶段',
    'risks': [
        '能源价格冲击（最高可能性，措辞为“采取立即生效的燃料套期保值”）',
        '数据欺诈/盗窃 + 网络攻击（第二位）',
        '进一步疾病大流行（最大风险）',
        '环境：艾灵顿地区佐格山火山活动加剧',
        '国际间冲突（2028/2029 无上升迹象）',
    ],
}


def load_api_markets(state_file):
    """从快照中抽取在营航线的完整 market 对象"""
    d = json.load(open(state_file, encoding='utf-8'))['snapshots']
    out = {}
    for ep, v in d.items():
        s = json.dumps(v, ensure_ascii=False)
        for mm in re.finditer(r'"market":\{"id":(\d+),"name":"(\w+)"', s):
            pass
    sch = d.get('/play/api/airline/833/scheduler/5205', {}).get('payload')
    if not sch:
        return out
    for m in sch['airlineturn']['markets']:
        gm = m['gamemarket']
        full = gm.get('market', {})
        if 'sector_length' in full:
            out[full['name']] = full
    return out


def build(state_file='state-turn1.json'):
    api = load_api_markets(state_file)
    table = {}
    for name, intel in INTELLIGENCE.items():
        a = api.get(name, {})
        table[name] = {
            'population': intel['pop'],
            'code': {'Lewis':'LEW','Simone':'SIM','Fitzgerald':'FTZ','Ellington':'ETN',
                     'Parker':'PKR','Armstrong':'ARM','McGee':'GEE',
                     'Joplin':'JOP','Charles City':'CHA','Broonzy':'BRZ'}.get(name, ''),
            'hub_bh': HUB_BH.get({'Lewis':'LEW','Simone':'SIM','Fitzgerald':'FTZ',
                                  'Ellington':'ETN','Parker':'PKR','Armstrong':'ARM',
                                  'McGee':'GEE'}.get(name, '')),
            'hub_km': HUB_KM.get({'Lewis':'LEW','Simone':'SIM','Fitzgerald':'FTZ',
                                  'Ellington':'ETN','Parker':'PKR','Armstrong':'ARM',
                                  'McGee':'GEE'}.get(name, '')),
            'seasonal': intel.get('seasonal'),
            'business_yield_multiple': intel.get('business_yield_multiple'),
            'sector_length_km': a.get('sector_length'),
            'market_size': a.get('size'),
            'pop_growth_pct_q_report': intel['pop_growth_pct_q'],
            'gdp_growth_pct_q_report': intel['gdp_growth_pct_q'],
            'pop_elasticity_report': intel['pop_elasticity'],
            'gdp_elasticity_report': intel['gdp_elasticity'],
            'api_population_growth': a.get('population_growth'),
            'api_gdp_growth': a.get('gdp_growth'),
            'api_population_demand': a.get('population_demand'),
            'api_gdp_demand': a.get('gdp_demand'),
            'api_k_factor': a.get('k_factor'),
            'api_elasticity': a.get('elasticity'),
            'api_inelasticity': a.get('inelasticity'),
            'demand_curve_id': a.get('market_demand_curve_id'),
            'transfer_model_id': a.get('market_transfer_model_id'),
            'cargo_tonnes_day': intel.get('cargo_tonnes_day'),
            'cargo_yield_per_tkm': intel.get('cargo_yield_per_tkm'),
            'guide_fare': intel.get('guide_fare'),
            'requires': intel.get('requires'),
            'notes': intel['notes'],
        }
    return {'macro': MACRO, 'markets': table,
            'api_full_markets': sorted(api.keys())}


if __name__ == '__main__':
    state = sys.argv[1] if len(sys.argv) > 1 else 'state-turn1.json'
    d = build(state)
    with open('market-demand-model.json', 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)

    print('=' * 96)
    print('SkyChess 市场需求模型  ——  情报报告 × API 交叉核对')
    print('=' * 96)
    hdr = ('市场', '人口', '航段km', 'BH', '人口增长/季', 'GDP增长/季',
           '人口弹性', 'GDP弹性', '弹性id', '转移id', '货运t/日', '货运收益', '特殊要求')
    print(('{:<11}{:>7}{:>8}{:>5}{:>11}{:>11}{:>9}{:>9}{:>7}{:>7}{:>9}{:>9}  {}'
           ).format(*hdr))
    for n, m in d['markets'].items():
        sec = m['sector_length_km'] if m['sector_length_km'] else '-'
        cy = m['cargo_yield_per_tkm'] if m['cargo_yield_per_tkm'] else '-'
        code = m.get('code') or ''
        bh = HUB_BH.get(code, '-')
        print(('{:<11}{:>7}{:>8}{:>5}{:>11}{:>11}{:>9}{:>9}{:>7}{:>7}{:>9}{:>9}  {}'
               ).format(n[:10], m['population'], sec, bh,
                        f"{m['pop_growth_pct_q_report']}%",
                        f"{m['gdp_growth_pct_q_report']}%",
                        m['pop_elasticity_report'], m['gdp_elasticity_report'],
                        m['demand_curve_id'] or '-', m['transfer_model_id'] or '-',
                        m['cargo_tonnes_day'], cy, m['requires'] or ''))

    print()
    print('=== API vs 报告 一致性核对 ===')
    for n, m in d['markets'].items():
        if m['api_population_growth'] is None:
            continue
        f = lambda v: float(v) if v is not None else None
        eq = lambda a, b: f(a) == float(b)
        a_pop = eq(m['api_population_growth'], m['pop_growth_pct_q_report'])
        a_gdp = eq(m['api_gdp_growth'], m['gdp_growth_pct_q_report'])
        a_pe = eq(m['api_population_demand'], m['pop_elasticity_report'])
        a_ge = eq(m['api_gdp_demand'], m['gdp_elasticity_report'])
        print(f"  {n:<12} 人口增长 API={m['api_population_growth']} 报告={m['pop_growth_pct_q_report']} {'OK' if a_pop else 'X'}"
              f" | GDP API={m['api_gdp_growth']} 报告={m['gdp_growth_pct_q_report']} {'OK' if a_gdp else 'X'}")
        print(f"  {'':<12} 人口弹性 API={m['api_population_demand']} 报告={m['pop_elasticity_report']} {'OK' if a_pe else 'X'}"
              f" | GDP弹性 API={m['api_gdp_demand']} 报告={m['gdp_elasticity_report']} {'OK' if a_ge else 'X'}")

    print()
    print('=== 宏观参数 ===')
    for k, v in d['macro'].items():
        if k != 'risks':
            print(f'  {k:34} {v}')
    print('  风险清单:')
    for r in d['macro']['risks']:
        print(f'    - {r}')
    print()
    print(f'已保存 market-demand-model.json  (API 完整市场: {d["api_full_markets"]})')

