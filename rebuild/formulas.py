"""SkyChess 重建 —— 经济公式层。

严格区分三类：
  [KNOWN]    已从 app.js 原文提取并用服务端数据验证
  [DERIVED]  由观测数据反推，形式可信但常数待拟合
  [UNKNOWN]  服务端权威计算，接口预留，等 B 层实验填入

每个公式都标注证据来源。
"""
from dataclasses import dataclass, field
from typing import Callable, Optional

TURNS_PER_YEAR = 4          # [KNOWN] 两个独立公式除以 4 -> 1 回合 = 1 季度


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 1. 时间模型
# ════════════════════════════════════════════════════════════════════
def aircraft_age(acquired_at_age: float, acquired_at_turn: int,
                 current_turn: int) -> float:
    """证据: app.js calculateAircraftAge

        {return e.acquired_at_age+(t-e.acquired_at_turn)/4}

    验证: APT100 acquired_at_age=6, acquired_at_turn=0, turn=1
          -> 6.25，Dashboard 显示 "Age 6.25 years"  ✓
          game.yearsplayed=0.25 @ currentturn=1        ✓
    """
    return acquired_at_age + (current_turn - acquired_at_turn) / TURNS_PER_YEAR


def asset_age(added_at_turn: int, current_turn: int) -> float:
    """证据: app.js calculateAssetAge {return (t-e.added_at_turn)/4}"""
    return (current_turn - added_at_turn) / TURNS_PER_YEAR


def years_played(current_turn: int) -> float:
    """证据: 服务端 game.yearsplayed = 0.25 @ currentturn = 1"""
    return current_turn / TURNS_PER_YEAR


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 2. 融资与折旧
# ════════════════════════════════════════════════════════════════════
def total_finance(total_finance_base: float, total_price: float,
                  spares_pct: float) -> float:
    """证据: app.js calculateAircraftFinance

        {return e.total_finance + e.total_price*(e.spares/100)}

    验证: 34,000,000 + 34,000,000*0.02 = 34,680,000
    """
    return total_finance_base + total_price * (spares_pct / 100.0)


def annual_depreciation(total_price: float, residual_value_pct: float,
                        depreciation_years: int) -> float:
    """[DERIVED] 直线折旧。字段齐全(residual_value/depreciation_years)，
    但前端无此公式 —— 服务端计算。此处为标准实现，等 EXP-06 校准。"""
    residual = total_price * (residual_value_pct / 100.0)
    depreciable = total_price - residual
    return depreciable / depreciation_years if depreciation_years else 0.0


def straight_line_residual(total_price: float, residual_value_pct: float,
                           depreciation_years: int, age: float) -> float:
    """[DERIVED] 折旧后的账面净值"""
    residual = total_price * (residual_value_pct / 100.0)
    book = total_price - annual_depreciation(total_price, residual_value_pct,
                                             depreciation_years) * age
    return max(book, residual)


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 11. 航班日利用小时 (utilization / ADU 分量)
# ════════════════════════════════════════════════════════════════════
# 证据: 官方航线图 "SkyChess_map of routes with additional destinations 2022"
#       表头注明 "BH = Block Hours one way"
#
#   HUB↔ LEW Lewis          415 km  1.00 BH
#   HUB↔ SIM Simone         525 km  1.13 BH
#   HUB↔ FTZ Fitzgerald     784 km  1.44 BH
#   HUB↔ ETN Ellington    1,150 km  2.44 BH
#   HUB↔ PKR Parker       1,620 km  2.44 BH
#   HUB↔ ARM Armstrong   3,780 km  5.04 BH
#   HUB↔ GEE McGee        5,265 km  6.82 BH
#
# API 实测 flight.utilization:
#   APT100 @ Lewis  -> 2.00   = 1.00 x 2  ✓
#   APT100 @ Simone -> 2.26   = 1.13 x 2  ✓
#   APT100 @ Ellington -> 3.76 = 1.88 x 2  (Ellington 观测 BH 1.88, 图上 2.44 为 G160)
#
# 结论: utilization = 2 x (该机型的单程 block hours)，即一个航段来回。
#      图上 BH 为机型基准值，实际按机型调整。

HUB_BLOCK_HOURS = {
    'LEW': 1.00, 'SIM': 1.13, 'FTZ': 1.44,
    'ETN': 1.88, 'PKR': 2.44, 'ARM': 5.04, 'GEE': 6.82,
}
HUB_DISTANCE_KM = {
    'LEW': 415, 'SIM': 525, 'FTZ': 784,
    'ETN': 1150, 'PKR': 1620, 'ARM': 3780, 'GEE': 5265,
}
ETOPS_MARKETS = {'ARM', 'GEE', 'BRZ'}      # 需 ETOPS 运营许可


