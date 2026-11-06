# SkyChess 重建工程

从 2026-10-21 捕获的真实数据出发，逐步重建 SkyChess 航空经营模拟的完整系统。

**证据基线**：`ev_6e72b73ca6ec127b0a4e6f4ad261fcf2bf8ac016737d80ecfc7db9ba92dc8aef`

---

## 当前状态

```
[KNOWN]    已从 app.js 原文提取并用服务端数据验证   →  已实现，全部回归测试通过
[DERIVED]  由观测数据反推，形式可信常数待拟合      →  已实现，待实验标定
[UNKNOWN]  服务端权威计算，接口已预留             →  等待 B 层实验填充
```

---

## 已实现（KNOWN，5/5 回归测试 PASS）

| 公式 | 实现 | 验证证据 |
|---|---|---|
| `aircraft_age` | `formulas.py` | APT100 `6 + 1/4 = 6.25` = Dashboard「Age 6.25 years」 |
| `asset_age` | `formulas.py` | 与 aircraft_age 同构 |
| `years_played` | `formulas.py` | `game.yearsplayed = 0.25 @ turn=1` |
| `total_finance` | `formulas.py` | `34,000,000 + 34,000,000×2% = 34,680,000` |
| `hedge_price` | `formulas.py` | `strike×w + spot×(1−w)` |
| `effective_fuel_price` | `formulas.py` | `(2.6+4.5)/2 = 3.55` — 裁判油价 50% 阻尼 |
| `profit_or_loss` | `formulas.py` | 符号分支 |
| `resolve_additional_crew` | `formulas.py` | 继承链 |
| `normalise_lease` | `formulas.py` | 两套租赁参数互斥 |
| `ADU` | `MetricModel` | `2.26 × 3 = 6.78` = 报表「ADU (BH) 6.78」 |

---

## ★ 本轮新解出的公式（DERIVED）

服务端在 `turn_market` 表中直接输出了解析后的需求弹性。经 **20 组样本全部验证**：

```python
elasticity_resolved   = -(1 + 0.05 * elasticity)     # e=1 -> -1.05, e=2 -> -1.10
inelasticity_resolved = -(0.6 * inelasticity - 0.3)  # i=1 -> -0.30, i=2 -> -0.90
```

这是需求模型的入口参数。**注意：只有 2 个取值点，需实验补证线性关系。**

---

## ★ 三层油价结构（新发现）

```
game.fuel_prices        [null, null, "2.6", "4.5", "3.75", "2.75", "2.7"]   裁判预设曲线
turn.economics.fuel_price   2.40 (t0) / 2.50 (t1)                          回合级生效价
turn_market.fuel_price      t0: {2.8}                                      市场级冲击价
                            t1: {2.5, 2.55, 2.6, 2.65, 2.8, 3.1, 3.2}
```

**第 2 回合出现 7 个不同市场级油价** —— 油价冲击是**按市场独立施加**的，
且随回合推进分化。这解释了之前发现的「游戏级 vs 市场级不一致」。

`carbon_price` 每回合恒为 `22.00`。

---

## 数据模式（从 ERD 反推，16 条外键）

```python
Game        6 回合表 / economics / markets
  └ Airline      starting_cash, attack_ransom, fuelhedges
      ├ AirlineAircraft   nickname, total_price, spares, acquired_at_turn/age
      │   └ Aircraft      fuel_burn, dmc_cycle, dmc_fh, payload_range_id
      ├ AirlineTurnMarket fare + 各类 fee + peak_* + business/premium_modifier
      └ ScheduleEntry → Flight(utilization, turnaround, departure)

TurnEconomics   fuel_price, carbon_price
TurnMarket      elasticity_resolved, inelasticity_resolved, fuel_price
```

---

## 目录结构

```
rebuild/
  formulas.py         公式层（KNOWN/DERIVED/UNKNOWN 三级标注）
  schema.py           数据模式层 + load_from_baseline()
  data/
    state-baseline.json   真实捕获数据（唯一数据源）
  README.md          本文件

experiments/
  DESIGN.md          B 层单变量实验设计（7 个实验）
  lab.py             实验工具：log / report / collect / fit
  ledger.json        实验记录
  report-open.json   20 个报表区块解析结果
```

---

## 快速验证

```bash
cd rebuild
python -c "
import sys; sys.path.insert(0,'.')
import schema, formulas
w = schema.load_from_baseline()
print(w['game'].title, len(w['game'].turns), '回合')
print(w['airline'].name, f\"{w['airline'].starting_cash:,}\")
"
```

---

## 待补全（14 项 UNKNOWN）

| 公式 | 实验来源 |
|---|---|
| `passenger_demand` | EXP-01 / 02 / 05 |
| `cargo_demand` | EXP-02 |
| `passenger_revenue` | EXP-01 |
| `cargo_revenue` | EXP-02 |
| `ancillary_revenue` | EXP-05 |
| `fuel_cost`（含 SAF / 碳税） | EXP-07 跨回合 |
| `maintenance_cost` | EXP-03 |
| `crew_cost` | EXP-03 |
| `handling_cost` | EXP-04 |
| `nav_landing_cost` | EXP-04 |
| `ownership_cost`（折旧/保险/利息） | EXP-06 |
| `qsi` | EXP-05 |
| `break_even_load_factor` | EXP-06 |
| `market_share` | EXP-07 |

