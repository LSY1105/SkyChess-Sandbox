/* ============================================================
   M3：把 AI 竞品标定到「反解出的真实竞品效用轨迹」
   ------------------------------------------------------------
   ★ 目标
     让沙盘里 AI 竞品**生成的**竞品效用 V_rival_gen，
     逼近从真实 Route Share 反解出的 V_rival_real（rebuild/competition-rivals.json）。

   ★ 为什么不是逐点拟合
     M1 已证明：逐期份额无法预测（样本外 24pp），因为对手行为本身不可观测。
     → 标定对象是**市场级结构**（哪些市场对手强、弱、多强），
       验证用 **留一市场**（hold-out market）协议，而不是留一季。

   ★ 标定参数（全局，两家竞品共享或各自一组）
     kPrice      竞品定价 = 指导价 × kPrice
     followRatio 跟价系数（玩家更便宜时）
     qsiPrice    QSI → 提价幅度
     flightsPerAc 每机每日的目标班次数
     qsiOffset   竞品 QSI 相对 CA 的偏移

   ★ 验证协议
     训练：在 N−1 个市场上拟合参数
     测试：在留出的市场上，比较 V_rival_gen 与 V_rival_real 的误差
     ⇒ 这是**首次**对竞争机制做市场级样本外检验
   ============================================================ */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as E from './engine.js';
import { MARKETS, GM } from './data.js';
import { initCompetitors, stepCompetitors } from './competitors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RIVALS = JSON.parse(readFileSync(
  join(HERE, '..', 'rebuild', 'competition-rivals.json'), 'utf8'));

/* ── 真实反解的竞品效用序列（按市场）── */
const REAL = {};
for (const x of RIVALS.implied_rival_utility) {
  (REAL[x.market] = REAL[x.market] || []).push(x);
}
for (const m of Object.keys(REAL)) REAL[m].sort((a, b) => a.quarter.localeCompare(b.quarter));

/* ── 英文名 → 市场代码（沙盘 MARKETS 用 code）── */
const NAME2CODE = {};
for (const c of Object.keys(MARKETS)) NAME2CODE[MARKETS[c].name] = c;

/* ── 各市场的真实长期均衡份额（标定目标）── */
const TARGET = {};
for (const [m, c] of Object.entries(JSON.parse(readFileSync(
  join(HERE, '..', 'rebuild', 'competition-calibration.json'), 'utf8')).market_calibration)) {
  TARGET[m] = c.target_share;
}

/* ── CA 在各市场的历史常态（用于构造参照局面）── */
const CA_STATE = {};
for (const m of Object.keys(REAL)) {
  const seq = REAL[m];
  CA_STATE[m] = {
    fare: seq.reduce((a, x) => a + x.fare_ca, 0) / seq.length,
    freq: seq.reduce((a, x) => a + x.freq_ca, 0) / seq.length,
    qsi: seq.reduce((a, x) => a + x.qsi_ca, 0) / seq.length,
  };
}

/* ── 竞品参数（待标定）── */
const PARAMS = {
  kPrice: 1.05,
  followRatio: 0.98,
  qsiPrice: 0.03,
  flightsPerAc: 3,
  qsiOffset: 0,
};

/* ── 构造一个参照局面：CA 按该市场的历史常态经营，竞品按当前参数决策 ── */
function buildScene(marketName, params, fleetSize = 6) {
  const market = NAME2CODE[marketName];
  const st = CA_STATE[marketName];
  const g = {
    turn: 1, qsi: st.qsi, demandMult: {}, routes: [], schedules: [],
    competitors: [], assets: [], investments: [], investmentsAnnual: [], leases: [],
    cash: 5_000_000, fuelPrice: 2.4, carbonPrice: 22, interestRate: 5,
    connectingDemand: 2, history: [], log: [],
  };
  // 玩家（CA）在该市场：历史运价与班次
  g.routes.push({ code: market, fare: st.fare, openedTurn: 0, etopsPaid: false });
  const perDay = Math.max(1, Math.round(st.freq / 90));
  for (let i = 0; i < perDay; i++) {
    g.schedules.push({ acId: 1, code: market, seats: 159, bh: MARKETS[market].bh,
      cargoCap: 0, departure: ['06:00', '12:00', '18:00'][i % 3], flightNo: `CA${i}` });
  }
  // 竞品（一家，fleetSize 架）
  const ac = [];
  for (let i = 0; i < fleetSize; i++) ac.push({ id: i + 1, seats: 159 });
  g.competitors = [{
    code: 'AB', name: 'Air Ballistic', qsi: st.qsi + params.qsiOffset, cash: 5_000_000,
    routes: [{ code: market, fare: MARKETS[market].guide_fare, openedTurn: 0 }],
    aircraft: ac, schedules: [], r: () => 0.5, aggression: 0,
  }];
  return g;
}