def utilization_bh(market_code: str) -> float:
    """单程 block hours (来自官方航线图)"""
    return HUB_BLOCK_HOURS[market_code]


def flight_utilization(market_code: str) -> float:
    """[KNOWN] 一个航段的日利用小时 = 2 x 单程 BH

    已用两个独立市场精确验证 (Lewis 2.00 / Simone 2.26)。
    """
    return round(2.0 * HUB_BLOCK_HOURS[market_code], 2)


def distance_km(market_code: str) -> int:
    return HUB_DISTANCE_KM[market_code]


def requires_etops(market_code: str) -> bool:
    return market_code in ETOPS_MARKETS


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 12. 时限与停场
# ════════════════════════════════════════════════════════════════════
# 证据: 冰雹事件报告 "flyte Q3 hailstorm CA.pdf"
#   "Capital Airways' APT100 ... damage to wings, fuselage and engine cowlings.
#    grounded for a period of six weeks.
#    Daily utilisation must therefore be limited to no more than 4 hours
#    per day for the next three months."
#
# 另: 事件报告 "投资了机库的航司免于最严重损坏" -> hangar 提供资产防护

def daily_utilisation_cap(turns_elapsed: int, cap: float = 4.0,
                          months: int = 3) -> float:
    """[KNOWN] 受损机型的每日利用小时上限。

    冰雹后 APT100 被限 4 BH/日，持续 3 个月 = 1 个季度。
    """
    return cap if turns_elapsed < months else float('inf')


def asset_protection(hangar_owned: bool, severity: str) -> float:
    """[DERIVED] 资产防护系数。

    事件报告: "Airlines that have invested in hangars were spared the
    worst of the damage."
    severity: none / moderate / severe
    """
    if hangar_owned:
        return {'none': 0.0, 'moderate': 0.10, 'severe': 0.25}[severity]
    return {'none': 0.0, 'moderate': 0.45, 'severe': 1.00}[severity]


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 3. 燃油对冲
# ════════════════════════════════════════════════════════════════════
def hedge_price(strike_price: float, uplift_pct: float,
                spot_price: float) -> float:
    """证据: app.js calculateHedgePrice

        parseFloat(strike_price*uplift/100 + e*(1-uplift/100)).toFixed(2)

        对冲价 = 行权价 × (uplift/100) + 现货价 × (1 - uplift/100)

    这是按对冲比例线性加权的混合价。uplift 单位为百分比。
    """
    w = uplift_pct / 100.0
    return round(strike_price * w + spot_price * (1.0 - w), 2)


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 4. 油价冲击的 50% 阻尼（裁判侧）
# ════════════════════════════════════════════════════════════════════
def effective_fuel_price(current: Optional[float],
                         new: Optional[float]) -> float:
    """证据: app.js 中裁判注入油价的分支

        return t ? (null != e.fuel_price
                ? ((parseFloat(e.fuel_price)+parseFloat(t))/2).toFixed(2)
                : parseFloat(t,2).toFixed(2))
            : 0

    语义: t = 本回合注入价。若已有现价，新生效价 = (现价 + 新价)/2
          → 价格冲击被阻尼 50%。若无现价则直接取新价。
    """
    if new is None:
        return 0.0
    if current is None:
        return round(float(new), 2)
    return round((float(current) + float(new)) / 2.0, 2)


def fuel_price_schedule(game_prices, market_prices=None) -> list:
    """构建整局油价曲线。

    观测矛盾(待向 SkyChess 确认):
      game.fuel_prices       = [null,null,"2.6","4.5","3.75","2.75","2.7"]
      gamemarket.fuel_prices = [null,null,"2.7","4.5","3.8","2.8","2.75"]
    两层不一致，疑为市场级加价/扰动。此处保留为可配置。
    """
    return list(game_prices if market_prices is None else market_prices)


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 5. 收益
# ════════════════════════════════════════════════════════════════════
def simple_yield(numerator: float, denominator: float) -> float:
    """证据: app.js calculateYield {return e/t}

    注意: 这只是一个比值 helper，不是收益模型本身。
    """
    return numerator / denominator if denominator else 0.0


def profit_or_loss(quarter_profit: float):
    """证据: app.js calculateProfitOfLoss

        {return e.pandl.profitOrLoss>0 ? ["Quarter","Profit",...] : [...]}
    """
    return ('Quarter', 'Profit', quarter_profit) if quarter_profit > 0 \
        else ('Quarter', 'Loss', -quarter_profit)


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 6. 继承式默认值解析
# ════════════════════════════════════════════════════════════════════
def resolve_additional_crew(entity: dict, catalogue_aircraft: dict) -> int:
    """证据: app.js resolveAdditionalCrew

        return null != e.additional_cabin_crew
          ? e.additional_cabin_crew
          : (e.airlineaircraft.aircraft ? e.airlineaircraft.aircraft
                                         .additional_cabin_crew : 0)
    """
    v = entity.get('additional_cabin_crew')
    if v is not None:
        return v
    return catalogue_aircraft.get('additional_cabin_crew', 0) or 0


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 7. 租赁类型互斥
# ════════════════════════════════════════════════════════════════════
LEASE_BH = 1      # 飞行小时(BH)租赁: 用 lease_rate_bh / minimum_bh
LEASE_FIXED = 2   # 计时租赁: 用 lease_rate / effective_funding_rate / quarters


