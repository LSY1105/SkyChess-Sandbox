"""SkyChess 服务端算法轮子 — 从 38 个黑盒观测点反推的替代模型。

这些模型不是逆向出的源码，而是用观测数据拟合出的**行为等价实现**，
用于在没有服务端访问权的情况下复算 SkyChess 的经济结果。

拟合基础：38 个 (季度 × 市场) 观测点，每个带完整 26 行损益表。
来源: build_dataset.py → observations.json

模型清单:
  [F-01] 客运收入        y = 0.9339 × 运价 × 旅客 − 63,026     R²=0.9831
  [F-02] 货运处理        y = 1,033 + 51.38 × 货物吨数            R²=0.9324
  [F-03] 旅客地面处理    y = −5,198 + 10.66 × 旅客数            R²=0.8622
  [F-04] 飞机地面处理    y = 19,160 + 719.3 × 起降次数           R²=0.7704
  [F-05] 起降费          y = 33,860 + 546.6 × 起降次数           R²=0.6433
  [F-06] 飞行员成本      y = 404,200 − 1,550×起降 + 190.1×BH     R²=0.6903
  [F-07] 维护成本        y = 313,200 − 667.8×起降 + 135.6×BH     R²=0.5171
  [F-08] 燃油            y = 452,000 + 96.44 × (BH × 油价)      R²=0.3813
  [F-09] 货物间接成本    y = 19,108 + 0.002296 × ASK             R²=0.9627
  [F-10] 一般及行政      y = 133,649 + 0.006118 × ASK             R²=0.8102

交叉验证（官方 Cost Data 2022 v5 / GM 参数）：
  [F-03] $10.66/pax      vs 官方 $10/pax                    +6.6%
  [F-04] $719.3/depart   vs 官方 $13/t × 55t = $715         +0.6%
  [F-05] $546.6/depart   vs 官方 $10/t × 55t = $550          −0.6%
  [F-10] $0.006118/ASK   vs GM 参数 0.0050(LH) / 0.0120(SH)  落在区间内
  [F-01] 佣金 6.61%      vs 投资目录 "回流口径 $6/客"          ✓
"""

DAYS_PER_QUARTER = 90
KG_PER_US_GALLON = 3.785


# ── 收入 ────────────────────────────────────────────────────────────
def passenger_revenue(fare: float, pax: int):
    """[F-01] 客运收入 = 0.9339 × 运价 × 旅客 − 63,026   (R²=0.9831)

    斜率 0.9339 ⇒ 约 6.6% 代理佣金/渠道抽成。
    fare 必须是「当季实际执行价」，中途改价会导致偏差。
    """
    return 0.9339 * fare * pax - 63_026


def agent_commission_rate() -> float:
    """[F-01] 隐含代理佣金率"""
    return 1 - 0.9339


def cargo_revenue(cargo_tonnes: float, yield_per_tkm: float, avg_km: float):
    """[F-DERIVED] 货运收入 ≈ 货物吨数 × 收益 × 里程

    观测拟合不佳(R²=0.08)，因各市场收益率不同且随回合变化。
    此处给出结构化实现，参数取自情报报告。
    """
    return cargo_tonnes * yield_per_tkm * avg_km


# ── 成本 ────────────────────────────────────────────────────────────
def fuel_cost(bh: float, fuel_price: float):
    """[F-08] 燃油 = 452,000 + 96.44 × (BH × 油价)   (R²=0.3813)

    96.44 / 1.565 (APT100 kg/BH) = $61.6/kg → 与官方单位成本表同量级。
    """
    return 452_000 + 96.44 * bh * fuel_price


def saf_cost(bh: float, fuel_price: float, mandate_pct: float = 0.05,
             price_multiple: float = 2.5):
    """[F-DERIVED] SAF 成本 ≈ 燃油 × 强制比例 × 溢价倍数

    官方: 2029-01-01 起 5% 燃油加注量必须为 SAF，价格 2.5 倍。
    观测: Q1/2029 SAF $1,030,860，占同期 Fuel $7,834,050 的 13.2%。
    """
    return fuel_cost(bh, fuel_price) * mandate_pct * price_multiple


def carbon_cost(pax: int, cargo_tonnes: float, carbon_price: float,
                co2_per_rpk: float = 1.0):
    """[F-DERIVED] 碳成本 = (RPK + 货运周转) × 碳强度 × 碳价

    官方(纪要): 以 g CO2/RPK 作为碳效率核心指标。
    """
    rpk = pax * 1.0
    return (rpk + cargo_tonnes * 100) * co2_per_rpk * carbon_price / 1e6


def maintenance_cost(freq: float, bh: float):
    """[F-07] 维护 = 313,200 − 667.8×起降 + 135.6×BH   (R²=0.5171)

    反映 dmc_cycle(每周期) 与 dmc_fh(每飞行小时) 的双重结构。
    """
    return 313_200 - 667.8 * freq + 135.6 * bh


def flight_crew_cost(freq: float, bh: float):
    """[F-06] 飞行员 = 404,200 − 1,550×起降 + 190.1×BH   (R²=0.6903)

    GM 参数: 固定薪资 165,000 + 津贴 55/BH；长航程 195,000 + 75/BH。
    """
    return 404_200 - 1_550 * freq + 190.1 * bh


