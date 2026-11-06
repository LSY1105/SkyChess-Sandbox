# SkyChess Airline — REA 逆向分析报告（第二版 · 增补）

本文件是 `SkyChess-REA分析报告.md` 的**增补**，新增领域模型、经济公式与追踪结果。

---

## 8. 航空公司经营模型 — 领域字段（209 个蛇形字段，静态提取）

完整清单见 `econ-model.txt`。核心分组：

### 8.1 机龄与折旧
| 字段 | 出现 | 含义 |
|---|---|---|
| `depreciation_years` | 14 | 折旧年限 |
| `residual_value` | 12 | 残值 |
| `annual_depreciation` / `total_depreciation` / `years_depreciated` | 2 | 折旧计算结果 |
| `acquired_at_age` / `acquired_at_turn` | — | 购入时机龄 / 回合 |
| `added_at_turn` / `sold_at_turn` | — | 资产加入 / 出售回合 |

### 8.2 租赁（两套互斥模式）
| 字段 | 含义 |
|---|---|
| `lease_type` | 1 = 计时租赁，2 = 飞行小时(BH)租赁 |
| `lease_rate` / `effective_funding_rate` / `quarters` | 计时租赁参数 |
| `lease_rate_bh` / `minimum_bh` | BH 租赁参数 |
| `leased_at_turn` / `leased_to_turn` / `available_from_turn` | 租期边界 |
| `salb_lease_type` / `salb_lease_rate` / `salb_leased_to_turn` | **售后回租 (sale-and-leaseback)** |

### 8.3 机型容量
`seats_standard` / `seats_business` / `seats_premium`（三舱等）、`cargo_capacity`、
`structural_payload` / `maximum_cargo_payload` / `payload_range_id` / `pax_range`、
`minimum_bh` / `max_bh` / `flight_crew_max_bh` / `additional_cabin_crew`、
`cargo_pallets` / `cargo_containers` / `container_cargo_volume_sh|_lh`

### 8.4 成本
`fuel_burn` / `fuel_price` / `fuel_density` / `saf_fuel_price_multiplier` / `carbon_price`、
`landing_fee` / `handling_fee` / `traffic_handling_fee` / `cargo_handling_fee` / `joining_fee`、
`cost_pax` / `business_cost_pax` / `premium_cost_pax` / `cost_ac` / `cost_annual`

### 8.5 需求与收益
`connecting_demand` / `population_demand` / `gdp_demand` / `market_cargo_demand` /
`market_cargo_yield` / `market_demand_curve_id` / `peak_pricing` / `peak_revenue` /
`average_load_factor` / `average_load` / `fare_lock_active` / `sector_length`

### 8.6 回合与时刻表
`from_turn` / `to_turn` / `max_turns` / `invested_turn` / `postpone_turns`、
`minutes_remaining` / `open_minutes` / `run_for_minutes` / `sh_turnaround` / `lh_turnaround`、
`departures_per_board` / `total_departures` / `bypass_slot_check`

---

## 9. ★ 前端内的真实计算公式（直接从 bundle 提取）

> 这是本次分析最有价值的产物。以下代码为 `app.js` 原文，未改写。

### 9.1 时间基准：**1 回合 = 0.25 年（季度）**
```js
calculateAircraftAge(e, t) { return e.acquired_at_age + (t - e.acquired_at_turn) / 4 }
calculateAssetAge(e, t)    { return (t - e.added_at_turn) / 4 }
```
两个独立公式都除以 4，**互相印证**回合 = 季度。

### 9.2 燃油对冲混合定价
```js
calculateHedgePrice(e) {
  return parseFloat(
      this.currentHedge.strike_price * this.currentHedge.uplift / 100
    + e * (1 - this.currentHedge.uplift / 100)
  ).toFixed(2)
}
```
```
对冲价 = 行权价 × (uplift/100) + 现货价 × (1 − uplift/100)
```
`uplift` 为对冲覆盖比例（%），按比例线性加权。

### 9.3 飞机融资总额（备件按百分比加价）
```js
calculateAircraftFinance(e) { return e.total_finance + e.total_price * (e.spares / 100) }
```

### 9.4 收益与盈亏
```js
calculateYield(e, t) { return e / t }
calculateProfitOfLoss() { /* 读 pandl.profitOrLoss，>0 为 Quarter Profit，否则 Quarter Loss */ }
```

