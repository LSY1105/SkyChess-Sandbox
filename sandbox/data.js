/* ============================================================
   情报市场 —— 付费情报可解锁的市场参数（真实游戏机制）
   ------------------------------------------------------------
   ★ 逆向结论：关键参数**不下发**
     · 需求曲线表（market_demand_curve_id 1/2/3）与转移模型（id=1）
       从不出现在玩家 API
     · gdp_demand 在多个市场恒为 1.50（默认值），
       而情报报告给的是 1.3 / 1.4 / 1.5 —— **API 字段不可直接信任**
     · 情报报告还承担**风险预警**功能（火山/网络攻击/能源冲击），
       且全部在游戏中兑现
   ⇒ 沙盘必须实现"未购买 → 参数不可见、不预警"的机制。

   ★ 数据来源：pdfs/SkyChess_Market_Intelligence_Report_gene.txt
     （由 rebuild/extract_intel.py 解析原文得到）
   ★ 玩家 API 默认值：gdpDemand 恒为 1.50（不可信）
   ============================================================ */
export const MARKET_INTEL = {
  SIM: { en:'Simone', gdpDemand: 1.3, popElas: 1.2, gdpGrowth: 1.5, dailyPax: null, cargoT: 5.0, guide: null },
  FTZ: { en:'Fitzgerald', gdpDemand: 1.3, popElas: 1.15, gdpGrowth: 1.0, dailyPax: null, cargoT: null, guide: null },
  GEE: { en:'McGee', gdpDemand: 1.35, popElas: 1.05, gdpGrowth: 1.0, dailyPax: null, cargoT: null, guide: null },
  LEW: { en:'Lewis', gdpDemand: 1.4, popElas: 1.15, gdpGrowth: 1.7, dailyPaxLow: 150.0, dailyPaxHigh: 200.0, cargoT: null, guide: null },
  ETN: { en:'Ellington', gdpDemand: 1.4, popElas: 1.2, gdpGrowth: 1.0, dailyPax: null, cargoT: null, guide: null },
  PKR: { en:'Parker', gdpDemand: 1.5, popElas: 1.2, gdpGrowth: 1.0, dailyPax: null, cargoT: null, guide: null },
  ARM: { en:'Armstrong', gdpDemand: 1.65, popElas: 1.25, gdpGrowth: 3.0, dailyPax: null, cargoT: null, guide: null },
};

/** 未购买情报时，玩家看到的是 API 默认值（可能错误） */
export const INTEL_API_DEFAULT = { gdpDemand: 1.50 };

/**
 * 事件风险预警（来自 3 份游戏内情报 PDF 原文）
 * 真实游戏中这些预警全部在游戏中兑现 —— 买了情报就能提前规避。
 */
export const INTEL_WARNINGS = [
  { id: 'volcano', scope: 'market', code: 'JOP',
    text: '佐格山爆发将严重中断数周，Joplin 市场需求可能受不利影响，当地损失严重。',
    source: 'flyte_Q2_volcano.txt' },
  { id: 'cyber', scope: 'airline', code: '*',
    text: '黑客目标指向 Air Ballistic（AB）—— 收益管理系统沦陷，被勒索。',
    source: 'flyte_Q2_cyber_AB.txt' },
  { id: 'hailstorm', scope: 'airline', code: '*',
    text: '强冰雹袭击枢纽机场（CA）—— 飞机露天停放受损，停飞 6 周、3 个月限飞 4 BH/日。',
    source: 'flyte_Q3_hailstorm_CA.txt' },
];

/* ============================================================
   SkyChess Sandbox — 静态数据
   数据来源: 逆向获取 (game 285 / airline 833 / 10 市场 / 26 机型)
   ============================================================ */

