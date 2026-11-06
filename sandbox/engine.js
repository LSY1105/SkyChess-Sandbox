/* ============================================================
   SkyChess Sandbox — 公式引擎
   移植自 rebuild/engine.py 与 rebuild/demand.py 的回归模型
   ============================================================ */
import { GM, MARKETS, CARBON } from './data.js';

/* ---------- 需求模型 ---------- */
/* ============================================================
   需求模型 v2 —— 识别修正版（见 rebuild/demand.py 模块文档）
   D = K_market × (FARE_REF/fare)^eps × (freq/FREQ_REF)^FREQ_EXP

   ★ 三处关键修正（相对 v1）：
     1) 识别逻辑方向性错误：pax=min(D,ASK) ⇒ LF<100% 时 **D=pax 精确成立**，
        LF=100% 时才是 D≥ASK 的下界。v1 恰好用反，丢掉了 31 行含信息量的等式。
     2) 服务频率是真实驱动项，指数 0.50（次线性）。
     3) 报告列的 QSI 为季度级变量、与隐含需求非单调，加入后拟合反而变差
        （log-RMS 34.26% vs 30.91%）→ 不再作为需求乘子。
        机理上 QSI 的需求效应是**经由班次频率中介**的。
   ============================================================ */
export const DEMAND_K = {
  Armstrong: 68505, Broonzy: 26953, Joplin: 12999,
  // ★ 已标定（2026-11-02，rebuild/calibrate_demand_js.mjs，观测：原版 CA Q4/2027 首季）
  //   Ellington: 11,603 → 31,729（×2.735）  真值反解自市场旅客 67,355
  //   Simone:    9,868 →  7,188（×0.728）  真值反解自市场旅客 29,300
  //   校验：540 班×100 座×525km = 28.35MM ≈ 真实 ASK 28.4MM；360×159×1150 = 65.83MM ≈ 65.8MM
  // ⚠ 其余 5 个市场**未标定**（缺「机型×航线 + 班次 + 票价 + LF」的自洽观测）
  Ellington: 31729, Simone: 7188,
  Lewis: 7555, Fitzgerald: 5951,
  // ★ McGee：2026-11-03 单点反解（rebuild/calibrate_longhaul_k.mjs）
  //   锚点：原版 VA Q2/2028 独飞 McGee（fare $825、pretax $6.40M、margin 40.2%）
  //     → 收入 $15.92M → 旅客 19,297/季（214 人/日）；147 座×2 班/日×90×LF 66% 独立校验一致
  //   K = 19,297 / ((200/825)^1.0 × (180/100)^0.5) = 59,332
  McGee: 59332,
};
const FARE_REF = 200.0;
const FREQ_REF = 100.0;
const FREQ_EXP = 0.50;
const REVENUE_COEF = 0.926228;          // 佣金率 7.38%

/** 服务频次对需求的放大系数（次线性，实测最优指数 0.50） */
export function freqFactor(freq) {
  return Math.pow(Math.max(freq, 1) / FREQ_REF, FREQ_EXP);
}
export function priceFactor(fare, eps) {
  return Math.pow(FARE_REF / Math.max(fare, 1e-6), eps);
}
/** 潜在需求 (人/季) —— **单一航司服务时的**需求（单 firm 口径）
 *  freq —— 该航线当季总班次（真实报表 Frequencies 列的口径，典型 180/360/540）
 */
export function demand(marketName, fare, freq, mult = 1) {
  const m = MARKETS[marketName] || {};
  const K = DEMAND_K[marketName];
  if (!K) return 0;
  const eps = 1 + 0.05 * (m.elasticity || 1);
  return K * priceFactor(fare, eps) * freqFactor(freq) * mult;
}

/* ============================================================
   竞争分配 —— 多航司共享同一市场时的需求切分
   ------------------------------------------------------------
   ★ 为什么必须有
     原先每家航司各自 pax = min(seats, D)，D 是**全市场需求**
     → 三家可各自吃掉 100% 同一市场，总承运可达真实需求的 3 倍（重复计量）。
     竞争教学沙盘必须把需求**分配**给航司。

   ★ 模型：二航司 logit 的多航司推广（softmax）
     V_i   = a·ln(p_i) + b·ln(f_i) + c·QSI_i + δ_i
     share_i = softmax(V) 在同一市场的所有航司上
     pax_i  = min(seats_i, D_market × share_i)
     ⇒ 各家份额之和 = 1，总承运 ≤ 市场需求（无重复计量）

   ★ 权重来自**真实 Route Share 序列反推**（rebuild/fit_competition.py）
     价格 a = −0.562   涨价掉份额（与 API 弹性 1.05~1.10 同量级）
     班次 b = +1.160   班次翻倍份额 +123%
     QSI  c = +0.086/点  QSI 跨 10 点 ≈ 0.86 log-odds
     ⇒ 这解释了此前的疑问：QSI 不是**市场需求**驱动，而是**竞争份额**驱动。
   ============================================================ */
