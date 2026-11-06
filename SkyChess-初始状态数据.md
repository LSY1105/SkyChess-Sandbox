# SkyChess — 初始状态数据基线（2026-10-21 抓取）

- **证据 ID**：`ev_6e72b73ca6ec127b0a4e6f4ad261fcf2bf8ac016737d80ecfc7db9ba92dc8aef`
- **捕获文件**：`capture-full.json`（3.8 MB，904 网络事件 / 99 个响应体）
- **状态快照**：`state-baseline.json`（7 个端点 / **7,450 个标量路径**）
- **说明**：此时 SkyChess 尚未正式开放（`game_status: 1`，所有 `turn.open = 0`，`opened_at: null`）

---

## 1. 本次抓取的方法突破

之前 4 轮尝试都卡在「Playwright 场景不记录网络」。最终从 REA 包源码
`dist/domain/browserScenarioValues.js:245` 找到了未公开的 `capture` schema：

```js
capture: {
  after_each_step: ["screenshot","dom","accessibility","url","history","storage"],
  at_end:         ["url"],
  events:         ["console","page-errors","network","websockets","frames","workers","popups","downloads"],
  network:        { request_body: true, response_body: true, header_values: false },
  limits:         {...}
}
```

加上 `network.response_body: true` 后，**响应体以 base64 完整回传**。
此前失败的原因是我用 `"capture": true`（布尔）探测，而 schema 要求对象 —— 探测方法本身没错，是探测值类型错了。

---

## 2. 运行时确认的 API 地图

URL 模式：`/play/api/airline/{airlineId}/{resource}/{airlineturnId}`

| 路由 | 端点 | 响应大小 |
|---|---|---|
| Dashboard | `GET /play/api/airline/833` | 25.5 KB |
| Dashboard | `GET /play/api/messaging/833/q/1` | 110 B（约 30s 轮询） |
| Scheduler | `GET /play/api/airline/833/scheduler/5205` | 18.3 KB |
| Schedules | `GET /play/api/airline/833/schedules/5205` | 70.7 KB |
| Fares | `GET /play/api/airline/833/fares/5205` | 3.6 KB |
| Fare Matrix | `GET /play/api/airline/833/fare-matrix/5205` | 30.2 KB |
| Investments | `GET /play/api/airline/833/investments/5205` | 10.8 KB |
| Investment Catalogue | `GET /play/api/airline/833/catalogues/investments` | — |
| **Fleets** | **无 XHR** | — |
| **Reports** | **无 XHR** | — |

> `/fleets` 与 `/reports` 完全没有发起 API 请求 —— 与你所说「尚未开放、这两个模块打不开」**完全吻合**，这是数据侧的反向印证。

`5205` = `airline_turn_id`，`833` = `airline_id`。

---

## 3. 游戏配置（game 285）

```json
{
  "id": 285,
  "title": "RR Derby 20-22 October 2026",
  "about": "China Eastern",
  "game_status": 1,
  "max_turns": 6,
  "base_year": "2027",
  "max_bh": 900,
  "open_minutes": 60,
  "board_refresh_rate": 20,
  "board_show_departures": 30,
  "target_cash": 2000000,
  "peak_pricing": 1,
  "connecting_demand": 2,
  "currentturn": 1,
  "yearsplayed": 0.25,
  "fuel_prices": [null, null, "2.6", "4.5", "3.75", "2.75", "2.7"]
}
```

**`yearsplayed: 0.25` 直接印证了前端公式** `age = (turn − acquired_turn) / 4`：
**1 回合 = 0.25 年 = 1 个季度**。

回合表（`turns`）：
| turn | year | quarter | airlineturn_id | open | fare_lock_active |
|---|---|---|---|---|---|
| 0 | 2027 | 4 | — | 0 | 0 |
| 1 | 2028 | 1 | **5205** | 0 | 0 |

油价数组 7 项对应 6 个回合，印证油价冲击机制。

---

## 4. 航空公司（airline 833）

```json
{
  "id": 833, "name": "Capital Airways", "code": "CA",
  "game_id": 285, "colour": "yellow", "hex": "#dfbf0c",
  "starting_cash": 2687673,
  "operational_status": 0,
  "attack_ransom": 2000000
}
```

对局中还有 `AB`、`VA` 两家（从机队缩写可见）。

---

## 5. 机队（schedule.aircraft，6 条）

| 名称 | aaid |
|---|---|
| APT100 (CA:Starter) | 16557 |
| G160 (CA:Starter) | 16558 |
| G130 (AB:Starter) | 16559 |
| G160 (AB:Starter) | 16560 |
| APT100 (VA:Starter) | 16561 |
| G200 (VA:Starter) | 16562 |