def normalise_lease(lease: dict) -> dict:
    """证据: app.js prepareDataForLeaseType

        1==lease_type && (minimum_bh="", lease_rate_bh="")
        2==lease_type && (lease_rate="", effective_funding_rate="", quarters="")

    两套参数互斥，清空另一套。
    """
    lease = dict(lease)
    if lease.get('lease_type') == LEASE_BH:
        lease['minimum_bh'] = None
        lease['lease_rate_bh'] = None
    elif lease.get('lease_type') == LEASE_FIXED:
        lease['lease_rate'] = None
        lease['effective_funding_rate'] = None
        lease['quarters'] = None
    return lease


# ════════════════════════════════════════════════════════════════════
# [UNKNOWN] 服务端权威计算 —— 预留接口，等 B 层实验填充
# ════════════════════════════════════════════════════════════════════
@dataclass
class DemandModel:
    """市场需求模型。

    已知参数(来自 /play/api/airline/833/scheduler/{turn}):
      size, sector_length, population_growth, gdp_growth,
      population_demand, gdp_demand, k_factor,
      elasticity, inelasticity, unit_p, unit_q,
      market_demand_curve_id=3, market_transfer_model_id=1

    未知:
      - 需求曲线 id=3 的实际数值表（服务端，玩家侧不可见）
      - 转移模型 id=1 的定义（同上）
      - 三者如何合成出 pax

    实验来源:
      EXP-01 运价扫描  -> 估价格弹性
      EXP-02 频次扫描  -> 分离固定/变动成本
      EXP-05 广告投放  -> QSI 与需求的函数关系
    """
    size: float = 145.0
    sector_length: float = 525.0
    population_growth: float = 2.0
    gdp_growth: float = 1.5
    population_demand: float = 1.2
    gdp_demand: float = 1.5
    k_factor: float = 0.45
    elasticity: float = 2.0
    inelasticity: float = 1.0
    unit_p: float = 24.0
    unit_q: float = 0.0
    curve_id: int = 3
    transfer_model_id: int = 1

    # 拟合参数（B 层实验填入）
    demand_coefficient: Optional[float] = None   # EXP-01
    price_elasticity: Optional[float] = None     # EXP-01
    qsi_sensitivity: Optional[float] = None      # EXP-05

    def capacity_demand(self, seats_offered: float, qsi: float = 1.0,
                        fare_ratio: float = 1.0) -> float:
        """[UNKNOWN] 占位实现。

        一个合理但未经验证的形式:
            base = size * (population_demand/100) * (gdp_demand/100)
            qsi_factor = (qsi / 4.5) ** k_factor        # 质量弹性
            price_factor = fare_ratio ** (-elasticity)
            base * qsi_factor * price_factor
        标定: base = 145*0.012*0.015 = 0.0261 —— 量级明显偏小，
        说明真实模型含 demand_curve_id=3 的查表，不能凭空构造。
        """
        base = (self.size
                * (self.population_demand / 100.0)
                * (self.gdp_demand / 100.0))
        qsi_factor = (max(qsi, 1e-6) / 4.5) ** self.k_factor
        price_factor = (max(fare_ratio, 1e-6) ** (-self.elasticity))
        val = base * qsi_factor * price_factor
        if self.demand_coefficient:
            val *= self.demand_coefficient
        return min(val, seats_offered)


@dataclass
class CostModel:
    """成本模型 —— SkyChess 报表的 11 个成本科目。

    观测(Quarter, Q4/2027):
      Fuel Costs                  1,929,780
      Maintenance Costs           1,074,351.6
      Crew Costs                  1,211,042.903
      Handling Costs              1,235,825.065
      Nav and Landing Costs         792,031.336
      Total Indirect Operating    2,357,097
      Total Ownership Costs       2,019,100

    未知: 每一项的分解式。dmc_cycle / dmc_fh 是线索但算法未验证。
    实验来源: EXP-02 斜率=每次飞行的固定成本；EXP-03 分离维护成本构成。
    """
    fuel_burn: float = 1565.0        # APT100 [KNOWN]
    dmc_cycle: float = 220.0         # 周期维护 [KNOWN]
    dmc_fh: float = 260.0            # 飞行小时维护 [KNOWN]
    fuel_price: float = 0.0
    saf_multiplier: float = 0.0
    carbon_price: float = 0.0

    # 拟合参数
    fixed_cost_per_departure: Optional[float] = None   # EXP-02 斜率
    maintenance_per_cycle: Optional[float] = None      # EXP-03
    maintenance_per_fh: Optional[float] = None         # EXP-03
    crew_per_fh: Optional[float] = None                # EXP-03

    def fuel_cost(self, block_hours: float) -> float:
        """[DERIVED] 燃油 = 耗油率 × 飞行小时 × 价格"""
        return self.fuel_burn * block_hours * self.fuel_price


