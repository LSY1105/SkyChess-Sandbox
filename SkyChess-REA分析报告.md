# SkyChess Airline (game 833) — REA 逆向分析报告

- **目标**：`https://www.skychess.com/play/airline/833`
- **分析日期**：2026-10-21
- **工具**：REA (`rea-agents` 6.7.0)，全部结果带 Evidence ID 与 provenance
- **分析主机**：Windows ARM64 → 通过 x64 Node 仿真解锁 REA 原生静态分析

---

## 1. 证据清单

| Evidence ID | 操作 | 关键产物 |
|---|---|---|
| `ev_53c887a0…` | `inspect-web-page` (dashboard) | 页面结构、资源、脚本清单、storage |
| `ev_f3300f31…` | `analyze-web-bundle` | Vue 指纹、bundle chunk 图、409,375 AST 节点 |
| `ev_eea21760…` | `export-web-scripts` | `app.js` (1,373,596 B) + 内联脚本落盘 |
| `ev_d501e10d…` | `analyze-javascript-application` | 233 模块 / 20,020 节点语义图 / 13,957 关系 |
| `ev_afc4a949…` | `capture-browser-scenario` | 自主驱动 10 条路由全部导航 |
| `ev_0e0dab86…` | `observe-web-session` | 257 事件 / 18 次导航 |
| `ev_e6549cb7…` | `observe-web-session` (4min) | 31 事件 |
| `ev_829764b7…` | `capture-browser-scenario` (connect) | 已登录浏览器接入验证 |

---

## 2. 技术栈

| 层 | 结论 | 依据 |
|---|---|---|
| 前端框架 | **Vue** | REA `vue-runtime` 检测器，中置信度 |
| 打包器 | **webpack** `bootstrap@0` | 233 个模块，ID 制命名空间 |
| 入口 | IIFE `(()=>{...})()` | `app.js` 第 1 行 |
| HTTP 客户端 | **axios** | `axios.post` 调用形态 |
| 后端 | **Laravel** | `_token` CSRF 隐藏域、`form-control`、`<form method="POST" action="/login">` |
| 登录页 | 纯服务端渲染 | **0 个 JS 脚本** |
| 认证 | Session Cookie + CSRF | Laravel 默认栈 |

---

## 3. 前端路由表（10 条，全部导航成功）

```
/play/airline/833                        Dashboard
/play/airline/833/scheduler              Flight Management (时刻表)
/play/airline/833/schedules              Live Schedules
/play/airline/833/fares                  Fare Management (Fares)
/play/airline/833/fare-matrix            Fare Matrix
/play/airline/833/fleets                 Fleet Plans
/play/airline/833/investments            Investment Manager
/play/airline/833/catalogue/investments  Investment Catalogue
/play/airline/833/catalogue/assets       Asset Catalogue
/play/airline/833/reports                Reports
```

---

## 4. API 面 — 两个权限域（**核心发现**）

同一个 `app.js`（每个玩家都能下载）里包含**两套 API 客户端**。

### 4.1 玩家端 `/play/api` — 6 条

| 模板 | 语义 |
|---|---|
| `/play/api/airlines` | 拉取本玩家可玩的航空公司列表 |
| `/play/api/airline/{airlineId}/…` | 单一航空公司的聚合端点（fares / investments / messaging） |
| `/play/api/airline/csv/{…}` | CSV 导出 |
| `/play/api/liveboard/{gameId}` | 实时世界看板轮询 |
| `/play/api/liveboard/cached/{gameId}` | 看板缓存版（`viacache` 分支） |
| `/play/api/messaging/{gameId}/q/{n}` | **运行时已确认**，约 20 秒轮询一次 |

玩家端方法：`pullRoute` `pullInitialRoute` `pushRoute` `pushNewFlightRoute`
`pushInvestmentUpdateRoute` `pushRemoveInvestmentRoute` `pushDepartureTimeCheckRoute` `csvRoute`

### 4.2 管理端（Game Master）`/admin/api` — 61 条前缀 / 42 条完整模板

**这一整套 Game Master（裁判）后台 API 被编译进了面向玩家的公开 bundle。**

