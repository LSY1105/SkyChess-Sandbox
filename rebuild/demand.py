"""需求模型 —— SkyChess 乘客需求的行为等价实现（识别修正版 v2）。

★ 修正一：识别逻辑方向性错误（本次最关键的发现）
  观测恒等式： pax = min(D, ASK)，LF = pax / ASK
    → LF < 100%  ⇒  pax < ASK ⇒ min 取的是 D ⇒ **D = pax（精确等式）**
    → LF = 100%  ⇒  pax = ASK ⇒ **D ≥ ASK（仅下界）**
  旧模型恰好用反：拿 3 个 LF=100% 的行当等式锁定 K_market，
  而把 31 个 LF<100% 的行（真正含信息量的等式）当作"供给受限"直接丢弃。

  后果评估：
    · 旧口径下"复盘总误差 −4.16%"是**同义反复**——
      model_rev = a·fare·min(D, pax) 对比 a·fare·pax，
      只有模型低估 D 的行才非零。它衡量的是"模型有没有在某些行崩掉"，
      而不是"模型准不准"。
    · 真正的检验是**等式行上 D 的预测误差**。

★ 修正二：QSI 在现有可观测集上不可识别
  报告中的 QSI 是**季度级**变量（Q1/2028 全部市场同为 −0.20，
  疑与当季事件相关），且其与隐含需求的关系跨市场/跨季**非单调**。
  网格搜索（等式行 log-RMS）：
      D = K_m × price_f                      38.77%
      D = K_m × price_f × qsi_f(QSI)         58.30%   ← 更差
      D = K_m × price_f × freq^.5            34.26%   ★ 最优
      D = K_m × price_f × freq^.5 × qsi_f    35.22%   ← 仍更差
  ⇒ 结论：**报告列的 QSI 不应直接进入需求函数**。
  机理上更自洽的解释是：QSI 的需求效应是**经由班次频率中介**的
  （服务品质高的航司自然排更多班次 → 频次上移 → 需求上移），
  而非一个独立乘子。

★ 修正三：服务频率是真实的需求驱动项
  D ∝ freq^b，最优 b = 0.50（次线性：班次翻倍，需求约 +41%）。
  与"网络服务质量随频次提升"的运力-需求机理一致。

★ 修正四：运价回合内变更造成测量误差（不可消除）
  执行运价由 revenue/(a·pax) 反解，是**旅客加权均价**。
  回合内改价时它与"需求形成时面对的价格"不一致：
    · 价格中途下调 → 反解价偏低 → 模型按低价算需求 → 高估（Simone Q2/2029 +69.9%）
    · 价格中途上调 → 反解价偏高 → 模型按高价算需求 → 低估（Lewis Q1/2028 −21.4%）
  31 个等式行里有 10 行偏差 >8%；剔除后 log-RMS 从 34.26% 降到 26.69%。

★ 仍不可识别的部分
  价格弹性：全局只有 3 个 LF=100% 观测且分属 3 个不同市场 →
  K_market 与 |ε| 在每个市场内共线，无法分离。
  ⇒ ε 直接采用逆向得到的 API 弹性值
    elasticity_resolved = −(1 + 0.05 × elasticity)
      Lewis / Simone / Armstrong / Joplin = 1.10
      Fitzgerald / Ellington / Broonzy     = 1.05
"""

FARE_REF = 200.0
FREQ_REF = 100.0
FREQ_EXP = 0.50

# 各市场需求基量 K
#   等式行（LF<100%）反解的几何均值（对乘性误差稳健）
#   + LF=100% 行给出的硬下界 K ≥ ASK/(price_f·freq^b)（取 max）
DEMAND_K = {
    'Armstrong':   68,505,   # 受下界约束抬升
    'Broonzy':   26,953,
    'Joplin':   12,999,   # 受下界约束抬升
    'Ellington':   11,603,
    'Simone':    9,868,
    'Lewis':    7,555,   # 受下界约束抬升
    'Fitzgerald':    5,951,
}

# 各市场价格弹性（API 逆向值 elasticity_resolved 的绝对值）
ELASTICITY = {
    'Lewis': 1.10, 'Simone': 1.10, 'Fitzgerald': 1.05, 'Ellington': 1.05,
    'Armstrong': 1.10, 'Joplin': 1.10, 'Broonzy': 1.05,
}