@dataclass
class MetricModel:
    """报表指标 —— ASK / RPK / LF / ADU / QSI / 市占率。

    观测(Q4/2027, Capital Airways):
      Frequencies 900   ASK 94.2 MM   RPK 52.9 MM
      Load Factor 56.1% Passengers 61.9 k   Cargo 586 t
      Route Share 35.91%  QSI 4.50      ADU 14.30 BH

    已验证: ADU = Σ(utilization) 。APT100 2.26 × 3 flights = 6.78
            与 Route Metrics 的 "ADU (BH) 6.78" 完全一致  ✓
    """
    @staticmethod
    def adu(utilizations: list) -> float:
        """[KNOWN] 每次航段的日利用小时之和。已在观测数据上验证。"""
        return round(sum(utilizations), 2)

    @staticmethod
    def ask(seats: float, block_hours: float, days: float = 90.0) -> float:
        """[DERIVED] 可用座公里 (百万)。

        ASK = seats × block_hours × days / 1e6
        90 天 = 一个季度 (3个月)。
        验证: 100座 × 2.26BH × 90 / 1e6 = 0.02034 MM/架/日
              3架 × 3航班 ... 需按频次累积，见 engine
        """
        return seats * block_hours * days / 1e6

    @staticmethod
    def load_factor(rpk: float, ask: float) -> float:
        return rpk / ask if ask else 0.0


# ════════════════════════════════════════════════════════════════════
# 公式注册表 —— 重建时逐个对照补全
# ════════════════════════════════════════════════════════════════════
KNOWN_FORMULAS = [
    ('aircraft_age',        'app.js calculateAircraftAge',   '已验证 x3'),
    ('asset_age',           'app.js calculateAssetAge',      '已验证'),
    ('total_finance',       'app.js calculateAircraftFinance', '已验证'),
    ('hedge_price',         'app.js calculateHedgePrice',    '已验证'),
    ('effective_fuel_price', 'app.js 裁判油价分支',            '已验证'),
    ('simple_yield',        'app.js calculateYield',         '已验证'),
    ('profit_or_loss',      'app.js calculateProfitOfLoss',  '已验证'),
    ('resolve_additional_crew', 'app.js resolveAdditionalCrew', '已验证'),
    ('normalise_lease',     'app.js prepareDataForLeaseType', '已验证'),
    ('adu',                 '报表 ADU 字段',                  '已验证'),
    ('flight_utilization',  '官方航线图 BH 值',               'Lewis/Simone 双验证'),
    ('daily_utilisation_cap','冰雹事件限飞',                  'PDF 直接给出'),
]

UNKNOWN_FORMULAS = [
    # ---- 已被本轮 PDF/观测部分触及 ----
    ('cargo_demand',        '货运需求函数',            '情报报告给了 t/日，但公式未知'),
    ('cargo_revenue',       '货运收入 = 需求x收益x里程','market_cargo_yield 已知'),
    ('fuel_cost',           '燃油成本(含SAF/碳税)',    'EXP-07 跨回合；carbon_price=22 已知'),
    ('ownership_cost',      '持有成本(折旧/保险/利息)', 'EXP-06；Total Ownership 恒为 2,019,100'),
    ('qsi',                 '质量服务指标',            '已观测 4.50 -> -0.20，算法未知'),
    ('market_share',        '市占率分配',              '已观测 35.91% -> 40.92%'),
    ('break_even_load_factor', '盈亏平衡载运率',       '已观测 56% -> 53%'),
    # ---- 完全未触及 ----
    ('passenger_demand',    '客座需求函数',            'EXP-01/02/05；弹性已反推 -0.165'),
    ('passenger_revenue',   '客运收入',                'EXP-01'),
    ('ancillary_revenue',   '辅营收入',                'EXP-05'),
    ('maintenance_cost',    '维护成本',                'EXP-03；dmc_cycle/dmc_fh 已知'),
    ('crew_cost',           '机组成本',                'EXP-03'),
    ('handling_cost',       '地面处理成本',            'EXP-04'),
    ('nav_landing_cost',    '起降与导航成本',          'EXP-04'),
    # ---- 本轮新发现，原清单未覆盖 ----
    ('connecting_demand',   '中转收益',                'game.connecting_demand=2；面板字段已知'),
    ('seasonal_demand',     '季节性需求(Joplin)',      '夏季高峰/深秋-初春暴跌'),
    ('cabin_yield_multiple','舱位收益倍数(Joplin)',    '商务舱约 3x 经济舱'),
    ('esg_gate',            '环保项目门槛(Charles City)', '影响票价 AND 时刻获取'),
    ('event_damage',        '随机事件损害',            '火山/网络攻击/冰雹已各发生一次'),
    ('ransom_mechanic',     '勒索机制',                'attack_ransom=2,000,000；AB 中招'),
]


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 13. 裁判成本参数表 —— turns[].economics（服务端下发）
# ════════════════════════════════════════════════════════════════════
# 证据: /play/api/airline/833 的 airline.turns[].economics
#   这是裁判可配置的成本模型参数，服务端每回合计算时直接使用。
#   2028-10-21 首次在 watch 快照中发现完整字段集。
#
#   变化记录:
#     interest_rate     5.00 -> 4.00   (Q2 起降息, 情报报告称"银行年利率 4%")
#     sh_turnaround     60   -> 45     (Q2 起短航程周转时间缩短)
#     fuel_price        2.60 -> 4.50   (Q3 能源价格冲击兑现)
#     carbon_price      22.00-> 52.00  (Q3 碳价翻倍)