/* ── 用当前参数跑一次 AI 决策，取其生成的竞品效用 ── */
const CW = E.COMPETITION;   // 直接复用引擎权重，避免两处漂移

function rivalUtility(marketName, params) {
  const market = NAME2CODE[marketName];
  const g = buildScene(marketName, params);
  const c = g.competitors[0];
  const before = c.routes[0].fare;
  // 注入标定后的定价/班次规则（与 competitors.js 的默认策略同构，但参数可调）
  const m = MARKETS[market];
  const guide = m.guide_fare || 150;
  let target = guide * params.kPrice;
  const pr = g.routes.find(x => x.code === market);
  if (pr && pr.fare < before * 0.97) target = pr.fare * params.followRatio;
  target *= (1 + (c.qsi - 4) * params.qsiPrice);
  c.routes[0].fare = Math.round(target);
  const perDay = Math.max(1, params.flightsPerAc);
  for (let i = 0; i < perDay; i++) {
    c.schedules.push({ acId: (i % c.aircraft.length) + 1, code: market,
      seats: c.aircraft[i % c.aircraft.length].seats, bh: m.bh * 2, cargoCap: 0,
      departure: ['06:00', '10:00', '14:00', '18:00', '22:00'][i % 5],
      flightNo: `AB${i}` });
  }
  const al = E.allocateMarket(m.name, [
    { key: 'player', fare: g.routes[0].fare, freq: g.schedules.length * 90, qsi: g.qsi },
    { key: 'AB', fare: c.routes[0].fare, freq: c.schedules.length * 90, qsi: c.qsi },
  ], 1);
  const A = CW.priceWeight, B = CW.freqWeight, C = CW.qsiWeight;
  const p = c.routes[0].fare, f = c.schedules.length * 90, q = c.qsi;
  return A * Math.log(Math.max(p, 1)) + B * Math.log(Math.max(f, 30)) + C * q;
}

/* ── 目标函数：生成效用 vs 真实反解效用 ── */
/**
 * 目标函数：**均衡份额误差**（单位 pp）。
 *
 * 为什么不用效用 RMSE：
 *   市场级结构已编码在 playerOffset（加在玩家 logit 上），
 *   所以"真实竞品效用"与"沙盘竞品效用"不在同一基准上，
 *   直接比效用会重复计入市场结构。
 *   ⇒ 直接比较**最终份额**：玩家按该市场的历史常态经营时，
 *     沙盘产生的均衡份额应等于真实数据的长期均衡份额。
 */
function loss(markets, params) {
  let s = 0, n = 0;
  for (const m of markets) {
    const g = equilibriumShare(m, params);
    const tgt = TARGET[m];
    s += (g - tgt) ** 2; n++;
  }
  return Math.sqrt(s / Math.max(n, 1));
}

/** 玩家按该市场历史常态经营时，沙盘给出的均衡份额 */
function equilibriumShare(marketName, params) {
  const market = NAME2CODE[marketName];
  const st = CA_STATE[marketName];
  const m = MARKETS[market];
  // 竞品按标定后的策略定价与排班
  const c = {
    qsi: st.qsi + params.qsiOffset,
    routes: [{ code: market, fare: m.guide_fare || 150 }],
    aircraft: [{ id: 1, seats: 159 }], schedules: [],
  };
  let target = (m.guide_fare || 150) * params.kPrice;
  if (st.fare < c.routes[0].fare * 0.97) target = st.fare * params.followRatio;
  target *= (1 + (c.qsi - 4) * params.qsiPrice);
  c.routes[0].fare = Math.round(target);
  const perDay = Math.max(1, params.flightsPerAc);
  const fRival = perDay * 90;
  // 玩家侧：历史常态运价与班次
  const fPlayer = Math.max(1, Math.round(st.freq / 90)) * 90;
  const al = E.allocateMarket(m.name, [
    { key: 'player', fare: st.fare, freq: fPlayer, qsi: st.qsi },
    { key: 'AB', fare: c.routes[0].fare, freq: fRival, qsi: c.qsi },
  ], 1);
  return al.shares.player;
}