### 9.5 ★ 裁判侧油价冲击 —— 50% 传导（缓冲机制）
```js
return t ? (null != e.fuel_price
        ? ((parseFloat(e.fuel_price) + parseFloat(t)) / 2).toFixed(2)   // 与新价取均值
        : parseFloat(t, 2).toFixed(2))
    : 0
```
裁判在回合中注入油价 `t` 时，**生效油价 = (当前价 + 新价) / 2**，
即价格冲击被**阻尼 50%**，不会一步到位。

### 9.6 继承式默认值解析
```js
resolveAdditionalCrew(e) {
  return null != e.additional_cabin_crew
    ? e.additional_cabin_crew
    : (e.airlineaircraft.aircraft ? e.airlineaircraft.aircraft.additional_cabin_crew : 0)
}
```

### 9.7 租赁类型互斥切换
```js
prepareDataForLeaseType() {
  1 == lease_type && (minimum_bh = "", lease_rate_bh = "");                       // → BH 租赁
  2 == lease_type && (lease_rate = "", effective_funding_rate = "", quarters = ""); // → 计时租赁
}
```

---

## 10. 追踪结果（REA `trace-application-feature`）

| 种子 | Evidence ID | 匹配 | 结果 |
|---|---|---|---|
| `kind: module` (app.js) | `ev_d5f2fcae…` | **235 节点** | 追踪 247 节点 / 874 边 / **8 条终端路径** |
| `kind: route` `/play/api/airline/` | `ev_d5f2fcae…` | 0 | 未命中——静态分析未为字面量路径建 endpoint 节点 |
| `kind: string` `pushNewFlightRoute` | `ev_9e00f52a…` | 0 | 同上 |

**8 条终端路径构成**：6 条终止于 `endpoint` 节点，2 条终止于 `storage`
（`localStorage.getItem` / `localStorage.setItem`）。

**结论**：前端调用图结构完整可达，但 REA 的 endpoint 节点只保留了**低置信度候选**
（压缩变量名导致），真实 API 路径需靠静态字符串提取补足——这正是第 4 节采用的方法。

---

## 11. 运行时 API 确认状态

| 端点 | 确认方式 | 证据 |
|---|---|---|
| `GET /play/api/messaging/833/q/1` | ✅ 运行时捕获 ×6 次 | `ev_53c887a0…`、`ev_aa46c1ca…` |
| `/play/api/liveboard/{id}` | ⚠️ 静态提取 | — |
| 其余 63 条 | ⚠️ 静态提取 | — |

**未能完成运行时确认的原因**（工具限制，非分析缺陷）：
1. `capture-browser-scenario` 的 JSON 结构固定为 `{browser, start_url, actions}`，
   **不记录网络**（已用有效探测法逐一验证 root/step 级 artifact 键全部 `unknown_argument`）
2. `capture-browser-scenario`（Playwright）与 `inspect-web-page`（CDP 被动附加）
   **不能同时作用于同一 target**，否则 `target_changed`
3. `inspect-web-page` 仅记录 attach 窗口内的请求，页面加载期的 XHR 已错过
4. `inspect-web-page --include-script-sources` 在页面跳转后崩溃
   （`Debugger.getScriptSource failed: No script for id: 12`）

**解决方案**：需人工在 `inspect-web-page` 监听窗口内点击页面。

---

## 12. 组件与规模统计

| 指标 | 值 |
|---|---|
| Vue 组件（含 `data()`） | **172** |
| 懒加载组件定义 | 12（工厂 `(0, n(6262).A)`） |
| axios 调用 | **115 POST** / **58 GET** |
| Vuex 命名模块 | 0（未使用命名 store 模块） |
| 领域字段（蛇形） | 209 |
| 计算/解析方法（`calculate/resolve/prepare/compute`） | **66** |
| 其中 `calculate*` 经济公式 | 7 |
| `prepare*` 载荷构造器 | 39 |

---

## 13. 本轮新增产出文件

| 文件 | 内容 |
|---|---|
| `econ-model.txt` | 209 个领域字段的分组统计 |
| `formulas.txt` | 6 条应用层计算语句（已过滤 vendor） |
| `methods.txt` | 66 个计算/解析方法的方法名清单 + 40 个实现 |
| `components.txt` | 组件与符号统计 |
| `extract_api.py` | API 路径提取（67 条前缀） |
| `extract_routes.py` | 完整路由模板 + 方法名映射（47 条） |
| `extract_model.py` | 领域字段与状态字段统计 |
| `extract_formulas.py` | 精准公式提取（专有字段过滤） |
| `extract_methods.py` | 方法体提取 |
| `t-route-out.json` / `t-mod-out.json` | 追踪证据 |
| `per-route/net-*.json` | 9 条路由的 DOM 捕获（reports 达 2.4 MB） |