GM_COST_PARAMS = {
    # 飞行员
    'flight_crew_salary':        165_000,   # 固定薪资/季度
    'flight_crew_salary_lh':     195_000,   # 长航程版
    'flight_crew_allowance':     55.0,      # 每 BH 津贴
    'flight_crew_allowance_lh':  75.0,
    'flight_crew_max_bh':        775,       # 每回合飞行员可用 BH 上限
    # 乘务员
    'cabin_crew_salary':         65.0,
    'cabin_crew_salary_lh':      85.0,
    'cabin_crew_allowance':      35.0,
    'cabin_crew_allowance_lh':   50.0,
    # 资产
    'depreciation_years':        15,
    'residual_value':            10.0,      # %
    'insurance_rate':            0.50,      # %
    # 融资
    'interest_rate':             4.00,      # % (Q2 起)
    'interest_years':            12,
    # 运营
    'general_admin':             0.0120,    # 一般管理费率
    'general_admin_lh':          0.0050,
    'cargo_overhead':            0.35,
    # 周转
    'sh_turnaround':             45,        # 分钟 (Q2 起)
    'lh_turnaround':             120,
}

# 已观测到的跨回合变化
GM_PARAM_HISTORY = {
    'interest_rate':    {'Q4/2027': 5.00, 'Q1/2028': 5.00, 'Q2/2028': 4.00, 'Q3/2028': 4.00},
    'sh_turnaround':    {'Q4/2027': 60,   'Q1/2028': 45,   'Q2/2028': 45,   'Q3/2028': 45},
    'fuel_price':       {'Q4/2027': 2.40, 'Q1/2028': 2.50, 'Q2/2028': 2.60, 'Q3/2028': 4.50},
    'carbon_price':     {'Q4/2027': 22.00,'Q1/2028': 22.00,'Q2/2028': 22.00,'Q3/2028': 52.00},
}


def crew_cost(flight_hours: float, long_haul: bool = False,
              cabin_crew: int = 1, cabin_crew_extra: int = 1) -> float:
    """[DERIVED] 机组成本 (按 GM 参数构造)

    飞行员部分为固定薪资 + 每 BH 津贴；乘务员按人数逐项计。
    注意: 服务端实际公式可能含更多项 (待 EXP-03 校准)。
    """
    p = GM_COST_PARAMS
    fc_salary = p['flight_crew_salary_lh'] if long_haul else p['flight_crew_salary']
    fc_allw = p['flight_crew_allowance_lh'] if long_haul else p['flight_crew_allowance']
    cc_salary = p['cabin_crew_salary_lh'] if long_haul else p['cabin_crew_salary']
    cc_allw = p['cabin_crew_allowance_lh'] if long_haul else p['cabin_crew_allowance']

    n_cabin = cabin_crew + cabin_crew_extra
    return (fc_salary
            + fc_allw * flight_hours
            + cc_salary * n_cabin
            + cc_allw * flight_hours)


def general_admin_cost(revenue: float, long_haul: bool = False) -> float:
    """[DERIVED] 一般管理费 = 收入 × 费率"""
    rate = GM_COST_PARAMS['general_admin_lh'] if long_haul \
        else GM_COST_PARAMS['general_admin']
    return revenue * rate


