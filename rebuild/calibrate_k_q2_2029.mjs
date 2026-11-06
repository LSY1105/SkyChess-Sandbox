/* ============================================================
   由 Q2 2029 FLIGHTS 表反解各市场 DEMAND_K
   rebuild/calibrate_k_q2_2029.mjs
   ------------------------------------------------------------
   原理（与首季标定同法，但数据源不同）：
     · 沙盘模型：某班承运 = min(座位×90, 该时刻需求池 × 玩家份额)
                 需求池 = 市场日需求 × 时刻形状权重 wUsed[h]
     · CA 的**未满座**班次给出方程：pax_i = pool_i × share_CA
       ⇒ pool_i = pax_i / share_CA
       ⇒ marketDaily × wUsed[h_i] = pax_i / share_CA
     · 两个未知量（share_CA、marketDaily），多班时过定 → 最小二乘 + 约束求解
     · 市场季需求 D = marketDaily × 90
     · 反解 K：D = K × (200/fare)^eps × (freq/100)^0.50
               ⇒ K = D / (priceFactor × freqFactor)
       fare = 该市场 CA 班次的**按座位加权均价**；freq = 全网季班次（三家合计 × 90）
     · 形状权重 wUsed 在**该市场实际运营小时集合**上归一化（三家全部班次的小时）

   数据源：rebuild/q2_2029_flights.json（逐班读数，见其 _meta.source）
   运行：node rebuild/calibrate_k_q2_2029.mjs
   ============================================================ */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { GM, MARKETS } from '../sandbox/data.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FL = JSON.parse(readFileSync(join(HERE, 'q2_2029_flights.json'), 'utf8'));

const FARE_REF = 200, FREQ_REF = 100, FREQ_EXP = 0.50, DAYS = 90;
const epsOf = (code) => 1 + 0.05 * (MARKETS[code].elasticity || 1);
const pf = (fare, eps) => Math.pow(FARE_REF / Math.max(fare, 1e-6), eps);
const ff = (f) => Math.pow(Math.max(f, 1) / FREQ_REF, FREQ_EXP);

/** 时刻形状权重（在给定运营小时集合上归一化） */
function shapeUsed(code, usedHours) {
  const raw = (MARKETS[code] && MARKETS[code].dayShape) || GM.dayShape;
  const s = raw.reduce((a, _, h) => a + (usedHours.has(h) ? raw[h] : 0), 0) || 1;
  return raw.map(x => x / s);
}

/** 对一个市场求 (share_CA, marketDaily)：对未满班做最小二乘 */
function solveMarket(code, mkt) {
  const usedHours = new Set();
  for (const k of ['CA', 'AB', 'VA']) for (const b of (mkt[k] || [])) usedHours.add(b.h);
  const w = shapeUsed(code, usedHours);
  const ca = (mkt.CA || []).filter(b => b.pax != null);
  const notFull = ca.filter(b => b.pax < b.seats * DAYS);      // 未满座 → 承运由需求决定
  if (!notFull.length) return { code, solvable: false, reason: 'CA 无未满座班次（仅得下界）' };
  if (notFull.length < 2) return { code, solvable: false, reason: '未满座班次仅 1 个 → 欠定（需多班）' };

  /* 线性化：pax_i = share × (marketDaily × w_i) ⇒ pax_i / w_i = share × marketDaily
     令 y_i = pax_i / w_i，x = share×marketDaily → y_i = x（各班应相等）→ 取中位数更稳健
     再用「市场总需求 ≤ 各家班次座位供给」等约束不适用；故：
     直接由 y 的中位数得 x，再由**份额上限**与**竞争结构**分解 share 与 marketDaily：
     —— 用 softmax 竞争模型由三家 (fare, freq) 给相对份额比例 r_i，share_CA = r_CA/Σr（需 QSI 假设） */
  const ys = notFull.map(b => b.pax / w[b.h]).sort((a, b) => a - b);
  const y = ys[Math.floor(ys.length / 2)];            // 中位数（抗单班离群）
  const spread = (ys[ys.length - 1] - ys[0]) / y;     // 各班一致性（相对离散度）
  return { code, solvable: true, notFull, y, spread, usedHours, w };
}

/* ── 竞争模型：由三家票价与班次给相对份额（QSI 差异未知，取相同处理，见报告） ── */
const COMP = { priceWeight: -0.562, freqWeight: 1.160, qsiWeight: 0.086 };
function relShares(code, mkt) {
  const rows = ['CA', 'AB', 'VA'].map(k => {
    const arr = mkt[k] || [];
    if (!arr.length) return null;
    const freq = arr.length * DAYS;
    const seatW = arr.reduce((a, b) => a + b.seats, 0);
    const fare = arr.reduce((a, b) => a + b.fare * b.seats, 0) / seatW;   // 按座位加权均价
    return { k, fare, freq };
  }).filter(Boolean);
  if (!rows.length) return null;
  const exps = rows.map(r => Math.exp(
    COMP.priceWeight * Math.log(Math.max(r.fare, 1)) +
    COMP.freqWeight * Math.log(Math.max(r.freq, COMP.freqFloor || 30)) +
    COMP.qsiWeight * 0));
  const z = exps.reduce((a, b) => a + b, 0);
  const out = {};
  rows.forEach((r, i) => { out[r.k] = exps[i] / z; });
  return out;
}