export const GM = {
  /* 航空煤油密度 kg/gal：用于把加仑换算为 kg 以便与原版 FLIGHT INFORMATION 的 kg 口径对齐
     依据：原版 CA-8783（Q2 2029）1,030 gal / 3,131 kg → 3.039 kg/gal（物理量，非该季业务参数） */
  fuel_kg_per_gal: 3.04,
  max_turns: 7,           // 原版完整对局 7 季：Q4 2027 → Q2 2029（实证：Reports 季度选择器）
  base_year: 2027,
  base_quarter: 4,          // 起始为 2027Q4
  max_bh: 900,              // 每回合飞行员可用 BH 上限
  flight_crew_max_bh: 775,
  open_minutes: 60,
  flight_crew_salary: 165000,
  flight_crew_salary_lh: 195000,
  flight_crew_allowance: 55,
  flight_crew_allowance_lh: 75,
  cabin_crew_salary: 113.4,
  cabin_crew_salary_lh: 85,
  cabin_crew_allowance: 60,
  cabin_crew_allowance_lh: 50,
  depreciation_years: 25,          // ★ 裁定 L1：25 年（教学假设；原版实测折旧 1,866,600 隐含 ~16 年）
  residual_value: 10,
  insurance_rate: 0.4519,
  // ── 湿租 (wet lease) ──
  // 真实游戏里 Capital Airways 开局 2 架飞机均为租赁（ROU），
  // 报表中表现为 Net Finance Charges = 自有利息 + ROU 利息。
  lease_rate_annual: 0.072,    // ★ 湿租年租金 / 目录价（7.2%/年 = 0.6%/月，Wikipedia Aircraft lease 2017 行业水平；原设 11% 偏高）
  round_seconds: 3600,         // ★ 每赛季限时（秒）—— 1 小时 + 老师讲课；到时自动结算
  /* ★ 机队融资通道（课程裁定 2026-11-03 更新：**自第一季（Q1）即开放**，融资成本计入运营成本）
     裁定 C+D：保持原版口径（初始 2 架飞机 + 期初现金 + 折旧/租金/贷款参数**一律不变**），
     同时放宽融资节奏（第一季即可融资买机）→ 起点不公平的问题用「通道」解决，而不是改资产
     融资是「成长通道」而非「初始优势」：利息照付、折旧照提，机队是负债 */
  /* ★ 三家航司走三条不同经营路线（课程裁定）
     CA = LCC 低成本型 · AB = FSC 全服务型 · VA = Hybrid 混合型 */
  styles: { CA: 'LCC', AB: 'FSC', VA: 'Hybrid' },
  /* 各风格**不可**投资的项目（教学：经营定位决定可选产品） */
  style_invest_deny: {
    LCC: ['lounge', 'lounge_vip', 'lounge_vip_shared', 'ife_enh', 'wifi_hc', 'cab_galaxy', 'cab_new', 'cab_refresh'],
    FSC: [],
    Hybrid: [],
  },
  financing_open_turn: 0,       // ★ 裁定 B：自首季（Q4/2027）起即可借款买机
  loan_max_ratio: 0.70,         // 负债上限 = 机队资产净值 × 70%
  loan_term_quarters: 48,       // 12 年等额本金
  lease_rate_annual_dry: 0.066, // ★ 干租年租金 6.6%/年（先进水平 0.55%/月；不含燃油/维护/保险）
  lease_deposit_rate: 0.02,    // 押金（可退）：≈2 个月租金，贴近真实航空业惯例
  lease_min_months: 12,        // 最短租期
  lease_buyout_rate: 0.55,     // 买断价 = 目录价 × 该比例
  interest_rate: 4.0,
  interest_years: 12,
  general_admin: 0.0120,
  general_admin_lh: 0.0050,
  cargo_overhead: 0.35,
  sh_turnaround: 45,
  /* ★ 地面占用时间（行业惯例）：学员填的是**轮挡起飞**时刻，但飞机从推出到撤轮档完成
     才真正占用机位与地面资源，故排班必须计入：
       · taxi_out_min：推出（pushback + 滑出）→ 轮挡起飞
       · taxi_in_min：轮挡落地 → 撤轮档完成
     参考：窄体机推出 ~10–15 分钟、落地至脱离轮挡 ~10–15 分钟 */
  cyber_service_price: 250000,
  /* ★ 经营失败收口（方案 C 双轨）
     ① 现金为负 → 强制削减：退租赁（可退不罚，退还押金）+ 停飞该机
     ② 仍资不抵债（现金 < bankrupt_cash）→ 破产清算：全部停飞、退出本届 */
  bankrupt_cash: -5000000,
  /* ── P0-2：GDP / 人口增长驱动市场需求自然增长（课堂笔记：「预期需求水平将随 GDP 以及人口增长而变化」）──
     口径：growth(turn) = (1+gdpGrowth%)^turn × (1+popGrowth%)^(turn×popElas)
       · 首季（turn=0）= 1 → **不改变既有 DEMAND_K 标定**
       · gdpGrowth / popElas 取自 data.js 各市场属性；pop_growth_quarterly 为人口季度增速默认值
       · 【推断·待验证】人口季度增速 1.0% 系按行业常识设定，原版一手数值待查 */
  pop_growth_quarterly: 1.0,
  /* ★ 中转（联程）旅客的**续程结算比例**：转机旅客买的是全程票，承运人之间按航段结算
     → 接续方只按接续段票价的一部分收款，余额归原承运人。
     缺此机制会产生套利：把票价拉高 + 承接中转 = 巨额收入（实测均价 \$3533/客） */
  connect_payout_ratio: 0.5,
  /* 票价上限倍数（相对指导价）；0 = 不限。防止离谱高价 + 中转的套利 */
  max_fare_multiple: 3,
  /* 裁判回购报价上限（相对飞机目录价）；防止离谱报价把飞机白送 */
  buyback_max_multiple: 0.5,   // 网络安全服务（解网络攻击状态）
  taxi_out_min: 12,
  taxi_in_min: 12,
  /* ★ 裁定（2026-11-03 更新）：过站时间**基线统一 60 分钟**
     依据：一手课堂观察「短程航班过站时间为 60 分钟，长航线航班为 120 分钟（适用目的地与枢纽过站飞机）」
     → 原实现 LCC 36 / FSC 90 系助手臆测（无一手依据），已作废
     → 经营风格差异（廉价型更快 / 全服务更从容）改为**裁判可谈定的教学参数**，不作为硬编码基线 */
  style_turnaround: { LCC: 60, Hybrid: 60, FSC: 60 },
  /* 过站时长构成三项（下客 + 清洁 + 上客），基准 20+20+20=60，可单独调整 */
  style_turnaround_parts: {
    LCC:    { deplane: 20, clean: 20, board: 20 },
    Hybrid: { deplane: 20, clean: 20, board: 20 },
    FSC:    { deplane: 20, clean: 20, board: 20 },
  },
  /* 裁判可谈定的档位（基准 60；允许低于基准需裁判特批，谈判时逐组差异化） */
  style_turnaround_options: {
    LCC:    [30, 45, 60, 75, 90],
    Hybrid: [30, 45, 60, 75, 90],
    FSC:    [30, 45, 60, 75, 90],
  },
  lh_turnaround: 120,
  /* ── 油价分层（系统派生 + 裁判可覆盖）──
     原版实证（Reports-FUEL，Q4/2027）：
       基准短程航线 $2.40/gal；长程 ARM $2.60、MCG $2.60（+ $0.20）
     → 系统按**航段长度**对基准油价加价；裁判可在基准/市场/定向三层覆盖。
     后期（Q2/2029）市价 ARM $3.00 / LEW $2.78 / FTZ $2.75 / JOP $2.60
       已非整齐加价 → 后期由裁判逐市场设定（marketParams 覆盖层）。 */
  /* ── 日内需求曲线（相对权重，24 小时）────────────────────────
     依据：Reports-ROUTE DEMAND（Lewis）曲线读数 —— 09:00 早峰、13:30 午峰、
     18:30 晚峰（绿线为市场需求，红线为本方实际承运）；培训纪要同述
     「早高峰、午间低谷及晚间高峰」。
     ⚠ 原版为**模拟数据**（非真实日内数据）→ 此处为按曲线取的假定值，
       各市场可用 MARKETS[code].dayShape 覆盖（裁判端可调）。 */
  dayShape: [   // 严格 24 项，索引 = 小时
    0.02, 0.02, 0.02, 0.02, 0.02, 0.05,   // 00-05 深夜
    0.15, 0.30, 0.70, 1.00,                // 06-09 早高峰（09:00 峰值）
    0.45, 0.30, 0.25, 0.45, 0.60,         // 10-14 午间低谷 + 午峰
    0.35, 0.25, 0.30, 0.90, 0.60,         // 15-19 晚高峰（18 时峰值）
    0.50, 0.35, 0.20, 0.05,                // 20-23
  ],
  fuel_long_haul_km: 3000,        // 航段 ≥ 此值视为长程
  fuel_long_haul_premium: 0.20,   // 长程加价 $/gal
  /* ── 裁判分季释放的航线（course release schedule）────────────────
     ★ 原版机制：航线**不是**一开始全开，而是裁判逐季释放，各团队再与裁判
       洽谈并支付开线费后才能开通、才能排班。
       · 初期只有几条航线（原版 CA 首季 Q4/2027：Simone + Ellington）
       · Q2 新赛季裁判放出 2 条新航线，需各团队谈判洽商后开通
       · 后续赛季裁判逐步开放剩余航线
     turn = 0-based 回合（0 = Q4 2027）
     依据：课程主持方说明（释放节奏）+ Reports-ROUTE METRICS（首季 CA 飞 SIM+ETN）
           + 执行过程报告 §4（CA Q2 进 Fitzgerald、Q3 开 Joplin、Broonzy 延至 Q4）
     ★ 该表为**可配置**的裁判参数：裁判可在教师端提前/延后释放。 */
  routeReleaseTurn: {
    /* Q1（首季）：3 条独飞航线 + 1 条三家共享
         · SIM 独飞 → CA；· FTZ 独飞 → VA；· PKR 独飞 → AB；· ETN 三家共享 */
    SIM: 0, ETN: 0, FTZ: 0, PKR: 0,
    JOP: 2, CHA: 2,      // Q2 新赛季：裁判放出 2 条新航线
    BZY: 3,              // Q3 逐步开放
    ARM: 4, GEE: 4,      // Q4 长程（需 ETOPS）
    LEW: 5,              // Q5 剩余
  },
  /* ── 分时定价（time-of-day fare）───────────────────────────────
     ★ 教学点（课程主持方）：票价由学员按市场自行决策 —— 定高了旅客减少、
       定低了亏损；而市场存在**日内高低峰**，合理做法是**高峰加价、低谷降价**。
     本实现：每条航线设「高峰加价 / 低谷折扣」两个参数（学员可调），
       系统按班次起飞时刻换算**有效票价**，收入与需求都随之变化。
     默认系数（相对基础价）：
       峰 06–10 与 17–20 → 1.20 ；谷 10–16 → 0.85 ；其余 → 1.00
     依据：Reports-ROUTE DEMAND 的日内需求曲线（早/晚双峰 + 午间低谷） */
  fareBandPeak: 1.20,
  fareBandOffPeak: 0.85,
  fareBandPeakHours: [[6, 10], [17, 20]],
  fareBandOffPeakHours: [[10, 17]],
  // 开线费 new_route_fee（下方原有）：固定不可议价（谈判纪要 §5.2 + 演练规则 $200,000）
  start_cash: 2000000,
  // 起始机队贷款：由 CA Q4/2027 季息 $892,838 ÷ (5%/4) 反推 = $71,427,040
  // （验证：rebuild/verify_loan_repayment.py）
  start_loan: 71427040,
  // 起始机队按**官方目录价**入账（此前误用旧价 $34M/$40M，导致折旧/保险/资产账面值全错）
  start_fleet_cost: 40000000 + 95040000,
  new_route_fee: 200000,
  etops_fee: 375000,
  deposit_bond: 40,
  seat_per_crew: 50,
};