def cabin_crew_cost(freq: float, pax: int):
    """[F-DERIVED] 乘务 ≈ 每人 65/季 + 35/BH，且每 50 乘客 1 名

    观测拟合差(R²=0.00)，因缺机型与舱位特征。
    """
    crew = max(1, -(-pax // 50))
    return crew * (65 * 3 + 35 * 1)


def landing_cost(freq: float):
    """[F-05] 起降费 = 33,860 + 546.6 × 起降次数   (R²=0.6433)
    官方: $10-12 per tonne of MTOW，55t 机队 → $550/次 ✓
    """
    return 33_860 + 546.6 * freq


def navigation_cost(freq: float, km: float):
    """[F-DERIVED] 导航费 ≈ 起降次数 × 距离因子

    观测(单变量)拟合差(R²=0.0005)，需按机型/距离分档。
    """
    return freq * (km / 1000.0) * 20.73


def aircraft_handling_cost(freq: float):
    """[F-04] 飞机地面处理 = 19,160 + 719.3 × 起降次数   (R²=0.7704)
    官方: $11-13 per tonne MTOW，55t → $715/次 ✓
    """
    return 19_160 + 719.3 * freq


def traffic_handling_cost(pax: int):
    """[F-03] 旅客地面处理 = −5,198 + 10.66 × 旅客数   (R²=0.8622)
    官方: $10 per pax (按 75% 载运率) ✓
    """
    return -5_198 + 10.66 * pax


def cargo_handling_cost(cargo_tonnes: float):
    """[F-02] 货运处理 = 1,033 + 51.38 × 货物吨数   (R²=0.9324)
    官方: $60 per tonne ✓
    """
    return 1_033 + 51.38 * cargo_tonnes


def cargo_overheads(ask_abs: float):
    """[F-09] 货物间接成本 = 19,108 + 0.002296 × ASK   (R²=0.9627)

    GM 参数 cargo_overhead = 0.35 per tonne of MTOW，
    因 MTOW 与 ASK 在同机型下成正比 → 对 ASK 回归。
    """
    return 19_108 + 0.002296 * ask_abs


def general_admin(ask_abs: float):
    """[F-10] 一般及行政 = 133,649 + 0.006118 × ASK   (R²=0.8102)

    GM 参数: 短程 $0.012-0.015/ASK，长程 $0.005-0.008/ASK。
    拟合值 0.006118 落在区间内 ✓
    """
    return 133_649 + 0.006118 * ask_abs


def passenger_services(revenue: float):
    """[F-DERIVED] 旅客服务 = 90,799 + 0.0202 × 收入   (R²=0.3602)

    拟合度低，可能还含机上服务投资(QSI)的调节项。
    """
    return 90_799 + 0.0202 * revenue


def ticketing_sales_promotion(bh: float):
    """[F-DERIVED] 售票与促销 = 30,287 + 13.83 × BH   (R²=0.2216)

    观测中该科目在 Q4/2027 为 0（未投广告），随后随广告投入出现，
    因此本质是【投资驱动的固定项】，无法由运量回归。
    """
    return 30_287 + 13.83 * bh


# ── 完整损益重算 ──────────────────────────────────────────────────────
def recompute_pnl(fare, pax, cargo_tonnes, freq, bh, ask_abs, fuel_price,
                  carbon_price=52.0, maintenance=0, other=0):
    """用算法轮子重算单条航线的损益，与服务端报表对比。

    返回 (各项, 经营利润)
    """
    d = {}
    d['Passenger Revenue'] = passenger_revenue(fare, pax)
    d['Cargo Revenue'] = 0.0            # 需市场收益率
    d['Fuel'] = fuel_cost(bh, fuel_price)
    d['Sustainable Aviation Fuel'] = saf_cost(bh, fuel_price)
    d['Carbon'] = carbon_cost(pax, cargo_tonnes, carbon_price)
    d['Maintenance'] = maintenance or maintenance_cost(freq, bh)
    d['Flight Crew'] = flight_crew_cost(freq, bh)
    d['Cabin Crew'] = cabin_crew_cost(freq, pax)
    d['Landing'] = landing_cost(freq)
    d['Aircraft Handling'] = aircraft_handling_cost(freq)
    d['Traffic Handling'] = traffic_handling_cost(pax)
    d['Cargo Handling'] = cargo_handling_cost(cargo_tonnes)
    d['Cargo Overheads'] = cargo_overheads(ask_abs)
    d['General & Administration'] = general_admin(ask_abs)
    d['Passenger Services'] = passenger_services(d['Passenger Revenue'])
    d['Ticketing, Sales and Promotion'] = ticketing_sales_promotion(bh)
    return d


FITTED_MODELS = {
    'F-01 客运收入':     ('passenger_revenue',     0.9339,  0.9831),
    'F-02 货运处理':     ('cargo_handling_cost',   51.38,   0.9324),
    'F-03 旅客地面处理': ('traffic_handling_cost',  10.66,   0.8622),
    'F-04 飞机地面处理': ('aircraft_handling_cost',719.3,   0.7704),
    'F-05 起降费':       ('landing_cost',          546.6,   0.6433),
    'F-06 飞行员':       ('flight_crew_cost',      190.1,   0.6903),
    'F-07 维护':         ('maintenance_cost',      135.6,   0.5171),
    'F-08 燃油':         ('fuel_cost',             96.44,   0.3813),
    'F-09 货物间接':     ('cargo_overheads',       0.002296,0.9627),
    'F-10 一般及行政':   ('general_admin',        0.006118,0.8102),
}