def price_factor(fare: float, eps: float) -> float:
    """价格对需求的抑制系数"""
    return (FARE_REF / max(fare, 1e-6)) ** eps


def freq_factor(freq: float) -> float:
    """服务频次对需求的放大系数（次线性，最优指数 0.50）"""
    return (max(freq, 1.0) / FREQ_REF) ** FREQ_EXP


def demand(market: str, fare: float, freq: float, mult: float = 1.0) -> float:
    """[D-01] 该市场在某运价/班次下的潜在需求（人/季）

    freq —— 该航线当季**总班次**（不是每日班次）：
             真实报表的 Frequencies 列即为季度总班次（典型 180/360/540）
    """
    K = DEMAND_K.get(market)
    eps = ELASTICITY.get(market, 1.05)
    if K is None:
        raise KeyError(market)
    return K * price_factor(fare, eps) * freq_factor(freq) * mult


def served_pax(market: str, fare: float, freq: float, ask_seats: float,
                mult: float = 1.0) -> float:
    """[D-02] 实际承运旅客 = min(供给, 需求)"""
    return min(ask_seats, demand(market, fare, freq, mult))


def implied_fare(passenger_revenue: float, pax: int, a: float = 0.926228) -> float:
    """[D-03] 由客运收入反解当季实际执行运价

    客运收入 = a × 运价 × 旅客  (a 由 F-01 回归得到, 佣金率 7.38%)
    ⚠ 反解价是**旅客加权均价**：回合内改价时与"需求形成时面对的价格"不一致。
    """
    return passenger_revenue / (a * max(pax, 1))


def max_demand_at_fare(market: str, freq: float, target_pax: int) -> float:
    """[D-04] 求能承运 target_pax 名旅客的最高运价（营收最大化用）"""
    eps = ELASTICITY.get(market, 1.05)
    K = DEMAND_K[market]
    qf = freq_factor(freq)
    # demand(fare) = target_pax  =>  fare = FARE_REF * (K*qf/target_pax)^(1/eps)
    return FARE_REF * (K * qf / max(target_pax, 1e-9)) ** (1.0 / eps)


def revenue_at_fare(market: str, fare: float, freq: float,
                     ask_seats: float, a: float = 0.926228) -> dict:
    """[D-05] 给定运价与班次，预测客运收入与客座率"""
    D = demand(market, fare, freq)
    pax = min(ask_seats, D)
    return {
        'fare': fare,
        'freq': freq,
        'demand': D,
        'served_pax': pax,
        'load_factor': pax / ask_seats if ask_seats else 0.0,
        'passenger_revenue': a * fare * pax,
    }


if __name__ == '__main__':
    print('=' * 78)
    print('需求模型自检（v2 识别修正版）')
    print('=' * 78)
    print()
    print('  等式锁定样本 (LF=100% ⇒ 下界 D>=ASK)：')
    for m, q, fare, freq, qsi, ask in [
            ('Armstrong', 'Q3/2028', 696.28, 180, 7.70, 23200),
            ('Joplin',    'Q4/2028', 194.34, 360, 8.65, 18000),
            ('Lewis',     'Q2/2029',  76.59, 360, 11.85, 41200)]:
        D = demand(m, fare, freq)
        print(f'    {m:11} {q:9} 模型D={D:>9,.0f}  ASK={ask:>9,}  '
              f'{"满足 D>=ASK" if D >= ask else "违反!"}')
    print()
    print('  敏感性示例 (Lewis, freq=360)：')
    for f in (60, 80, 100, 120, 150):
        r = revenue_at_fare('Lewis', f, 360, ask_seats=41200)
        print(f'    运价 ${f:>4}  需求 {r["demand"]:>8,.0f}  客座率 {r["load_factor"]*100:5.1f}%  '
              f'客运收入 ${r["passenger_revenue"]:>12,.0f}')
    print()
    print('  频次敏感性示例 (Lewis, fare=$90)：')
    for fq in (90, 180, 360, 540, 720):
        r = revenue_at_fare('Lewis', 90, fq, ask_seats=fq * 129.7)
        print(f'    班次 {fq:>4}  需求 {r["demand"]:>8,.0f}  客座率 {r["load_factor"]*100:5.1f}%')