/* 10 个市场 —— 参数来自情报报告 general/supplement v4 + API */
export const MARKETS = {
  LEW: { code:'LEW', name:'Lewis', name_cn:'路易斯', country:'United Kingdom',
    pop:12000, pop_growth:2.0, gdp_growth:1.7, pop_elasticity:1.15, gdp_elasticity:1.4,
    sector_km:415, bh:1.00, size:175, cargo_demand:12.0, cargo_yield:0.2256,
    landing_fee:8, handling_fee:12, traffic_handling_fee:7,
    elasticity:2, inelasticity:1, k_factor:0.45, unit_p:23, guide_fare:113,
    etops:false, demand_curve:1, seasonal:null, notes:'旅游目的地，13世纪中世纪堡垒' },

  SIM: { code:'SIM', name:'Simone', name_cn:'西蒙尼', country:'Italy',
    pop:19000, pop_growth:2.0, gdp_growth:1.5, pop_elasticity:1.2, gdp_elasticity:1.3,
    sector_km:525, bh:1.13, size:145, cargo_demand:5.0, cargo_yield:0.1991,
    landing_fee:10, handling_fee:11, traffic_handling_fee:10,
    elasticity:2, inelasticity:1, k_factor:0.45, unit_p:24, guide_fare:167,
    etops:false, demand_curve:3, seasonal:null,
    notes:'沿海旅游热点，新建鱼类加工厂，冬季旺季' },

  FTZ: { code:'FTZ', name:'Fitzgerald', name_cn:'菲兹杰拉德', country:'United States',
    pop:42000, pop_growth:1.0, gdp_growth:1.0, pop_elasticity:1.15, gdp_elasticity:1.3,
    sector_km:784, bh:1.44, size:175, cargo_demand:10.0, cargo_yield:0.1327,
    landing_fee:11, handling_fee:12, traffic_handling_fee:10,
    elasticity:1, inelasticity:1, k_factor:0.45, unit_p:null, guide_fare:163,
    etops:false, demand_curve:2, seasonal:null,
    notes:'轻工业城，42,000人，每天三个需求高峰，到枢纽85分钟' },

  ETN: { code:'ETN', name:'Ellington', name_cn:'艾灵顿', country:'United Kingdom',
    pop:35000, pop_growth:1.0, gdp_growth:1.0, pop_elasticity:1.2, gdp_elasticity:1.4,
    sector_km:1150, bh:1.88, size:365, cargo_demand:4.0, cargo_yield:0.1991,
    landing_fee:11, handling_fee:13, traffic_handling_fee:10,
    elasticity:1, inelasticity:1, k_factor:0.45, unit_p:21, guide_fare:237,
    etops:false, demand_curve:2, seasonal:null,
    notes:'旅游+退休定居点，佐格山活火山风险' },

  PKR: { code:'PKR', name:'Parker', name_cn:'帕克', country:'United States',
    pop:22000, pop_growth:2.0, gdp_growth:1.0, pop_elasticity:1.2, gdp_elasticity:1.5,
    sector_km:1620, bh:2.44, size:175, cargo_demand:5.0, cargo_yield:0.0531,
    landing_fee:12, handling_fee:12, traffic_handling_fee:12,
    elasticity:2, inelasticity:1, k_factor:0.45, unit_p:null, guide_fare:null,
    etops:false, demand_curve:null, seasonal:null,
    notes:'2003年建成的生物燃料工业城，公路发达' },

  ARM: { code:'ARM', name:'Armstrong', name_cn:'阿姆斯特朗', country:'United States',
    pop:38000, pop_growth:2.0, gdp_growth:3.0, pop_elasticity:1.25, gdp_elasticity:1.65,
    sector_km:3780, bh:5.04, size:190, cargo_demand:12.0, cargo_yield:0.0597,
    landing_fee:16, handling_fee:16, traffic_handling_fee:16,
    elasticity:2, inelasticity:1, k_factor:0.45, unit_p:null, guide_fare:698,
    etops:true, demand_curve:null, seasonal:null,
    notes:'新机场，需 ETOPS 许可，GDP前景最佳' + '（⚠ 由 Q2/2029 单航班碳排放反推暗示航段约 8,876km，与此值不符，官方地图待核）' },

  GEE: { code:'GEE', name:'McGee', name_cn:'麦基', country:'United States',
    pop:14000, pop_growth:1.0, gdp_growth:1.0, pop_elasticity:1.05, gdp_elasticity:1.35,
    sector_km:5265, bh:6.82, size:150, cargo_demand:12.0, cargo_yield:0.0597,
    landing_fee:17, handling_fee:16, traffic_handling_fee:12,
    elasticity:1, inelasticity:1, k_factor:0.45, unit_p:null, guide_fare:825,
    etops:true, demand_curve:null, seasonal:null,
    notes:'新机场，需 ETOPS，建议不超过1个承运人' },

  JOP: { code:'JOP', name:'Joplin', name_cn:'乔普林', country:'United States',
    pop:1500, pop_growth:1.0, gdp_growth:4.0, pop_elasticity:0.2, gdp_elasticity:1.7,
    sector_km:1433, bh:2.22, size:125, cargo_demand:40.0, cargo_yield:0.0995,
    landing_fee:10, handling_fee:10, traffic_handling_fee:10,
    elasticity:2, inelasticity:1, k_factor:0.45, unit_p:null, guide_fare:154,
    etops:false, demand_curve:null, seasonal:'summer',
    notes:'奢华岛屿度假村，夏季高峰，商务舱收益3倍经济舱' },

  CHA: { code:'CHA', name:'Charles City', name_cn:'查尔斯市', country:'United States',
    pop:27000, pop_growth:3.0, gdp_growth:3.0, pop_elasticity:1.5, gdp_elasticity:1.5,
    sector_km:980, bh:2.10, size:140, cargo_demand:20.0, cargo_yield:0.3982,
    landing_fee:11, handling_fee:13, traffic_handling_fee:10,
    elasticity:1, inelasticity:1, k_factor:0.45, unit_p:null, guide_fare:220,
    etops:false, demand_curve:null, seasonal:null,
    esg_required:true,
    notes:'金融中心，税收优惠，货运收益最高(0.60)，需环保项目才能获取时刻' },

  BZY: { code:'BZY', name:'Broonzy', name_cn:'布伦齐', country:'United States',
    pop:28000, pop_growth:2.0, gdp_growth:3.0, pop_elasticity:1.2, gdp_elasticity:1.5,
    sector_km:4473, bh:8.42, size:160, cargo_demand:30.0, cargo_yield:0.2654,
    landing_fee:14, handling_fee:14, traffic_handling_fee:12,
    elasticity:2, inelasticity:1, k_factor:0.45, unit_p:null, guide_fare:698,
    etops:true, demand_curve:null, seasonal:null,
    notes:'蓝调与爵士乐文化之旅，客运全天稳定，需 ETOPS' },
};

export const MARKET_LIST = Object.keys(MARKETS);