/* ============================================================
   市场级竞争强度标定 —— 全部来自真实 Route Share 反推
   ------------------------------------------------------------
   target       : CA 在该市场的长期均衡份额（真实 contested 季度均值）
   playerOffset : 加在**玩家** logit 上的市场级偏置
       = ln(target/(1−target)) = ln(odds_target)
       含义：CA 的**长期相对竞争位**（ΔV = V_CA − V_竞品 的市场均值）
         正值 = CA 结构性占优（Joplin +0.878 / Armstrong +0.320）
         负值 = CA 结构性劣势（Ellington −0.671 / Fitzgerald −1.317）
       双方 (价格,班次,QSI) 相同时，该偏置直接给出均衡份额。
   ⚠ 这是**均衡位**标定，不是逐期预测：M1 已证明逐期份额无法从
     CA 自身属性预测（样本外 15~30pp），份额波动由观测不到的对手
     行为驱动。沙盘应复现这些「竞争形态」而非逐期轨迹。
   ============================================================ */
export const MARKET_COMPETITION = {
  Joplin     : { target: 0.7065, playerOffset: +0.8782 },   // CA 主导区
  Armstrong  : { target: 0.5793, playerOffset: +0.3198 },   // 均势市场
  Broonzy    : { target: 0.4827, playerOffset: -0.0690 },   // 均势市场
  Lewis      : { target: 0.4495, playerOffset: -0.2028 },   // 均势市场
  Simone     : { target: 0.4417, playerOffset: -0.2343 },   // 均势市场
  // ★ 保留**长期均衡位** target 0.3383（contested 季度真实 Route Share 均值反推）
  //   注：CA 首季（Q4/2027）实测 Route Share 为 48.40%（单季观测，见 baseline_real.json）；
  //       单季观测不替代均衡位——两者皆真，playerOffset 仍取长期值。
  Ellington  : { target: 0.3383, playerOffset: -0.6709 },   // CA 弱势区
  Fitzgerald : { target: 0.2113, playerOffset: -1.3174 },   // CA 极弱势（结构性劣势）
};

export const COMPETITION = {
  priceWeight: -0.562,
  freqWeight: 1.160,
  qsiWeight: 0.086,
  brandWeight: 0,        // δ_i 品牌/枢纽效应（按航司差异化配置）
  freqFloor: 30,         // 班次下限，避免 ln(0)
  fareFloor: 1,
};

/**
 * 市场需求的「竞争口径」：
 * 以市场层面（客座加权均价 + 全网总班次）计算市场需求总量，再按份额分配。
 * @param marketName 市场英文名
 * @param airlines   [{key, fare, freq, qsi, brand?}]
 * @param mult       事件需求乘数
 */