---

## 架构结论（可写入作业）

> SkyChess 是 **PHP/Laravel + Eloquent + MySQL** 服务端，
> 配 **Vue + webpack** 前端。财务计算**全部服务端权威**，
> 客户端仅实现 10 个派生值（其中 7 个为经济公式）。
>
> 需求模型的关键参数（`elasticity` / `inelasticity`）以**市场主数据**形式存在，
> 服务端在每回合用固定线性式（`-(1+0.05e)` / `-(0.6i−0.3)`）解析为实际弹性，
> 但**需求曲线的数值表（`market_demand_curve_id=3`）与转移模型（`id=1`）
> 从不下发给客户端** —— 这是服务端权威设计的核心体现。

---

## 使用边界

本工程为**教学性重建**，用于理解游戏机制与经济模型。

- 不包含 SkyChess 的任何美术/品牌资产
- 不用于绕过订阅或授权校验
- 实验仅在**你自己的对局**中修改**你自己航司**的参数
- 不触碰 `/admin/api/*` 裁判端点
---

# 附录 D：2028-07 增补（事件系统 / 航线图 / Q3 新市场）

## 1. 航班日利用小时公式 —— 已确认 [KNOWN]

官方航线图 `SkyChess_map of routes with additional destinations 2022` 表头注明
`BH = Block Hours one way`。经两个独立市场精确验证：

```
utilization = 2 × 单程 BH
  Lewis   1.00 × 2 = 2.00   ← API 实测 2.00  ✓
  Simone  1.13 × 2 = 2.26   ← API 实测 2.26  ✓
```

| 市场 | 代码 | 距离 km | 单程 BH | ETOPS |
|---|---|---|---|---|
| Lewis | LEW | 415 | 1.00 | ✓ |
| Simone | SIM | 525 | 1.13 | |
| Fitzgerald | FTZ | 784 | 1.44 | |
| Ellington | ETN | 1150 | 1.88 | |
| Parker | PKR | 1620 | 2.44 | |
| Armstrong | ARM | 3780 | 5.04 | ✓ |
| McGee | GEE | 5265 | 6.82 | ✓ |

## 2. 事件系统 [已实现 `events.py`]

情报报告预警的风险 **全部兑现**，机制可量化：

| 事件 | 季度 | 对象 | 量化后果 |
|---|---|---|---|
| 火山爆发 | Q2 | Ellington 市场 | 需求受损 **3 个月**，全部承运人受影响 |
| 网络攻击 | Q2 | Air Ballistic (AB) | 收益管理系统沦陷 → **被勒索**（对应 `attack_ransom=2,000,000`）|
| **冰雹** | **Q3** | **CA:APT100** | **停飞 6 周；3 个月内每日利用上限 4 BH** |

**资产防护机制**：新闻原文「投资了机库的航司免于最严重损坏」
→ `Hangar single aisle $1,935,000` 具备明确定向防御价值。

## 3. Q3 新增 3 个市场（总数达 10）

| 市场 | 人口 | 人口增长/季 | GDP增长/季 | 人口弹性 | GDP弹性 | 指导价(RT) | 货运t/日 | 收益/t-km | 特殊机制 |
|---|---|---|---|---|---|---|---|---|---|
| **Joplin** | 1,500 | 1% | **4%** | **0.2%** | 1.7% | $170 | **40** | 0.15 | **季节性**（夏季高峰）；**商务舱 3× 经济舱** |
| **Charles City** | 27,000 | **3%** | 3% | **1.5%** | 1.5% | $220 | 20 | **0.60** | **ESG 门槛**（环保项目影响票价**和时刻获取**）|
| **Broonzy** | 28,000 | 2% | 3% | 1.2% | 1.5% | $700 | 30 | 0.40 | **需 ETOPS** |

**三个新机制**：季节性需求 / 舱位收益倍数 / ESG 门槛。

## 4. EXP-01 首个价格弹性估计

Simone 航线：运价 +20.8% 且运力 -33.3% 的双重冲击下，旅客仅 -3.1%

```
ε = ln(28.4/29.3) / ln(145/120) = -0.1649   →  |ε| ≈ 0.165
```

⚠ **方法论警告**：同回合内 Simone 提价与 Ellington 降价在总量上互相抵消
（指数 185 → 182.5），**聚合拟合会得出"收入与价格无关"的错误结论**。
必须分航线分析。

## 5. 当前状态

```
KNOWN  12 个公式   9/9 回归测试 PASS
UNKNOWN 20 个公式  其中 6 个已被本轮观测部分触及
市场   10 个       需求参数完整（情报报告 × API 交叉验证）
事件    3 个       全部来自官方新闻稿
```

### ⚠ Q3 首要约束
```
APT100 被限飞: 每日利用 ≤ 4 BH，持续 3 个月
```
冰雹前 APT100 日利用已达 3.76 BH（Ellington），**已逼近上限**，
无法再增加航段。运力须由 G160 承担。