def ownership_cost(total_price: float) -> float:
    """[DERIVED] 单机季度持有成本 = 折旧 + 保险 + 利息

    这是 Q2 报表中 "Total Ownership Costs" 从 2,019,100 跳到 10,374,880
    那一项的构成基础。
    """
    p = GM_COST_PARAMS
    residual = total_price * p['residual_value'] / 100.0
    dep = (total_price - residual) / p['depreciation_years'] / 4      # 折旧按季
    ins = total_price * p['insurance_rate'] / 100.0 / 4
    interest = total_price * p['interest_rate'] / 100.0 / 4
    return dep + ins + interest


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 14. 使用权资产(ROU / 租赁)折旧 —— Q3 报表首次拆分
# ════════════════════════════════════════════════════════════════════
# 证据: Q3/2028 现金流 "Depreciation on Right Of Use Assets: $4,408,615"
#       同时 "Repayments on Right Of Use Assets: -$4,524,000"
#
# 关键认识: Q2 报表该行为 $0 但 Ownership 高达 10,374,880，
#          Q3 拆分后残差从 75.8% 降到 2.0% —— 那 75.8% 就是租赁。
#
#   Q2/2028  自有折旧 1,866,600  ROU 0           利息 644,267  合计 10,374,880
#   Q3/2028  自有折旧   520,200  ROU 4,408,615   利息 172,213  合计  5,203,815
#
# 租赁是刚性支出: 与客流无关，运力利用率下滑时立即反噬利润。

ROU_OBSERVED = {
    'Q2/2028': {'owned_dep': 1_866_600, 'rou_dep': 0, 'interest': 644_267,
                'total_ownership': 10_374_880, 'rou_repayment': 0},
    'Q3/2028': {'owned_dep': 520_200, 'rou_dep': 4_408_615, 'interest': 172_213,
                'total_ownership': 5_203_815, 'rou_repayment': 4_524_000},
}


def ownership_breakdown(quarter: str) -> dict:
    """[KNOWN] 按报表口径拆解持有成本"""
    o = ROU_OBSERVED[quarter]
    residual = o['total_ownership'] - o['owned_dep'] - o['rou_dep'] - o['interest']
    return {
        'quarter': quarter,
        'owned_depreciation': o['owned_dep'],
        'rou_depreciation': o['rou_dep'],
        'interest': o['interest'],
        'residual_assumed_insurance': residual,
        'total': o['total_ownership'],
        'rou_share_pct': (o['rou_dep'] / o['total_ownership'] * 100)
                        if o['total_ownership'] else 0.0,
    }


def lease_annual_cash_outflow(quarter: str) -> float:
    """[KNOWN] 年化租赁现金支出 = (ROU折旧 + 使用权资产还款) × 4"""
    o = ROU_OBSERVED[quarter]
    return (o['rou_dep'] + o['rou_repayment']) * 4


def implied_owned_asset_value(owned_dep: float) -> float:
    """[DERIVED] 由季度折旧反推自有资产账面价"""
    p = GM_COST_PARAMS
    return owned_dep * 4 * p['depreciation_years'] / (1 - p['residual_value'] / 100.0)


def implied_loan_principal(interest_paid: float,
                          rate_pct: float = None) -> float:
    """[DERIVED] 由季度利息反推贷款本金 (利率为年化百分比)"""
    p = GM_COST_PARAMS
    r = rate_pct if rate_pct is not None else p['interest_rate']
    return interest_paid / (r / 100.0) * 4


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 15. SAF / CORSIA 碳抵消支出 —— Q4 现金流首次出现
# ════════════════════════════════════════════════════════════════════
# 证据: Q4/2028 现金流 "SAF project: -$2,000,000" (投资活动)
#
# 情报报告原文依据 (Market Intelligence Report v4):
#   "从 2027 年 1 月起，CORSIA 计划（国际航空碳抵消和减排计划）将强制执行。
#    二氧化碳排放必须通过碳信用和航空以外的排放交易来平衡。
#    您的航空公司已经被纳入 CORSIA 的自愿阶段。航空公司有义务根据飞行量
#    为购买碳信用额度做出贡献。"
#
# 关键观测: Q4 油价其实下降 (4.50 -> 3.75, -16.7%)，
#          但燃油成本却 +92.9% —— 差额几乎全部来自 SAF。

SAF_PROJECT_Q4_2028 = 2_000_000


def fuel_cost_ex_saf(reported_fuel_cost: float) -> float:
    """剔除 SAF 后的实际燃油成本 (用于归因分析)"""
    return reported_fuel_cost - SAF_PROJECT_Q4_2028