export function allocateMarket(marketName, airlines, mult = 1) {
  const usable = (airlines || []).filter(a => a && a.freq > 0);
  if (!usable.length) {
    return { totalDemand: 0, shares: {}, alloc: {}, potential: 0 };
  }
  // 市场层面：班次加权的均价（近似"市场可见价格水平"）+ 全网总班次
  const F = usable.reduce((a, x) => a + x.freq, 0);
  const pBar = usable.reduce((a, x) => a + x.fare * x.freq, 0) / F;
  const potential = demand(marketName, pBar, F, mult);   // 市场需求总量

  const C = COMPETITION;
  // 市场级品牌优势：对手按标定值获得结构性偏置（玩家为基准 0）
  const mc = MARKET_COMPETITION[marketName] || {};
  const vs = usable.map(a => ({
    key: a.key,
    v: C.priceWeight * Math.log(Math.max(a.fare, C.fareFloor))
       + C.freqWeight * Math.log(Math.max(a.freq, C.freqFloor))
       + C.qsiWeight * (a.qsi || 0)
       + (a.brand !== undefined ? a.brand
          : (a.key === 'player' ? (mc.playerOffset || 0) : 0)),
  }));
  const mx = Math.max(...vs.map(x => x.v));
  const exps = vs.map(x => ({ key: x.key, e: Math.exp(x.v - mx) }));
  const z = exps.reduce((a, x) => a + x.e, 0);

  const shares = {}, alloc = {};
  for (const x of exps) {
    const s = x.e / z;
    shares[x.key] = s;
    alloc[x.key] = potential * s;
  }
  /* 全市场**运营小时集合**（各家的班次起飞时刻所在的小时）
     —— 日内需求池的归一化基准：市场需求是被「实际有航班的小时」消耗的，
        故基准须含全部承运人（含对手）的小时，而非只有本方、更非 24 小时。 */
  const hourSet = new Set();
  for (const a of usable) {
    for (const t of (a.slots || [])) {
      const h = Math.floor(t / 60);
      if (h >= 0 && h <= 23) hourSet.add(h);
    }
  }
  const marketHours = [...hourSet].sort((x, y) => x - y);
  return { totalDemand: potential, shares, alloc, potential, marketFare: pBar, marketFreq: F,
           marketHours };
}
/** 实际承运旅客 = min(供给, 需求) */
/**
 * 日内需求形状（24 小时相对权重，已归一化，和为 1）
 * 市场可覆盖：MARKETS[code].dayShape；缺省用 GM.dayShape。
 */
/** 日内需求原始形状（未归一化，24 项） */
export function dayShapeRaw(marketName) {
  const m = MARKETS[marketName] || {};
  return m.dayShape || GM.dayShape;
}

export function dayShape(marketName) {
  const m = MARKETS[marketName] || {};
  const raw = m.dayShape || GM.dayShape;
  if (raw.length !== 24) {
    throw new Error(`dayShape 必须为 24 项（索引=小时），实际 ${raw.length} 项`);
  }
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map(x => x / sum);
}

export function servedPax(marketName, fare, freq, seats, mult = 1) {
  return Math.min(seats, demand(marketName, fare, freq, mult));
}
/** 由客运收入反解当季执行运价 */
export function impliedFare(revenue, pax) {
  return revenue / (REVENUE_COEF * Math.max(pax, 1));
}

/* ---------- 成本模型（F-01..F-10） ---------- */
export const F01 = (fare, pax) => REVENUE_COEF * fare * pax;
export const F02 = (cargo) => 1033 + 41.33 * cargo;  // ★ 原版 35,135 反推
export const F03 = (pax) => -5198 + 10.66 * pax;
export const F04 = (freq) => 19160 + 642.6 * freq;   // ★ 原版 612,450 反推
export const F05 = (freq) => 33860 + 546.6 * freq;
/* ★ 2026-11-02 口径修正（依据原版 CA Q4/2027 真实损益表逐项对账）：
   原版 F06/F07/F08 都是**公司级**成本：固定项每季计一次，变动项按班次/BH 计入。
   此前这些公式被当作**航线级**调用 → ① 固定成本按航线重复计；② freq 传入季班次
   （540/720）导致 404200-1550×540 → **机组成本为负数**（实测 -$341,941）。
   现拆为固定项 + 变动项；变动项 freq 用**日班次**。
   系数来源：F06 变动项用原版首季反推（误差 -8%）；F08 变动系数 96.44 → 478.5
   （用原版首季 Fuel $1,929,780 反推，误差 0.01%）；F07 变动项待多季回归（标注）。 */
export const F06_FIXED = 404200;
export const F06_VAR = (freqDay, bh) => 221.7 * bh;      // ★ 原版首季 689,583 反推
export const F07_FIXED = 313200;
export const F07_VAR = (freqDay, bh) => 591.6 * bh;      // ★ 原版首季 1,074,352 反推
export const F08_FIXED = 0;                       // ★ 原版首季 Fuel 与加仑数自洽 → 无固定项
export const F08_VAR = (bh, price) => 624.6 * bh * price;
/** 真实加仑数（不随结算价变化）—— 套保下反推加仑必须用它，否则碳成本失真 */
export const F08_GAL = (bh) => 624.6 * bh;
/* 兼容旧调用（仍按公司级语义） */
export const F06 = (freqDay, bh) => F06_FIXED + F06_VAR(freqDay, bh);
export const F07 = (freqDay, bh) => F07_FIXED + F07_VAR(freqDay, bh);
export const F08 = (bh, price) => F08_FIXED + F08_VAR(bh, price);
export const F09 = (ask) => 19108 + 0.002187 * ask;   // ★ 原版 244,125 反推
export const F10 = (ask) => 133649 + 0.009166 * ask;   // ★ 原版 1,130,112 反推