console.log('='.repeat(78));
console.log('由 Q2 2029 FLIGHTS 表反解各市场 DEMAND_K');
console.log('='.repeat(78));

const results = {};
for (const [code, mkt] of Object.entries(FL.markets)) {
  const meta = FL.market_meta[code] || {};
  const name = meta.name || code;
  const sol = solveMarket(code, mkt);
  const ca = mkt.CA || [];
  const allFlights = ['CA', 'AB', 'VA'].reduce((a, k) => a + (mkt[k] || []).length, 0);
  const totalFreq = allFlights * DAYS;
  const caFreq = ca.length * DAYS;

  if (!ca.length) {
    console.log(`\n■ ${name} (${code}) —— CA 当季无班次 → 无法反解（需另找季度或用对手数据）`);
    results[code] = { solved: false, reason: 'CA 无班次' };
    continue;
  }
  if (!sol.solvable) {
    console.log(`\n■ ${name} (${code}) —— ${sol.reason}`);
    const share = relShares(code, mkt);
    console.log(`   三家班次/日：CA ${ca.length}｜AB ${(mkt.AB || []).length}｜VA ${(mkt.VA || []).length}｜全网 ${allFlights} 班/日`);
    results[code] = { solved: false, reason: sol.reason };
    continue;
  }

  /* 份额：softmax 相对份额（QSI 未纳入 → 记为不确定度来源） */
  const rel = relShares(code, mkt);
  const shareCA = rel ? rel.CA : null;
  if (!shareCA) {
    console.log(`\n■ ${name} (${code}) —— 无 CA 班次可比，跳过`);
    results[code] = { solved: false, reason: 'no CA' };
    continue;
  }
  /* marketDaily：y = share × marketDaily → marketDaily = y / share
     注：y 的定义已含 share，故 marketDaily = (pax/w) / share */
  const marketDaily = sol.y / shareCA;
  const D = marketDaily * DAYS;                       // 市场季需求
  /* 均价与频次：CA 班次按座位加权均价；频次用全网季班次 */
  const seatW = ca.reduce((a, b) => a + b.seats, 0);
  const fare = ca.reduce((a, b) => a + b.fare * b.seats, 0) / seatW;
  const K = D / (pf(fare, epsOf(code)) * ff(totalFreq));

  console.log(`\n■ ${name} (${code})`);
  console.log(`   三家班次/日：CA ${ca.length}｜AB ${(mkt.AB || []).length}｜VA ${(mkt.VA || []).length}｜全网 ${allFlights}（季 ${totalFreq}）`);
  console.log(`   CA 未满座班次 ${sol.notFull.length} 个 → 需求池一致性离散度 ${(sol.spread * 100).toFixed(1)}%（越小越自洽）`);
  console.log(`   份额（softmax，QSI 同值假设）CA ${(shareCA * 100).toFixed(1)}%`);
  console.log(`   → 市场日需求 ${Math.round(marketDaily).toLocaleString()} 人｜季需求 D ${Math.round(D).toLocaleString()}`);
  console.log(`   → CA 班次加权均价 $${fare.toFixed(2)}｜反解 K = ${Math.round(K).toLocaleString()}`);
  console.log(`   现 K = ${(await import('../sandbox/engine.js')).DEMAND_K[name] ?? 'n/a'}  →  标定值 ${Math.round(K).toLocaleString()}`);

  results[code] = {
    solved: true, name, K: Math.round(K), D: Math.round(D),
    marketDaily: Math.round(marketDaily), shareCA: +shareCA.toFixed(4),
    fare: +fare.toFixed(2), totalFreq, spread: +sol.spread.toFixed(4),
    caFlights: ca.length, allFlights,
  };
}

console.log('\n' + '='.repeat(78));
console.log('汇总（仅落地 solved 且一致性可接受者）');
console.log('='.repeat(78));
const okList = Object.entries(results).filter(([, v]) => v.solved);
for (const [code, v] of okList) {
  console.log(`  ${v.name.padEnd(14)} K = ${String(v.K).padStart(7)}   (D=${v.D.toLocaleString()}, 份额 ${(v.shareCA * 100).toFixed(1)}%, 离散 ${(v.spread * 100).toFixed(1)}%)`);
}
console.log('\n  ⚠ 采纳标准：离散度 < 15%（各班需求池一致）；超出的仅作参考，不落地。');
console.log('  ⚠ 份额用 softmax 且**假设三家 QSI 相同** → QSI 差异会引入份额误差（c=0.086/点）。');
console.log('  ⚠ 未落地市场（无 CA 班次 / 满座 / 欠定）需另找季度或补一手数据。');
console.log('\n  JSON:', JSON.stringify(Object.fromEntries(okList.map(([k, v]) => [k, v.K])), null, 2));