/* 26 种机型 —— 官方 Aircraft Catalogue Summary v5 + Cost Data 2022 v5 */
export const AIRCRAFT = [
  { name:'APT100',   type:'SR', seats:100, eco:100, prem:0,  biz:0,  price:40.00,  cab_min:2, cab_extra:1, cargo:2.6, sp:12.6, mtow:45, fuel:1565, dmc_c:220, dmc_fh:260, long:false },
  { name:'APT100 P', type:'SR', seats:100, eco:76,  prem:12, biz:0,  price:41.00,  cab_min:2, cab_extra:2, cargo:3.8, sp:12.6, mtow:45, fuel:1565, dmc_c:220, dmc_fh:260, long:false },
  /* ★ 公务舱机型（2026-11-03 新增）：原版目录中所有机型 biz=0 → 商务舱定价无处落地，
     但投资目录已存在「配餐（公务舱与超经舱）」项 → 说明原版应有公务舱运力。
     目录价按同型 + 商务舱溢价 25% 估算 → 【推断·待验证】（原版目录价一手数值待查） */
  { name:'APT100 J',  type:'SR', seats:100, eco:84,  prem:0,  biz:16, price:50.00, cab_min:2, cab_extra:2, cargo:2.6, sp:12.6, mtow:45, fuel:1565, dmc_c:220, dmc_fh:260, long:false },
  { name:'G130 J',    type:'SR', seats:132, eco:108, prem:0,  biz:24, price:105.30, cab_min:3, cab_extra:2, cargo:3.7, sp:16.9, mtow:63, fuel:2020, dmc_c:355, dmc_fh:288, long:false },
  { name:'G130',     type:'SR', seats:132, eco:132, prem:0,  biz:0,  price:84.24,  cab_min:3, cab_extra:1, cargo:3.7, sp:16.9, mtow:63, fuel:2020, dmc_c:355, dmc_fh:288, long:false },
  { name:'G130 P1',  type:'SR', seats:132, eco:96,  prem:16, biz:0,  price:86.00,  cab_min:3, cab_extra:2, cargo:5.2, sp:16.9, mtow:63, fuel:2020, dmc_c:355, dmc_fh:288, long:false },
  { name:'G130 P2',  type:'SR', seats:132, eco:102, prem:12, biz:0,  price:86.00,  cab_min:3, cab_extra:2, cargo:5.0, sp:16.9, mtow:63, fuel:2020, dmc_c:355, dmc_fh:288, long:false },
  { name:'G160',     type:'SR', seats:159, eco:159, prem:0,  biz:0,  price:95.04,  cab_min:4, cab_extra:1, cargo:2.9, sp:18.8, mtow:74, fuel:2200, dmc_c:390, dmc_fh:330, long:false },
  { name:'G160 P1',  type:'SR', seats:159, eco:123, prem:12, biz:0,  price:97.00,  cab_min:3, cab_extra:3, cargo:4.8, sp:18.8, mtow:74, fuel:2200, dmc_c:390, dmc_fh:330, long:false },
  { name:'G160XLR',  type:'LR', seats:159, eco:159, prem:0,  biz:0,  price:102.00, cab_min:4, cab_extra:1, cargo:0.0, sp:17.7, mtow:80, fuel:2100, dmc_c:400, dmc_fh:340, long:true },
  { name:'G160XLR P1',type:'LR',seats:159, eco:123, prem:12, biz:0,  price:106.00, cab_min:3, cab_extra:3, cargo:1.9, sp:17.7, mtow:80, fuel:2100, dmc_c:400, dmc_fh:340, long:true },
  { name:'G160XLR P2',type:'LR',seats:159, eco:117, prem:16, biz:0,  price:106.00, cab_min:3, cab_extra:3, cargo:2.1, sp:17.7, mtow:80, fuel:2100, dmc_c:400, dmc_fh:340, long:true },
  { name:'G160XLR P3',type:'LR',seats:159, eco:105, prem:24, biz:0,  price:106.00, cab_min:3, cab_extra:3, cargo:2.5, sp:17.7, mtow:80, fuel:2100, dmc_c:400, dmc_fh:340, long:true },
  { name:'G160XLR B',type:'LR', seats:159, eco:117, prem:8,  biz:0,  price:109.00, cab_min:3, cab_extra:3, cargo:2.9, sp:17.7, mtow:80, fuel:2100, dmc_c:400, dmc_fh:340, long:true },
  { name:'G160XLR BP1',type:'LR',seats:159,eco:93,  prem:20, biz:8,  price:110.00, cab_min:3, cab_extra:3, cargo:3.7, sp:17.7, mtow:80, fuel:2100, dmc_c:400, dmc_fh:340, long:true },
  { name:'G160XLR BP2',type:'LR',seats:159,eco:69,  prem:20, biz:8,  price:110.00, cab_min:3, cab_extra:3, cargo:5.7, sp:17.7, mtow:80, fuel:2100, dmc_c:400, dmc_fh:340, long:true },
  { name:'G200',     type:'SR', seats:192, eco:192, prem:0,  biz:0,  price:107.00, cab_min:4, cab_extra:1, cargo:4.8, sp:24,   mtow:92, fuel:2420, dmc_c:420, dmc_fh:370, long:false },
  { name:'G200LR',   type:'LR', seats:192, eco:192, prem:0,  biz:0,  price:120.00, cab_min:4, cab_extra:2, cargo:4.8, sp:21.2, mtow:99, fuel:2420, dmc_c:420, dmc_fh:370, long:true },
  { name:'G200LR B', type:'LR', seats:192, eco:150, prem:12, biz:0,  price:123.00, cab_min:4, cab_extra:3, cargo:6.8, sp:21.2, mtow:99, fuel:2420, dmc_c:420, dmc_fh:370, long:true },
  { name:'G200LR BP',type:'LR', seats:192, eco:102, prem:24, biz:12, price:125.00, cab_min:3, cab_extra:4, cargo:9.2, sp:21.2, mtow:99, fuel:2420, dmc_c:420, dmc_fh:370, long:true },
  { name:'G200LR P', type:'LR', seats:192, eco:156, prem:24, biz:0,  price:125.00, cab_min:4, cab_extra:4, cargo:5.5, sp:21.2, mtow:99, fuel:2420, dmc_c:420, dmc_fh:370, long:true },
  { name:'G250',     type:'LR', seats:272, eco:272, prem:0,  biz:0,  price:132.00, cab_min:6, cab_extra:2, cargo:2.7, sp:29.9, mtow:224,fuel:3300, dmc_c:495, dmc_fh:450, long:true },
  { name:'G250 B',   type:'LR', seats:272, eco:225, prem:15, biz:0,  price:136.00, cab_min:5, cab_extra:3, cargo:5.9, sp:29.9, mtow:224,fuel:3300, dmc_c:495, dmc_fh:450, long:true },
  { name:'G250 BP',  type:'LR', seats:272, eco:146, prem:42, biz:15, price:138.00, cab_min:5, cab_extra:4, cargo:9.6, sp:29.9, mtow:224,fuel:3300, dmc_c:495, dmc_fh:450, long:true },
  { name:'APT300',   type:'LR', seats:264, eco:264, prem:0,  biz:0,  price:136.96, cab_min:6, cab_extra:2, cargo:7.7, sp:34.1, mtow:231,fuel:3050, dmc_c:480, dmc_fh:425, long:true },
  { name:'APT300 Y2',type:'LR', seats:264, eco:264, prem:0,  biz:0,  price:138.00, cab_min:6, cab_extra:2, cargo:6.1, sp:34.1, mtow:231,fuel:3050, dmc_c:480, dmc_fh:425, long:true },
  { name:'APT300 B', type:'LR', seats:264, eco:226, prem:18, biz:0,  price:142.00, cab_min:5, cab_extra:4, cargo:9.7, sp:34.1, mtow:231,fuel:3050, dmc_c:480, dmc_fh:425, long:true },
  { name:'APT300 BP',type:'LR', seats:264, eco:154, prem:30, biz:18, price:144.00, cab_min:5, cab_extra:4, cargo:13.9,sp:34.1, mtow:231,fuel:3050, dmc_c:480, dmc_fh:425, long:true },
];

/* 投资目录（节选，完整 126 项见 events/catalogue） */
/* ============================================================
   ★ 真实游戏机制（依据 7 份小组谈判纪要 + 裁判端界面）
   ============================================================ */

/**
 * 燃油套保 —— 两档**固定不可议价**方案（真实规则，非连续可谈）
 *   方案一 Swap 互换：费用 $50,000，Q2–Q3 结算价**双向固定** $2.63/加仑
 *                   （涨跌都按此价结算）
 *   方案二 Call 看涨：费用 $350,000，Q2–Q3 结算价**上限** $2.43/加仑
 *                   （低于此价按市价结算）
 *   选型依据：执飞长航程 → 选高价方案（对冲高波动）；仅短航程 → 选低价方案（控成本）
 *   有效期：选定后从 Q2 生效至 Q3 末；Q4/Q5/Q6 需另行协商
 */
/* ★ 2026-11-03 三方报价机制：供给方各有**不同成本结构与附加条件**，
     需按统一可比字段比价后选型（原版仅两档固定方案，本轮按用户要求扩展为可谈判多方报价） */
export const HEDGE_QUOTES = [
  { id:'A', supplier:'Northwind Energy（银行互换部）', product:'swap', strike:2.63, floor:null,
    share:0.60, quarters:2, upfront:50000, fixedFeePerQuarter:0, varPerGal:0,
    creditSupport:true, prepayRate:0, minGallons:0, leverage:0,
    terms:'双向锁定；含违约信用保护；需提前 1 季签约；无最低量' },
  { id:'B', supplier:'Gulf Trading（商品经纪）', product:'call', strike:2.43, floor:null,
    share:0.40, quarters:2, upfront:350000, fixedFeePerQuarter:25000, varPerGal:0.012,
    creditSupport:false, prepayRate:0.50, minGallons:200000, leverage:1.5,
    terms:'价格上限（低于按市价）；另收 $25k/季管理费 + $0.012/gal；预付 50%；最低 20 万加仑' },
  { id:'C', supplier:'Aurum Capital（私募基金）', product:'collar', strike:2.75, floor:2.10,
    share:0.80, quarters:3, upfront:220000, fixedFeePerQuarter:0, varPerGal:0.004,
    creditSupport:true, prepayRate:0.25, minGallons:0, leverage:2.0,
    terms:'上下限走廊 $2.10–$2.75；覆盖 80%、3 季；预付 25%；含信用保护；杠杆 2.0×' },
];