/* 辅助：按 MTOW 与官方费率表估算（用于新机型/新市场） */
export function landingFee(marketName, freq) {
  const m = MARKETS[marketName];
  if (!m) return F05(freq);
  return m.landing_fee * 53.13 * freq;  // ★ 55→53.13（原版首季 497,250 反推）
}
export function aircraftHandling(freq) { return F04(freq); }
/* ★ 导航费改为按 RPK 计（pax × 航段公里）——原版 CA 首季 294,781 反推 → 0.0056657 /RPK-km */
export function navigationCost(pax, km) { return pax * km * 0.0056657; }
export function trafficHandling(marketName, pax) {
  const m = MARKETS[marketName];
  return (m ? m.traffic_handling_fee : 10) * pax * 0.9753;   // ★ 原版 588,240 反推
}
export function cargoHandling(cargo) { return F02(cargo); }

/* SAF / 碳 */
export function safCost(fuel, pct = 0.05, mult = 2.5) { return fuel * pct * mult; }
/**
 * 碳成本 = 燃油加仑数 × 每加仑碳排放(t) × 碳价($/t)
 * 口径来源：Reports-ECONOMICS-ROUTE ECONOMICS（Q4/2027）两航线独立交叉验证
 *   SIM 314,325 gal → $179,358（0.57061 $/gal）
 *   ETN 489,750 gal → $279,485（0.57067 $/gal）
 *   基准碳价 $2,577/t ⇒ 0.5707/2577 = 0.00022146 t/gal
 * ⚠ 旧实现按旅客数计量，Q4/2027 实算 $2,651 vs 原版 $458,843（差约 173 倍），已修正
 */
export function carbonCost(fuelGallons, pricePerTonne, index = 1) {
  return fuelGallons * CARBON.t_per_gallon * pricePerTonne * (index || 1);
}

/* ---------- 折旧 / 利息 / 保险 ---------- */
export function annualDepreciation(price) {
  const residual = price * GM.residual_value / 100;
  return (price - residual) / GM.depreciation_years;
}
export function quarterlyDepreciation(price) { return annualDepreciation(price) / 4; }
export function quarterlyInsurance(price) { return price * GM.insurance_rate / 100 / 4; }
export function quarterlyInterest(price, rate = GM.interest_rate) {
  return price * rate / 100 / 4;
}

/* ---------- 间接成本 ---------- */
export function passengerServices(revenue) { return 90799 + 0.03843 * revenue; }   // ★ 原版 623,260 反推
export function ticketingSales(bh) { return 30287 + 232.4 * bh; }   // ★ 原版 359,600 反推
export function generalAdmin(ask) { return F10(ask); }
export function cargoOverheads(ask) { return F09(ask); }

/* ---------- 辅助计算 ---------- */
/** 可用座公里 (ASK, 绝对值) */
export function askAbs(seats, freq, sectorKm) {
  // 可用座公里 = 座位 × 频次 × 航段公里
  // 验证: Lewis Q2/2029 -> 100座 × 412班 × 415km = 17.1MM (报表 ASK=17.1MM ✓)
  return seats * freq * sectorKm;
}
/** 客座率 */
export function loadFactor(rpk, ask) { if (!ask) return 0; return Math.max(0, Math.min(1, rpk / ask)); }
/** 收益客公里 */
export function rpkAbs(pax, sectorKm) { return pax * sectorKm; }
/** 某航线最优运价 (拉弗曲线顶点附近) */
export function optimalFare(marketName, freq, askSeats, mult = 1) {
  const m = MARKETS[marketName] || {};
  const eps = 1 + 0.05 * (m.elasticity || 1);
  const K = DEMAND_K[marketName];
  if (!K) return m.guide_fare || 200;
  // 目标：客座率 95% 时的运价
  const target = askSeats * 0.95;
  const d = demand(marketName, 1, freq, mult);
  // demand(fare) = D0 * (FARE_REF/fare)^eps  => fare = FARE_REF*(D0/target)^(1/eps)
  return FARE_REF * Math.pow(d / Math.max(target, 1e-9), 1 / eps);
}