def saf_carbon_exposure(flight_hours: float, project_fee: float = None) -> float:
    """[DERIVED] SAF 支出与飞行量的关系。

    情报报告称"根据飞行量为购买碳信用额度做出贡献"，即正比于排放量。
    Q4 观测: SAF = $2,000,000
    需要第二个季度样本才能拟合出 per-BH 系数。
    """
    return project_fee if project_fee is not None else SAF_PROJECT_Q4_2028


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 16. 所得税 —— 营业利润为正时触发
# ════════════════════════════════════════════════════════════════════
# 证据: Q4/2028 现金流 "Taxation: -$1,297,237"
#       Q1~Q3 全部为 $0（尽管 Q1/Q3 营业利润为正）
# 观察: 前三季营业利润为正但税为 0；Q4 营业亏损仍征税 $1,297,237
#       → 征税基准是【上一期/累计】的应税所得，存在 1 季度滞后。
#       这是本机制目前唯一的数据点，税率未知。

TAX_OBSERVED = {
    'Q4/2027': {'operating_profit': None, 'taxation': 0},
    'Q1/2028': {'operating_profit': None, 'taxation': 0},
    'Q2/2028': {'operating_profit': 1_164_881, 'taxation': 0},
    'Q3/2028': {'operating_profit': 4_870_403, 'taxation': 0},
    'Q4/2028': {'operating_profit': -1_393_491, 'taxation': 1_297_237},
}

TAX_RATE_ESTIMATE = None   # 需第二个有税负的季度才能拟合


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 17. 现金流三段结构 (Q4 完整样本)
# ════════════════════════════════════════════════════════════════════
CASHFLOW_Q4_2028 = {
    'brought_forward':        7_241_519,
    'operating_profit':      -1_393_491,
    'depreciation_owned':      520_200,
    'depreciation_rou':      5_883_606,
    'interest_paid':          -164_802,
    'taxation':             -1_297_237,
    'fee_joining_broonzy':     -200_000,
    'operating_total':       3_348_276,
    'saf_project':          -2_000_000,
    'investing_total':      -2_000_000,
    'fuel_hedge_fees':              0,
    'deposit_g160xlr':        -810_000,
    'refund_apt100_deposit':   310_000,
    'rou_repayments':       -6_024_000,
    'loan_repayments':        -748_455,
    'financing_total':      -7_272_455,
    'closing_cash':          1_317_340,
}


def liquidity_pressure(quarter: str = 'Q4/2028') -> dict:
    """[KNOWN] 流动性缺口测算"""
    c = CASHFLOW_Q4_2028
    ocf = c['operating_total']
    fixed = abs(c['rou_repayments']) + abs(c['loan_repayments'])
    return {
        'quarter': quarter,
        'operating_cash_flow': ocf,
        'fixed_debt_service': fixed,
        'gap': ocf - fixed,
        'cash_on_hand': c['closing_cash'],
        'quarters_of_runway': round(c['closing_cash'] / (fixed - ocf), 2)
                           if fixed > ocf else float('inf'),
    }


# ════════════════════════════════════════════════════════════════════
# [KNOWN] 18. 完整损益表结构（Operating Costs Statement，18 明细行）
# ════════════════════════════════════════════════════════════════════
# ★ 修正记录：此前只解析 Costs Summary 的 11 个汇总行，
#   漏掉了 SAF / Carbon 独立成本行，导致口径错误。
#
# 真实结构（Q1/2029 实测，已完全闭合）：
#   Revenue
#     Passenger Revenue                32,295,969
#     Cargo Revenue                     1,803,010
#     Ancillary Revenue                 3,412,980
#     = Total Revenue                  37,511,959
#   − Direct Cash Operating Costs     22,422,374
#       Fuel                             7,834,050
#       Sustainable Aviation Fuel        1,030,860   ← 汇总行里没有！
#       Carbon                             870,503   ← 汇总行里没有！
#       Maintenance                      2,562,098
#       Flight Crew                      2,676,624
#       Cabin Crew                       1,796,112
#       Landing                          1,349,888
#       Navigation                       1,144,667
#       Aircraft Handling                1,566,563
#       Traffic Handling                 1,489,070
#       Cargo Handling                     101,940
#   − Indirect Operating Costs          5,785,785
#       Passenger Services              1,200,010
#       Ticketing, Sales and Promotion    709,190
#       General & Administration        2,856,552
#       Cargo Overheads                 1,020,033
#   − Total Ownership Costs             6,756,306
#       Depreciation on Owned Assets       520,200
#       Depreciation on ROU Assets       5,883,606
#       Wet Lease Payments                      0
#       Insurance                          352,500
#   = Operating Profit                  2,547,494   ← 与现金流 Operating P/L 精确一致
#
# ★ Costs Summary 汇总行到明细行的映射（已验证逐项加总相等）：
#     Fuel Costs        = Fuel                      (不含 SAF/Carbon!)
#     Crew Costs        = Flight Crew + Cabin Crew
#     Handling Costs    = Aircraft + Traffic + Cargo Handling
#     Nav and Landing   = Landing + Navigation
#     Total Indirect    = 上述 4 项
#     Total Ownership   = 上述 4 项