/** 比价情景：市价 × 权重（统一可比口径） */
export const HEDGE_SCENARIOS = [
  { key:'base', label:'基准（市价持平）', priceFactor:1.00, weight:0.50 },
  { key:'up',   label:'上行（油价 +50%）', priceFactor:1.50, weight:0.30 },
  { key:'down', label:'下行（油价 −25%）', priceFactor:0.75, weight:0.20 },
];

export const FUEL_HEDGES = [
  { id:'swap', name:'燃油互换 Swap（双向锁定）', premium: 50000, strike: 2.63, cap: false,
    note:'$5万/次；Q2–Q3 结算价固定 $2.63/加仑，油价涨跌均按此价' },
  { id:'call', name:'燃油看涨 Call（价格上限）', premium: 350000, strike: 2.43, cap: true,
    note:'$35万/次；Q2–Q3 结算价上限 $2.43/加仑，低于此价按市价结算' },
];

/**
 * 过站时间 —— 短程档位（受时刻表规则约束，必须是 15 分钟的倍数）
 *   60 分：基线
 *   45 分：不产生额外成本，保留全部货运能力
 *   30 分：必须放弃全部货运服务（仅适用于无货舱机队）
 *   长程过站时间固定 120 分钟，不可调整
 */
export const TURNAROUND_TIERS = [
  { minutes: 60, cargoKept: true,  note:'基线（短程）' },
  { minutes: 45, cargoKept: true,  note:'无额外成本，保留全部货运能力' },
  { minutes: 30, cargoKept: false, note:'必须放弃全部货运服务' },
];
export const LH_TURNAROUND = 120;

/**
 * 飞机租赁条款（真实谈判结果）
 *   · 干租(dry lease) / 湿租(wet lease) 两类
 *   · 折扣可谈（实例：P3 原价 1.06 亿 → 谈成 20% 折扣；APT100 原 40 万/月 → 20% 折扣 32 万/月）
 *   · **租期内任何时间可退还，不额外收费**（避免承租方运营中断）
 *   · 实例：APT100(006) 32 万/月；APT100(007 主题机) 31 万/月，季租 93 万
 *   · 实例：A350 湿租 549 万/季（立即投入远程航线，需 ETOPS）
 */
export const LEASE_TERMS = {
  wet:  { name:'湿租 Wet Lease', note:'含机组/油料/维护，由出租方运营保障' },
  dry:  { name:'干租 Dry Lease', note:'仅租机体，自负运营成本；短租用于旺季机动' },
  flexibleReturn: true,       // 租期内随时可退，不额外收费
  minMonths: 12,
  defaultDiscount: 0.20,      // 实例中的常见成交折扣
};

/**
 * 飞机大修（heavy check）
 *   · 规则：完成大修的飞机只需运营**上季一半的 block hours**（实例：4.76 BH）
 *   · 经济性：完成大修后出售比直接卖**多 $500,000**（实例：$9,473,500）
 *   · 大修期间飞机仍可少量运营（实例：G160 保留 1 班/日飞 Lewis）
 */
export const HEAVY_CHECK = {
  bhRatioAllowed: 0.5,          // 允许运营上季一半 BH
  resalePremium: 500000,        // 完成大修的出售溢价
  note:'大修后可按更高价出售；期间可少量运营满足 BH 要求',
};

/** 固定不可议价的采购项（真实谈判记录） */
export const FIXED_PRICE_ITEMS = [
  { id:'cyber_protect', name:'网络保护服务（Internet Data Protection）',
    price: 250000, period:'perQuarter', negotiable: false,
    note:'$25万/季，不还价；供应商称远低于被黑的损失' },
  { id:'new_route',    name:'新航线相关权限采购',
    price: 200000, period:'oneoff', negotiable: false,
    note:'$20万固定价，供应商后台完成配置' },
  { id:'hangar_lease',  name:'机库租赁',
    price: 20000, period:'perMonth', max: 40000, negotiable: true,
    note:'$2万–4万/月；对比购置 $193万（可4年分期但有折旧损耗），租赁性价比更优' },
  { id:'fair_ticket',  name:'展会/展销票价',
    price: 170, period:'perPassenger', negotiable: true,
    note:'$170/位，参数可按需调整' },
];

/** 主题化运营（真实案例：007 邦德主题机） */
export const THEMED_OPS = {
  extraPaxFee: 3,        // 每位旅客额外收费 $3（辅营收入）
  qsiBonus: 2,           // 出租方提供 QSI +2 支持
  example: '007 邦德主题机：领结空乘 + "shaken not stirred" 鸡尾酒 + 抽奖活动',
};

/** 客舱配置规则（真实规则） */
export const CABIN_RULES = {
  premiumNeedsExtraCrew: true,   // 有 premium economy 的飞机至少配 1 名额外乘务员
  cateringConsistentAcrossRoutes: true,  // 所有航线机上餐饮必须一致
  foodOnEveryAircraft: true,      // 所有飞机都必须配餐（应对临时需求）
  note:'premium economy 需专属餐食与额外乘务员',
};

/** 事件豁免规则（真实案例） */
export const EVENT_EXEMPTIONS = {
  hailDamagedNoFine: true,       // 冰雹受损飞机按满编安排不罚
  replacementAircraftAllowed: true, // 可由替代飞机承担原任务
};