/* ── 坐标下降标定 ── */
function calibrate(markets) {
  const p = { ...PARAMS };
  let cur = loss(markets, p);
  const grids = {
    kPrice: [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15],   // 定价约束在合理带内（±15%）
    followRatio: [0.9, 0.95, 0.98, 1.0],
    qsiPrice: [0.0, 0.01, 0.02, 0.03, 0.05, 0.08],
    flightsPerAc: [1, 2, 3, 4, 5, 6, 8],
    qsiOffset: [-4, -3, -2, -1, 0, 1, 2],
  };
  for (let it = 0; it < 6; it++) {
    let improved = false;
    for (const key of Object.keys(grids)) {
      for (const v of grids[key]) {
        const t = { ...p, [key]: v };
        const l = loss(markets, t);
        if (l < cur - 1e-9) { p[key] = v; cur = l; improved = true; }
      }
    }
    if (!improved) break;
  }
  return [p, cur];
}

console.log('='.repeat(88));
console.log('★ M3：AI 竞品标定到真实竞品效用轨迹');
console.log('='.repeat(88));
const markets = Object.keys(REAL);
console.log(`  真实反解点 ${RIVALS.implied_rival_utility.length} 个，市场 ${markets.length} 个：`);
for (const m of markets) {
  const vs = REAL[m].map(x => x.v_rival.toFixed(2)).join(', ');
  console.log(`    ${m.padEnd(11)} (${REAL[m].length}点) V_竞品 = ${vs}`);
}
console.log();

// ── 全样本标定 ──
const [pAll, lAll] = calibrate(markets);
console.log('  【全样本标定（对照）】');
console.log(`    参数: ${JSON.stringify(pAll)}`);
console.log(`    均衡份额 RMSE = ${(lAll*100).toFixed(2)} pp`);
console.log();

// ── 留一市场样本外 ──
console.log('  【留一市场样本外检验】（首次对竞争机制做市场级样本外检验）');
console.log('  ' + '留出市场'.padEnd(14) + '训练RMSE'.padStart(10)
  + '测试RMSE'.padStart(12) + '劣化'.padStart(12));
const outs = [], ins = [];
for (const m of markets) {
  const tr = markets.filter(x => x !== m);
  const [p, lIn] = calibrate(tr);
  const lOut = loss([m], p);
  ins.push(lIn); outs.push(lOut);
  console.log('  ' + m.padEnd(14) + (lIn*100).toFixed(2).padStart(10)
    + (lOut*100).toFixed(2).padStart(12) + ((lOut - lIn)*100).toFixed(2).padStart(12));
}
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log();
console.log(`  训练 RMSE 中位 = ${(med(ins)*100).toFixed(2)} pp   测试 RMSE 中位 = ${(med(outs)*100).toFixed(2)} pp`);
console.log(`  （对照：自由截距模型的份额层面样本外误差 24pp）`);
console.log();

// ── 生成 vs 真实 对照表 ──
console.log('  【标定后：各市场均衡份额 vs 真实目标】');
console.log('  ' + 'market'.padEnd(11) + 'quarter'.padEnd(9) + '目标份额'.padStart(10)
  + '生成份额'.padStart(10) + '误差pp'.padStart(9));
let tot = 0, cnt = 0;
for (const m of markets) {
  for (const x of REAL[m]) {
    const g = equilibriumShare(m, pAll);
    const e = (g - TARGET[m]) * 100;
    tot += e * e; cnt++;
    console.log('  ' + m.padEnd(11) + x.quarter.padEnd(9)
      + (TARGET[m] * 100).toFixed(1).padStart(10) + (g * 100).toFixed(1).padStart(10)
      + e.toFixed(2).padStart(9));
  }
}
console.log();
console.log(`  整体 RMSE = ${Math.sqrt(tot / cnt).toFixed(2)} pp（份额）`);
console.log(`  （对照：份额层面的自由截距模型样本外误差 24pp）`);

const out = {
  'note': 'M3 AI 竞品标定到真实反解效用轨迹',
  'params_in_sample': pAll,
  'rmse_in_sample': lAll,
  'holdout_market_rmse_median': med(outs),
  'holdout_market_rmse': outs,
  'residual_baseline': RIVALS.residual_rms,
};
console.log();
import { writeFileSync } from 'fs';
writeFileSync(join(HERE, 'competition-calibration-ai.json'),
  JSON.stringify(out, null, 2), 'utf8');
console.log('  → sandbox/competition-calibration-ai.json');