| 域 | 路径 | 用途 |
|---|---|---|
| 游戏 | `/admin/api/games/{id}/…` | 游戏创建/克隆、回合、时间戳、系统设置 |
| 回合 | `/admin/api/quarters/{id}/…` | 回合编辑、`toggleLockFareChanges` |
| 对局实体 | `/admin/api/gameroutes/…` | 对局航线、枢纽 (`pushGameHubUpdateRoute`) |
| | `/admin/api/gameinvestments/…` | 对局投资，含 `create/all` 批量 |
| | `/admin/api/gameaircraft/…`、`/gameassets/…` | 对局飞机 / 资产 |
| 航空公司 | `/admin/api/airlines/{id}/…` | 飞机增删改、**售后回租 (sale-and-lease-back)**、燃油对冲 |
| 航空公司回合 | `/admin/api/airlinequarters/{id}/…` | 航班、航线、投资、飞机更新 |
| 基础数据 | `/admin/api/data/{aircraft,assets,routes,demandcurves,payloadranges,investments,logos,tags,transfermodels,taggable}/…` | 目录主数据 + 分页 + 克隆 |
| 计算器 | `/admin/api/abacus/helpers/netbookvalue/{aircraft,asset}/…` | 净账面价值计算 |
| 搜索 | `/admin/api/search/{aircraft,assets,investments,routes,users}?query=` | 全局搜索 |
| 用户 | `/admin/api/users/…`、`/admin/api/airlines/users/create` | 用户与角色 |
| 图像 | `/admin/api/images/model/…`、`/model/logo/id/…` | 3D 模型 / Logo 上传 |

**观察边界**：以上仅为**静态字符串提取**结果，证明客户端代码中存在这些调用点。
我**没有**尝试任何未授权访问、未测试服务端权限控制是否失效。所有端点的实际可达性与授权行为需要由 SkyChess 官方验证。

---

## 5. 游戏机制端点（对课程作业最有价值）

| 机制 | 端点 / 方法 |
|---|---|
| 净账面价值 | `pushCalculateNetBookValueRoute` → `abacus/helpers/netbookvalue/{aircraft,asset}` |
| 载荷区间插值 | `pushInterpolateRoute` → `data/payloadranges/` |
| 需求曲线 | `pullDemandCurveRoute` / `pushCloneDemandCurveRoute` → `data/demandcurves/` |
| 运价锁定 | `pushToggleLockFareChangesRoute` → `quarters/{id}` |
| 飞机处置 | `pushAircraftSaleRoute` / `pushAircraftSaleAndLeaseBackRoute` / `pushAircraftCancelSaleRoute` |
| 燃油对冲 | `pushNewFuelHedgeRoute` / `pushFuelHedgeUpdateRoute` |
| 枢纽 | `pushGameHubUpdateRoute` → `gameroutes/` |
| 报表 | `pushTurnReportingRoute` → `games/{id}/quarter/{turnId}/runreports` |
| 转移模型 | `data/transfermodels/`（克隆 + 更新） |

---

## 6. 领域关键词密度（`app.js` 出现次数）

```
aircraft 1029   investments 217   economics 184   demand 166   route 537
fleet     121   reports     60   network    61   hub      27
scheduler  26   maintenance  21   fares      17
```

航班 / 航线 / 投资 / 需求 / 经济性逻辑确实存在于前端 bundle。

---

## 7. 方法论与工具限制记录

### 平台限制与绕过
`analyze-javascript-application` 原始报错：

```
capability_unavailable — REA Windows native controls require a Windows x64 host.
```

根因：REA 加载 `native/windows/build/rea-windows-x64.node`，加载器硬检查 `process.arch === "x64"`。
解决：安装 x64 Node 22.23.3（Windows ARM 仿真运行），`process.arch` 变为 `x64`，原生插件加载成功。

```bash
C:/Users/qjl10/AppData/Local/rea-node64/node-v22.23.3-win-x64/node.exe \
  "C:/Users/qjl10/AppData/Local/pi-node/current/node_modules/rea-agents/scripts/rea.mjs" <命令>
```

### 遇到的三个工具边界
1. `inspect-web-page --include-script-sources` 在页面跳转后崩溃：
   `Debugger.getScriptSource failed (-32000): No script for id: 12`
2. Playwright `capture-browser-scenario` 与 `inspect-web-page` **不能同时**附加同一 target（`target_changed`）——
   CDP 跨客户端竞争。
3. `capture-browser-scenario` 的 per-step 工件（DOM/截图/网络）选项无法通过 schema 或文档枚举获得。

### 完整性限制
- 语义图触及 20,000 节点上限（`truncated: true`），省略 22,988 动态调用流、31,848 歧义对象流
- 静态 endpoint 候选全部为 `low` 置信度（压缩变量名造成），不可作为结论
- API 路由来自静态字符串提取，未经运行时逐一确认（除 messaging 外）