export const INVESTMENTS = [
  /* ─────────────────────────────────────────────────────────────────────
     原版 Investment Catalogue 全部 31 项，逐项数值经原始核对。
     一手来源：主/Investment Catalogue(VIEW INVESTMENTS).jpg
       （2628×27314 长图，按项裁切读取；核对记录见
         rea-skychess/真实机制对照.md §投资目录核对表）
     原版字段结构：
       Upfront cost | Annual cost |
       Passenger Costs & Revenues → Economy / Premium Economy / Business
         Cost per passenger | Revenue per passenger
     本沙盘口径：
       costPerPax / revenuePerPax —— 引擎使用的单值口径，取「适用舱位代表值」
       cabin                      —— 三舱位完整原版数值（UI 三列矩阵 + 后续 U14 按舱计费）
       cabinApplies               —— 该项适用的舱位（原文语义）
     口径限制（诚实标注）：原版按舱位分别计价且 E 舱为 $0 表示该舱旅客不承担；
       沙盘当前为单票价模型、无分舱位旅客数，故按适用舱位代表值对全部旅客计提，
       对 cat_econ / cat_biz_pe / fnb_basic 存在系统性偏差（方向见方案文档 U14）。
     ───────────────────────────────────────────────────────────────────── */

  /* ── 广告（Advertising）：Upfront $0，收益来自第三方广告投放 ── */
  { id:'adv_web', name_cn:'广告（网站与代理）', desc_cn:'向旅行社与网站支付佣金', name:'Advertising (Agents, Website)', cat:'airline', upfront:0, annual:150000,
    costPerPax: 0, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    effect:{ qsi:0.5 }, desc:'向旅行社与网站支付佣金（ Upfront $0 / Annual $150,000）' },
  { id:'adv_bill', name_cn:'广告（广告牌）', desc_cn:'在机场与户外投放广告牌', name:'Advertising (Billboards)', cat:'airline', upfront:0, annual:250000,
    costPerPax: 0, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    effect:{ qsi:0.35 }, desc:'户外广告牌（ Upfront $0 / Annual $250,000）' },
  { id:'adv_print', name_cn:'广告（印刷品）', desc_cn:'在报刊与机上投放印刷广告', name:'Advertising (Print)', cat:'airline', upfront:0, annual:650000,
    costPerPax: 0, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    effect:{ qsi:0.8 }, desc:'印刷广告（ Upfront $0 / Annual $650,000）' },
  { id:'adv_social', name_cn:'广告（社交媒体）', desc_cn:'在社交媒体投放精准广告', name:'Advertising (Social Media)', cat:'airline', upfront:0, annual:350000,
    costPerPax: 0, revenuePerPax: 2.0,
    cabin:{ E:{c:0, r:2}, PE:{c:0, r:2}, B:{c:0, r:2} },
    effect:{ qsi:0.45 }, desc:'社交媒体投放； Revenue per passenger $2.00，谈判纪要实录可谈到 $4' },
  { id:'adv_tv', name_cn:'广告（电视与影院）', desc_cn:'在电视与影院投放品牌广告', name:'Advertising (TV and Cinema)', cat:'airline', upfront:0, annual:500000,
    costPerPax: 0, revenuePerPax: 2.0,
    cabin:{ E:{c:0, r:2}, PE:{c:0, r:2}, B:{c:0, r:2} },
    effect:{ qsi:0.6 }, desc:'电视与影院广告； Revenue per passenger $2.00' },
  { id:'ota', name_cn:'在线旅行社', desc_cn:'接入在线旅行社分销渠道', name:'Online Travel Agents', cat:'airline', upfront:0, annual:50000,
    costPerPax: 5.0, revenuePerPax: 2.5,
    cabin:{ E:{c:5, r:2.5}, PE:{c:5, r:2.5}, B:{c:5, r:2.5} },
    effect:{ qsi:0.25 }, desc:'在线旅行社代理：成本 $5.00、收益 $2.50（三舱同值）' },
  { id:'agent_ch', name_cn:'代理人渠道', desc_cn:'建立自有代理人网络', name:'代理人渠道（谈判新增）', cat:'airline', upfront:0, annual:0,
    costPerPax: 0, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    effect:{ qsi:0.2 },
    desc:'谈判纪要实录：代理人渠道收益由 $0 谈到 $3/旅客（沙盘自定义项，非原版目录）' },

  /* ── 客舱升级（Cabin Upgrade）：Upfront 一次性，注明影响延迟一个季度 ── */
  { id:'cab_galaxy', name_cn:'客舱升级（银河级）', desc_cn:'全面升级客舱设施与服务', name:'Cabin Upgrade (Galaxy)', cat:'airline', upfront:3700000, annual:0,
    costPerPax: 0, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    /* ★ 座位改造：全服务航空高端化 → 公务舱座位增加、经济舱减少（VIP 承载↑）
       增量无一手材料 →【推断·待验证】 */
    effect:{ qsi:0.9, premium:1, seatMod:{ biz:+8, eco:-4 } },
    desc:'豪华客舱升级；注 Impact is deferred by one Quarter（影响延迟一季度）' },
  { id:'cab_lowcost', name_cn:'客舱升级（低成本型）', desc_cn:'以低成本方式升级客舱', name:'Cabin Upgrade (Low Cost)', cat:'airline', upfront:1375000, annual:0,
    costPerPax: 0, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    /* ★ 座位改造：原版 Cabin Upgrade (Low Cost)「a modest increase in seat count」
       → 低成本航空：经济舱座位增加 → 可拉更多旅客（增量无一手材料 →【推断·待验证】） */
    effect:{ qsi:0.5, seatMod:{ eco:+10 } },
    desc:'低成本客舱升级：经济舱座位 +10（可拉更多旅客）；注 须与 GM 谈判条款方可投资；影响延迟一个季度' },
  { id:'cab_new', name_cn:'客舱升级（全新座椅）', desc_cn:'更换全新座椅提升舒适度', name:'Cabin Upgrade (New Seats)', cat:'airline', upfront:2550000, annual:0,
    costPerPax: 0, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    effect:{ qsi:0.6, seatMod:{ prem:+6 } }, desc:'更换新座椅：超经舱座位 +6；注 影响延迟一个季度' },
  { id:'cab_refresh', name_cn:'客舱升级（翻新）', desc_cn:'翻新客舱设施', name:'Cabin Upgrade (Refresh)', cat:'airline', upfront:2150000, annual:0,
    costPerPax: 0, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    effect:{ qsi:0.4 }, desc:'客舱翻新；注 影响延迟一个季度' },

  /* ── 推广 ── */
  { id:'enews', name_cn:'电子报', desc_cn:'定期发送航旅资讯邮件', name:'eNewsletters', cat:'airline', upfront:0, annual:75000,
    costPerPax: 0, revenuePerPax: 0.5,
    cabin:{ E:{c:0, r:0.5}, PE:{c:0, r:2}, B:{c:0, r:3} },
    effect:{ qsi:0.12 },
    desc:'电子通讯推广； Revenue per passenger $0.50/$2.00/$3.00（沙盘原口径缺失，本轮补齐）' },

  /* ── 辅营收入项（原版 8 项；沙盘此前仅 2 项且缺数值）── */
  { id:'bags', name_cn:'额外行李', desc_cn:'增加免费行李额度', name:'Extra Bags', cat:'airline', upfront:0, annual:0,
    costPerPax: 1.25, revenuePerPax: 2.5,
    cabin:{ E:{c:1.25, r:2.5}, PE:{c:1.25, r:2.5}, B:{c:1.25, r:0} },
    effect:{ ancillary:1 },
    desc:'额外行李收费：成本 $1.25（三舱同）、收益 $2.50/$2.50/$0.00（商务舱不适用）' },
  { id:'giveaway', name_cn:'机上赠品', desc_cn:'向旅客发放机上小礼品', name:'Giveaways', cat:'airline', upfront:0, annual:20000,
    costPerPax: 1.0, revenuePerPax: 0,
    cabin:{ E:{c:1, r:0}, PE:{c:1.5, r:0}, B:{c:3, r:0} },
    effect:{ qsi:0.08 },
    desc:'机上赠品（提高忠诚度）；成本 $1.00/$1.50/$3.00、收益全 $0' },
  { id:'ife_basic', name_cn:'机上娱乐（基础版）', desc_cn:'提供基础机上娱乐系统', name:'IFE (Basic Video)', cat:'airline', upfront:1450000, annual:175000,
    costPerPax: 3.0, revenuePerPax: 5.0,
    cabin:{ E:{c:3, r:5}, PE:{c:3, r:5}, B:{c:3, r:5} },
    effect:{ qsi:0.5, ancillary:1 },
    desc:'基础机上娱乐（20 部影片 / 10 个电视节目）；成本 $3.00、收益 $5.00（三舱同）' },
  { id:'ife_enh', name_cn:'机上娱乐（增强版）', desc_cn:'提供增强版机上娱乐系统', name:'IFE (Enhanced Video)', cat:'airline', upfront:1600000, annual:190000,
    costPerPax: 4.0, revenuePerPax: 6.5,
    cabin:{ E:{c:4, r:6.5}, PE:{c:4, r:7}, B:{c:4, r:7.5} },
    effect:{ qsi:0.65, ancillary:1 },
    desc:'增强机上娱乐（700 部影片 / 65 个电视节目）；成本 $4.00、收益 $6.50/$7.00/$7.50' },
  { id:'wifi', name_cn:'机上网络（标准）', desc_cn:'开通机上网络服务', name:'In Flight Connectivity (WiFi)', cat:'airline', upfront:1450000, annual:150000,
    costPerPax: 2.0, revenuePerPax: 3.0,
    cabin:{ E:{c:2, r:3}, PE:{c:2, r:3}, B:{c:2, r:4} },
    effect:{ qsi:0.6, ancillary:1 },
    desc:'卫星宽带（4K / VoIP / 文件传输）；成本 $2.00、收益 $3.00/$3.00/$4.00' },
  { id:'wifi_hc', name_cn:'机上网络（高速）', desc_cn:'开通高速机上网络', name:'In Flight Connectivity Hi-Connex', cat:'airline', upfront:330000, annual:120000,
    costPerPax: 2.0, revenuePerPax: 3.0,
    cabin:{ E:{c:2, r:3}, PE:{c:2, r:3}, B:{c:2, r:4} },
    effect:{ qsi:0.35, ancillary:1 },
    desc:'低轨卫星网络（最高 1Gbps）；成本 $2.00、收益 $3.00/$3.00/$4.00' },
  { id:'lounge', name_cn:'休息室（基础）', desc_cn:'自建休息室', name:'Lounge (Basic)', cat:'airline', upfront:0, annual:1455000,
    costPerPax: 1.0, revenuePerPax: 1.0,
    cabin:{ E:{c:1, r:1}, PE:{c:2, r:3}, B:{c:2, r:3} },
    effect:{ ancillary:1 },
    desc:'基础贵宾室（370㎡，仅到达机场）；成本 $1/$2/$2、收益 $1/$3/$3（沙盘原 annual=$0，本轮纠正为 $1,455,000）' },
  { id:'lounge_shared', name_cn:'休息室（基础·共享）', desc_cn:'与机场共享休息室', name:'Lounge (Basic) Shared', cat:'airline', upfront:0, annual:191000,
    costPerPax: 1.0, revenuePerPax: 1.0,
    cabin:{ E:{c:1, r:1}, PE:{c:1, r:1.5}, B:{c:2, r:2} },
    effect:{ ancillary:1 },
    desc:'共享基础贵宾室（370㎡）；成本 $1/$1/$2、收益 $1/$1.50/$2（本轮新增）' },
  { id:'lounge_vip', name_cn:'休息室（贵宾）', desc_cn:'自建贵宾休息室', name:'Lounge (VIP)', cat:'airline', upfront:0, annual:2924000,
    costPerPax: 1.0, revenuePerPax: 4.0,
    cabin:{ E:{c:1, r:4}, PE:{c:1, r:4}, B:{c:4, r:8} },
    effect:{ ancillary:1 },
    desc:'VIP 贵宾室（1,100㎡，枢纽）；成本 $1/$1/$4、收益 $4/$4/$8（本轮新增）' },
  { id:'lounge_vip_shared', name_cn:'休息室（贵宾·共享）', desc_cn:'与机场共享贵宾休息室', name:'Lounge (VIP) Shared', cat:'airline', upfront:0, annual:945500,
    costPerPax: 1.0, revenuePerPax: 1.5,
    cabin:{ E:{c:1, r:1.5}, PE:{c:2, r:2.5}, B:{c:5, r:6} },
    effect:{ ancillary:1 },
    desc:'共享 VIP 贵宾室（1,100㎡）；成本 $1/$2/$5、收益 $1.50/$2.50/$6（本轮新增）' },
  { id:'loyalty', name_cn:'常旅客计划', desc_cn:'建立常旅客奖励计划', name:'Loyalty Programme', cat:'airline', upfront:0, annual:1750000,
    costPerPax: 5.0, revenuePerPax: 8.0,
    cabin:{ E:{c:5, r:8}, PE:{c:5, r:8}, B:{c:7, r:10} },
    effect:{ ancillary:1, qsi:0.5 },
    desc:'常旅客计划；成本 $5/$5/$7、收益 $8/$8/$10 —— 辅营占比 40% 目标的核心抓手（本轮新增）' },
  { id:'overweight', name_cn:'超重行李', desc_cn:'放宽超重行李收费', name:'Overweight Baggage', cat:'airline', upfront:0, annual:0,
    costPerPax: 0.5, revenuePerPax: 1.75,
    cabin:{ E:{c:0.5, r:1.75}, PE:{c:1, r:2}, B:{c:2, r:0} },
    effect:{ ancillary:1 },
    desc:'超重行李费（额外搬运成本）；成本 $0.50/$1.00/$2.00、收益 $1.75/$2.00/$0.00（本轮新增）' },
  { id:'pref_seats', name_cn:'优先选座', desc_cn:'提供优先选座', name:'Preferred Seats', cat:'airline', upfront:0, annual:25000,
    costPerPax: 1.0, revenuePerPax: 2.0,
    cabin:{ E:{c:1, r:2}, PE:{c:1, r:2}, B:{c:1, r:2} },
    effect:{ ancillary:1 },
    desc:'优先座位（近舱门 / 紧急出口）；成本 $1.00、收益 $2.00（三舱同）（本轮新增）' },
  { id:'priority', name_cn:'优先登机', desc_cn:'提供优先登机', name:'Priority Boarding', cat:'airline', upfront:0, annual:25000,
    costPerPax: 1.0, revenuePerPax: 1.5,
    cabin:{ E:{c:1, r:1.5}, PE:{c:1, r:1.5}, B:{c:5, r:0} },
    effect:{ ancillary:1 },
    desc:'优先登机（登机口设计与额外人手）；成本 $1/$1/$5、收益 $1.50/$1.50/$0（本轮新增）' },
  { id:'selfcheckin', name_cn:'自助值机', desc_cn:'部署自助值机设备', name:'Self-service Check-in', cat:'airline', upfront:0, annual:80000,
    costPerPax: 1.0, revenuePerPax: 2.0,
    cabin:{ E:{c:1, r:2}, PE:{c:1, r:2}, B:{c:1, r:2} },
    effect:{ ancillary:1 },
    desc:'自助值机（收益来自广告）；成本 $1.00、收益 $2.00（三舱同）（本轮新增）' },
  { id:'online_booking', name_cn:'在线订座', desc_cn:'开通在线订座与支付', name:'On Line Booking', cat:'airline', upfront:0, annual:550000,
    costPerPax: 0.5, revenuePerPax: 0,
    cabin:{ E:{c:0.5, r:0}, PE:{c:0.5, r:0}, B:{c:0.5, r:0} },
    effect:{ qsi:0.4 },
    desc:'在线预订（专属团队 + 7×24 技术支持）；成本 $0.50（三舱同）、收益 $0（本轮新增）' },

  /* ── 航线级投资（原版 route by route basis，须选市场）── */
  { id:'cat_econ', name_cn:'配餐（经济舱）', desc_cn:'为经济舱提供机上配餐', name:'Provided Catering (Economy)', cat:'route', upfront:0, annual:875000,
    costPerPax: 3.0, revenuePerPax: 0,
    cabin:{ E:{c:3, r:0}, PE:{c:0, r:0}, B:{c:0, r:0} },
    cabinApplies:['E'], effect:{ qsi:0.3 },
    desc:'自备经济舱餐饮（线上预订预付）；成本 $3.00 仅经济舱旅客承担' },
  { id:'cat_biz_pe', name_cn:'配餐（公务舱与超经舱）', desc_cn:'为公务舱与超经舱提供配餐', name:'Provided Catering (Biz and PE)', cat:'route', upfront:0, annual:2000000,
    costPerPax: 12.5, revenuePerPax: 0,
    cabin:{ E:{c:0, r:0}, PE:{c:10, r:0}, B:{c:15, r:0} },
    cabinApplies:['PE','B'], effect:{ qsi:0.35 },
    desc:'自备高端/公务舱餐饮；成本 PE $10 / B $15（经济舱不适用）；原版 Annual $2,000,000（沙盘原写 $1,100,000，本轮纠正）' },
  { id:'fnb_basic', name_cn:'机上餐饮销售（基础）', desc_cn:'在机上销售基础餐饮', name:'On Board F&B Sales (Basic)', cat:'route', upfront:0, annual:310000,
    costPerPax: 2.0, revenuePerPax: 3.0,
    cabin:{ E:{c:2, r:3}, PE:{c:0, r:0}, B:{c:0, r:0} },
    cabinApplies:['E'], effect:{ ancillary:1, qsi:0.25 },
    desc:'机上餐饮销售（基础，仅经济舱）；成本 $2.00、收益 $3.00；须线上预付（本轮新增）' },
  { id:'fnb_super', name_cn:'机上餐饮销售（高级）', desc_cn:'在机上销售高级餐饮', name:'On Board F&B Sales (Superior)', cat:'route', upfront:0, annual:510000,
    costPerPax: 5.0, revenuePerPax: 8.5,
    cabin:{ E:{c:3, r:7}, PE:{c:5, r:10}, B:{c:7, r:0} },
    effect:{ ancillary:1, qsi:0.35 },
    desc:'机上餐饮销售（优质，含收费吧台服务）；成本 $3/$5/$7、收益 $7/$10/$0（本轮新增）' },
];