PNL_Q1_2029 = {
    'revenue': {'passenger': 32295969, 'cargo': 1803010, 'ancillary': 3412980,
                'total': 37511959},
    'direct_cash': {'fuel': 7834050, 'saf': 1030860, 'carbon': 870503,
                    'maintenance': 2562098, 'flight_crew': 2676624,
                    'cabin_crew': 1796112, 'landing': 1349888,
                    'navigation': 1144667, 'aircraft_handling': 1566563,
                    'traffic_handling': 1489070, 'cargo_handling': 101940,
                    'total': 22422374},
    'indirect': {'passenger_services': 1200010,
                 'ticketing_sales_promotion': 709190,
                 'general_admin': 2856552, 'cargo_overheads': 1020033,
                 'total': 5785785},
    'ownership': {'depreciation_owned': 520200,
                  'depreciation_rou': 5883606,
                  'wet_lease_payments': 0, 'insurance': 352500,
                  'total': 6756306},
    'operating_profit': 2547494,
    'reported_profit': 2262479,
    'unexplained_residual': 285015,
}

SAF_MANDATE = {
    'announced': '2028-10-01',
    'effective': '2029-01-01',
    'mandate_pct_of_uplift': 5.0,        # 5% 燃油加注量必须为 SAF
    'saf_price_multiple': 2.5,           # SAF 约为常规航油的 2.5 倍
    'source': 'flyte Q4 SAF 新闻稿 (2028-10-01)',
}

# 汇总行 -> 明细行映射（用于从 Costs Summary 反推完整结构）
COSTS_SUMMARY_MAPPING = {
    'Fuel Costs':        ['Fuel'],                       # 注意: 不含 SAF / Carbon
    'Maintenance Costs':  ['Maintenance'],
    'Crew Costs':        ['Flight Crew', 'Cabin Crew'],
    'Handling Costs':    ['Aircraft Handling', 'Traffic Handling', 'Cargo Handling'],
    'Nav and Landing Costs': ['Landing', 'Navigation'],
    'Total Indirect Operating Costs': ['Passenger Services',
                                       'Ticketing, Sales and Promotion',
                                       'General & Administration',
                                       'Cargo Overheads'],
    'Total Ownership Costs': ['Depreciation on Owned Assets',
                              'Depreciation on ROU Assets',
                              'Wet Lease Payments', 'Insurance'],
    # Costs Summary 中【不存在】的行:
    'SAF / Carbon':      ['Sustainable Aviation Fuel', 'Carbon'],
}


def pnl_operating_profit(pnl: dict) -> float:
    """[KNOWN] 经营利润 = 收入 − 直接现金成本 − 间接成本 − 持有成本"""
    return (pnl['revenue']['total'] - pnl['direct_cash']['total']
            - pnl['indirect']['total'] - pnl['ownership']['total'])


def pnl_saf_carbon_exposure(pnl: dict) -> float:
    """[KNOWN] SAF + 碳 的合计暴露（汇总行里看不到的两项）"""
    return pnl['direct_cash']['saf'] + pnl['direct_cash']['carbon']


# ── 完整 P&L 结构（Q1/2029 实测，已 100% 闭合）────────────────
PNL_Q1_2029['finance'] = {
    'profit_loss_asset_sales': 0,
    'interest_receivable': 0,
    'interest_owned_assets': 157318,
    'interest_rou_assets': 127698,
    'net_finance_charges': 285015,
}
PNL_Q1_2029['total_operating_costs'] = 34964465
PNL_Q1_2029['profit_before_tax'] = 2262479
PNL_Q1_2029['taxation'] = 0
PNL_Q1_2029['unexplained_residual'] = 0   # 已闭合
# 报表自身以四舍五入整数展示各行，逐行还原存在约 $1.27 的舍入噪声
# (相对净利润 0.00006%)，属服务端显示精度问题，非缺失科目
PNL_Q1_2029['rounding_noise_tolerance'] = 2.0


def pnl_profit_before_tax(pnl: dict) -> float:
    """[KNOWN] 税前利润 = 经营利润 − 净财务费用"""
    f = pnl.get('finance')
    if f is None:
        return pnl['operating_profit']
    return (pnl['operating_profit'] + f['profit_loss_asset_sales']
            + f['interest_receivable'] - f['interest_owned_assets']
            - f['interest_rou_assets'])


def pnl_net_finance_charges(pnl: dict) -> float:
    """[KNOWN] 净财务费用 = 自有资产利息 + 使用权资产利息"""
    f = pnl.get('finance')
    if not f:
        return 0.0
    return (f['interest_owned_assets'] + f['interest_rou_assets']
            - f['interest_receivable'] - f['profit_loss_asset_sales'])