### 5.1 飞机目录数据（aircraft type 17 = APT100）

```json
{
  "id": 17, "name": "APT100",
  "seats": 100, "seats_standard": 100, "seats_business": 0, "seats_premium": 0,
  "total_price": 40000000,        // 目录价
  "mtow": 45,
  "structural_payload": 12581,
  "maximum_cargo_payload": "4.24",
  "cargo_volume": 26.5,
  "fuel_burn": 1565,              // ← 燃油模型核心参数
  "flight_speed": 833,
  "dmc_cycle": 220, "dmc_fh": 260,   // 直接维护成本
  "cabin_crew": 2, "additional_cabin_crew": 1,
  "payload_range_id": 1
}
```

### 5.2 航空公司持有状态（airline_aircraft 4080）

```json
{
  "nickname": "Starter",
  "total_price": 34000000,        // 实际购入价（低于目录价 6,000,000）
  "total_finance": 34000000,
  "spares": 2,                    // 备件 2% → calculateAircraftFinance 公式生效
  "acquired_at_turn": 0,
  "acquired_at_age": 6,           // 购入时机龄 6 年
  "available_from_turn": 0,
  "availability": true,
  "leased_at_turn": null, "leased_to_turn": null
}
```

验算 `calculateAircraftFinance`：
`34,000,000 + 34,000,000 × 2/100 = 34,680,000` ← 可复现的公式验证点。

---

## 6. 航线市场（markets，2 条）

第一条 `airlineturn_market` 20389 → `gamemarket` 2496 → `market` 26：

```json
{
  "id": 26, "name": "Simone", "code": "SIM",
  "market_type": 1,
  "market_demand_curve_id": 3,
  "market_transfer_model_id": 1,
  "inelasticity": 1, "elasticity": 2,
  "unit_p": 24, "unit_q": 0,
  "sector_length": 525,
  "population_growth": 2.00, "gdp_growth": 1.50,
  "population_demand": 1.20, "gdp_demand": 1.50,
  "k_factor": 0.45, "size": 145
}
```

### 该航线的运价与费用设置

```json
{
  "fare": 120.00,
  "landing_fee": 10.00,
  "handling_fee": 11.00,
  "traffic_handling_fee": 10.00,
  "cargo_handling_fee": 60.00,
  "peak_revenue": 1.05,
  "peak_landing": 1.25, "peak_handling": 1.25, "peak_traffic": 1.25,
  "business_modifier": 1.80, "premium_modifier": 1.20,
  "premium_handling": 1.20, "business_handling": 3.00
}
```

**完整的需求模型参数已到手**：`elasticity` / `inelasticity` / `population_demand` /
`gdp_demand` / `k_factor` / `market_transfer_model_id` / `market_demand_curve_id`。

---

## 7. 投资（investments，2 条）

`airlineturn.investments` 有 2 条；`airlineturn` 同时带 `aircraft: list[2]`、
`markets: list[2]` —— 说明**投资实体就是航线+飞机的绑定**。

---

## 8. 运价矩阵

```json
{ "matrix": { "turns": {...2 个回合...} }, "colPercent": 10 }
```

---

## 9. 玩家信息

```json
{ "id": ..., "firstname": ..., "surname": ..., "email": ...,
  "created_at": ..., "updated_at": ..., "name": ..., "roles": [...] }
```

---

## 10. 明日操作

### 一条命令完成全流程

```bash
cd "C:/Users/qjl10/Desktop/学习/德比大学/rea-skychess"
./capture.sh turn1
```

脚本自动完成：
1. 检查 CDP 浏览器
2. 定位 target
3. 生成 10 路由场景
4. 执行抓取（DOM + 网络响应体）
5. 解码保存 `state-turn1.json`
6. 生成摘要

### 与基线对比

```bash
python compare_state.py state-baseline.json state-turn1.json
```

输出：新增路径 / 消失路径 / **值变化明细**（含前后值），正好对应「数据变化」需求。

### 每次操作后都可快照

```bash
./capture.sh after-scheduler   # 排完班表后
./capture.sh after-fares       # 调完运价后
./capture.sh turn2             # 第 2 回合
```

---

## 11. 边界声明

- 本次抓取的是**你自己账号被授权访问的数据**（SkyChess 作为 SPA 本就通过这些端点下发给你）
- 未做任何未授权访问、未测试服务端权限控制
- 报告第 4 节提到的裁判端 `/admin/api` 暴露面是**客户端代码层面的观察**，需由 SkyChess 官方评估
- 响应体来源为 Playwright `Response.body()`；REA 源码注明：当 CDP 无缓存体时 Playwright 可能发起一次带凭据的重新加载，故响应体与原事务的对应关系存在 provenance 限制