/* 资产目录 */
export const ASSETS = [
  { id:'hangar_s', name:'Hangar single aisle', price:1935000, note:'两机库，含供暖/隔热/电动门，交付6个月' },
  { id:'hangar_t', name:'Hangar twin aisle',   price:4192500, note:'双通道机库' },
  { id:'hotel',   name:'Hotel',              price:17304625, note:'中端115间房，收益性资产', assetYield:0.010 },
  { id:'sim_s',   name:'Simulator single aisle', price:14000000, note:'含技术支持包，可对外销售时长', assetYield:0.010 },
  { id:'sim_t',   name:'Simulator twin aisle',   price:16000000, note:'同上', assetYield:0.010 },
  { id:'eng_apt100', name:'Spare engine APT100', price:7000000, note:'含快速更换套件，对冲可靠性风险' },
  { id:'eng_g160',  name:'Spare engine G130 & G160', price:10000000, note:'同上' },
  { id:'eng_g200',  name:'Spare engine G200 & G200LR', price:15000000, note:'同上' },
  /* ★ 一手补齐（2026-11-03 Asset Catalogue 截图）：原版目录共 10 项，沙盘原缺 2 项 */
  { id:'eng_apt300', name:'Spare engine APT300', price:22000000, note:'含备件包与快速换发套件；对冲可靠性风险（对应机型 APT300 尚未纳入沙盘机型目录）' },
  { id:'eng_g250',   name:'Spare engine G250',   price:23000000, note:'含备件包与快速换发套件；对冲可靠性风险（对应机型 G250 尚未纳入沙盘机型目录）' },
];

/* 随机事件池（裁判可触发） */
export const EVENTS = [
  { id:'volcano', scope:'market', title:'火山爆发',
    text:'佐格山喷发，市场需求受损 3 个月。', effect:{ demand_mult:0.55, turns:3 } },
  { id:'cyber', scope:'airline', title:'网络攻击',
    text:'收益管理系统沦陷，被勒索。', effect:{ qsi:-3.0, ransom:true } },
  { id:'hail', scope:'airline', title:'冰雹',
    text:'飞机露天停放受损，停飞 6 周，3 个月内日利用上限 4 BH。', effect:{ ground_weeks:6, util_cap:4, turns:3 } },
  { id:'pandemic', scope:'global', title:'疾病大流行',
    text:'全球需求骤降。', effect:{ demand_mult:0.5, turns:2 } },
  { id:'fuel_shock', scope:'global', title:'能源价格冲击',
    text:'油价暴涨。', effect:{ fuel_mult:1.6 } },
];

/* 评分目标（PPT p94 首都航空 Low-Cost Carrier） */
export const TARGETS = {
  gross_margin: 0.10,
  ancillary_share: 0.40,
  cumulative_profit: 6000000,
  load_factor: 0.60,
  market_share: 0.35,
};

/* ============================================================
   分季规则开启表（progressive rule unlocking）
   ------------------------------------------------------------
   ★ 教学目的：原版是「循序渐进」的设计——每个赛季引入新机制，
     学生先掌握基础经营（航线/运价/运力），再逐季接触
     套保 → 过站/租赁 → 碳与合规 → 新市场 → SAF。
     若把所有机制一次性打开，学生会在第一季就被复杂度压垮，
     而**规则的逐季引入本身就是教学内容**（Role Guide 要求
     「第三季度结束前提交目标」，正对应渐进节奏）。

   turn = 0-based 回合（0 = Q4 2027，即首个赛季）
   依据栏标注每个开启时点的来源：
     [证据] = 原始/ 官方 PDF / 裁判端报告实证
     [裁定] = 课程主持方裁定（无一手材料，依教学设计设定）
     [推断] = 由材料推得，未直接实证
   ============================================================ */
export const RULE_SCHEDULE = [
  { key:'connections',   turn:2, name:'中转客源（承接率可调）', group:'网络',
    basis:'[证据] 培训纪要：接驳时间窗 2–4 小时；原版 CA Q4/2027 实测中转≈0（旅客 61.9K = 局地需求之和）→ 建议 T2 后开放' },
  { key:'carbonCost',    turn:0, name:'碳成本计入',       group:'环境',
    basis:'[证据] Reports-ECONOMICS：Q4/2027 已有 Carbon $458,843' },
  { key:'carbonTerms',   turn:2, name:'碳价谈判 / 碳减排项目', group:'环境',
    basis:'[裁定] 课程主持方：碳相关条款自 Q3 季由裁判开启' },
  { key:'safMandate',    turn:5, name:'SAF 强制掺混 5%（2.5 倍价）', group:'环境',
    basis:'[证据] flyte Q4 SAF：政府要求 2029-01-01 起 5% uplift 须为 SAF' },
  { key:'loanSystem',    turn:0, name:'自有资产贷款（12 年期）', group:'金融',
    basis:'[证据] Reports-ECONOMICS：Interest on Owned Assets $892,838 + Loan Repayments' },
  { key:'cashFloor',     turn:0, name:'现金下限 $2,000,000 + 超额强制还贷', group:'金融',
    basis:'[证据] CA 与 VA 首季期末现金均恰好 $2,000,000（期初不同却同落点）' },
  { key:'intelPurchase', turn:0, name:'市场情报购买',     group:'信息',
    basis:'[证据] CA Q1 购情报 $55,000（VA $90,000）' },
  { key:'fuelHedge',     turn:0, name:'燃油套保谈判',     group:'风险',
    basis:'[证据] CA Q1 末谈定 swap $2.63/gal，覆盖 Q2–Q3' },
  { key:'etops',         turn:0, name:'ETOPS 长程许可',   group:'机队',
    basis:'[证据] CA Q2 获批（$375,000）' },
  { key:'heavyCheck',    turn:0, name:'定检大修',         group:'机队',
    basis:'[证据] 裁判建议：先大修、下季再卖（G160 实得 $3,768,973）' },
  { key:'financingChannel', turn:0, name:'机队融资通道（借款买机/付押金 · 利息计入运营成本）', group:'金融',
    basis:'[裁定] 课程主持方（2026-11-03 裁定 C+D）：融资通道**自第一季即开放**，融资成本计入运营成本；初始资产（2 架 + 期初现金）与折旧/租金/贷款口径一律不变以保公平' },
  { key:'leaseWet',      turn:0, name:'湿租（首季可赊机：免押金 · 租金后付）', group:'机队',
    basis:'[证据] CA Q2 讨论湿租 A350 $5.49M/季（后改干租）' },
  { key:'leaseDry',      turn:2, name:'干租（可议价）',   group:'机队',
    basis:'[证据] CA Q3 谈成 APT100 $310–320k/月、G160XLR P3 $848k/月（20% off）' },
  { key:'turnaroundNeg', turn:1, name:'过站时间谈判',     group:'运营',
    basis:'[证据] CA Q2 谈成 60→45 分钟（免费、保货运）' },
  { key:'cyberService',  turn:1, name:'网络安全服务（$250k/季）', group:'风险',
    basis:'[证据] CA Q2 购买（AB 队设备已被黑）' },
  { key:'newMarkets',    turn:2, name:'新市场开放（JOP / CHA / BZY）', group:'市场',
    basis:'[证据] CA 执行报告 Q3：三个新市场开放，CHA 需 eco clearance' },
  { key:'hangar',        turn:2, name:'机库（抗冰雹）',   group:'机队',
    basis:'[证据] CA Q3 灾后购入（Q2 谈判时裁判建议租赁 $2–4 万/月）' },
  { key:'themedOp',      turn:2, name:'主题化运营（007 精品航班）', group:'营销',
    basis:'[证据] CA Q3 方案：每客 +$3、QSI +2、年费 $100k' },
  { key:'targetSubmit',  turn:2, name:'目标提交与追踪',   group:'考核',
    basis:'[证据] Role Guide v3：第三季度结束前提交目标' },
];

/** 该规则在给定回合是否已开放 */
export function ruleUnlocked(turn, key) {
  const r = RULE_SCHEDULE.find(x => x.key === key);
  return r ? turn >= r.turn : false;
}

/* ── 碳成本口径（Reports-ECONOMICS-ROUTE ECONOMICS 两条航线交叉验证）──
   原版：碳成本 = 燃油加仑数 × $0.5707/gal
     SIM 314,325 gal → $179,358（0.57061）
     ETN 489,750 gal → $279,485（0.57067）
   换算到「每吨碳价」量纲：0.5707 / 2577 = 0.00022146 t/gal
   ⇒ 碳价 $2,577/t 时恰为 $0.5707/gal（自洽）
   ⚠ 沙盘旧实现按旅客数计量 → Q4/2027 实算 $2,651 vs 原版 $458,843（差约 173 倍），已修正 */
export const CARBON = {
  t_per_gallon: 0.00022146,     // 每加仑燃油对应的碳排放(吨)
  base_price_per_tonne: 2577,   // Q4/2027 基准碳价（$458,843 ÷ 178 t）
  index: 1.0,                   // 裁判可调（碳价指数）
};

/* ── 贷款与现金下限（Reports-ECONOMICS + VisionAir 复盘 + 验证脚本）── */
export const LOAN = {
  years: 12,                    // 12 年 = 48 季
  quarters: 48,
  rate_annual: 5.0,             // 年利率（裁判可谈，CA 曾谈成 5%→4%）
  repayment_basis: 'principal_plus_interest',   // 验证结论：还款额含利息
  cash_floor: 2000000,          // 期末现金下限（CA/VA 首季末均恰好此值）
  force_sweep_excess: true,     // 超额现金强制还贷
};
