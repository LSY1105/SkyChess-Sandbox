/* ============================================================
   需求总量标定（针对沙盘 JS 引擎）  rebuild/calibrate_demand_js.mjs
   ------------------------------------------------------------
   目的：把沙盘的市场需求总量标定到**原版真实量级**。
   背景：sim3 首季实测 → 沙盘旅客 19,066 vs 原版 61,900（ASK 相当），
        即沙盘需求总量与原版存在系统性偏差（SIM 高、ETN 低，方向相反）。

   方法：
     ① 用**唯一完全自洽的观测**——原版 CA Q4/2027 首季（Reports-ROUTE METRICS +
        Reports-ECONOMICS-ROUTE ECONOMICS）——构造同等的沙盘场景；
     ② 反解各市场 K：D_market = K × (200/fare)^eps × (freq/100)^0.5
        ⇒ K = D / (priceFactor × freqFactor)；
     ③ 对份额：用真实 Route Share 反解 MARKET_COMPETITION.playerOffset
        = ln(target/(1−target))；
     ④ 留一市场交叉验证：用 A 市场标定的**缩放因子**去预测 B 市场，
        检验 K 的结构是否只是整体偏移（若能预测 ⇒ 只需缩放；不能 ⇒ 需逐市场重标）。

   真实观测（一手材料）：
     主截图/Reports(VIEW REPORTS)-ROUTE METRICS.jpg
     主截图/Reports(VIEW REPORTS)-ECONOMICS-ROUTE ECONOMICS.jpg
   运行：node rebuild/calibrate_demand_js.mjs
   ============================================================ */
import { GM, MARKETS } from '../sandbox/data.js';
import * as E from '../sandbox/engine.js';

const FARE_REF = 200.0, FREQ_REF = 100.0, FREQ_EXP = 0.50;

/* ── 原版真实观测（Q4/2027，CA 队首季）── */
const REAL = {
  Simone: {
    code: 'SIM', playerFare: 120, playerFreq: 540,        // 540 班/季 = 6 班/日
    marketFreq: 540, playerShare: 1.0,                    // 独占
    ask: 28.4e6, rpk: 15.4e6, lf: 0.543, pax: 29300,
    acSeats: 100, km: 525,                                // APT100 飞 SIM
  },
  Ellington: {
    code: 'ETN', playerFare: 250, playerFreq: 360,        // CA 4 班/日
    marketFreq: 720, playerShare: 0.4840,                 // Route Share 48.40%
    ask: 65.8e6, rpk: 37.5e6, lf: 0.569, pax: 32600,     // 玩家口径
    acSeats: 159, km: 1150,                               // G160 飞 ETN
  },
};
// 市场总需求（由玩家口径还原：LF<100% 时 D=pax 精确成立）
for (const m of Object.values(REAL)) {
  m.marketPax = m.playerShare >= 0.999 ? m.pax : Math.round(m.pax / m.playerShare);
  m.impliedD = m.marketPax;                               // 市场季需求
}

const epsOf = (code) => 1 + 0.05 * ((MARKETS[code] && MARKETS[code].elasticity) || 1);
const pf = (fare, eps) => Math.pow(FARE_REF / Math.max(fare, 1e-6), eps);
const ff = (freq) => Math.pow(Math.max(freq, 1) / FREQ_REF, FREQ_EXP);

function solveK(code, fare, marketFreq, D) {
  return D / (pf(fare, epsOf(code)) * ff(marketFreq));
}

console.log('='.repeat(76));
console.log('需求总量标定（反解 K）—— 观测：原版 CA Q4/2027 首季');
console.log('='.repeat(76));

const solved = {};
for (const [name, r] of Object.entries(REAL)) {
  const Knew = solveK(r.code, r.playerFare, r.marketFreq, r.impliedD);
  const Kold = E.DEMAND_K[name];
  solved[name] = { Knew, Kold, ratio: Knew / Kold };
  console.log(`\n■ ${name} (${r.code})`);
  console.log(`   真实：班次 ${r.marketFreq}/季（玩家 ${r.playerFreq}）｜玩家价 $${r.playerFare}`
    + `｜份额 ${(r.playerShare * 100).toFixed(2)}%｜玩家旅客 ${r.pax.toLocaleString()}`
    + `｜市场旅客 ${r.marketPax.toLocaleString()}`);
  console.log(`   真实 ASK ${(r.ask / 1e6).toFixed(1)}MM｜RPK ${(r.rpk / 1e6).toFixed(1)}MM`
    + `｜LF ${(r.lf * 100).toFixed(1)}%`);
  // ASK 校验：班次已是「季班次」，不再乘 90 天
  const askCalc = r.playerFreq * r.acSeats * r.km;
  console.log(`   ASK 校验：${r.playerFreq} 班 × ${r.acSeats} 座 × ${r.km}km`
    + ` = ${(askCalc / 1e6).toFixed(2)}MM vs 真实 ${(r.ask / 1e6).toFixed(1)}MM`
    + (Math.abs(askCalc - r.ask) / r.ask < 0.02 ? '  ✓ 配置复原正确' : '  ✗ 配置不符'));
  console.log(`   → 现 K=${Kold}  反解 K=${Knew.toFixed(0)}  缩放 ${(Knew / Kold).toFixed(3)}×`);
}

console.log('\n' + '='.repeat(76));
console.log('留一市场交叉验证：用一个市场的缩放因子去预测另一个市场');
console.log('='.repeat(76));
{
  const [a, b] = Object.entries(REAL);
  const [an, bn] = [a[0], b[0]];
  for (const [src, dst] of [[an, bn], [bn, an]]) {
    const R = REAL[dst];
    const Kpred = E.DEMAND_K[dst] * solved[src].ratio;
    const Dpred = Kpred * pf(R.playerFare, epsOf(R.code)) * ff(R.marketFreq);
    const err = (Dpred - R.impliedD) / R.impliedD;
    console.log(`  用 ${src} 的缩放 ${solved[src].ratio.toFixed(3)}× 预测 ${dst}：`
      + `D ${Dpred.toFixed(0)} vs 真实 ${R.impliedD.toFixed(0)}  误差 ${(err * 100).toFixed(1)}%`);
  }
  console.log('  → 误差大 ⇒ K 的**结构**（各市场相对大小）有偏，不能只做全局缩放；需逐市场重标。');
}

console.log('\n' + '='.repeat(76));
console.log('份额校准（由真实 Route Share 反解 playerOffset）');
console.log('='.repeat(76));
const shareFix = {};
for (const [name, r] of Object.entries(REAL)) {
  const t = r.playerShare;
  const off = Math.log(t / (1 - t));
  shareFix[name] = { target: t, offset: off };
  const cur = E.MARKET_COMPETITION[name];
  console.log(`  ${name}: 真实份额 ${(t * 100).toFixed(2)}% → playerOffset ${off.toFixed(4)}`
    + `（现值 ${cur ? cur.playerOffset.toFixed(4) : 'n/a'} → target ${cur ? cur.target : 'n/a'}）`);
}

console.log('\n' + '='.repeat(76));
console.log('结论与建议');
console.log('='.repeat(76));
console.log('  ① 本标定只覆盖有**完全自洽观测**的两个市场（SIM / ETN，均含机型、班次、票价、ASK、RPK、LF、旅客、份额）。');
console.log('  ② 其余 5 个市场（Armstrong / Broonzy / Joplin / Lewis / Fitzgerald）缺少同时具备');
console.log('     「机型×航线对应 + 班次 + 票价 + LF」的自洽观测 → **暂不重标**，沿用现值并标注"未标定"。');
console.log('  ③ 沙盘的沙盘结构性问题：需求总量与原版存在方向相反的偏差（SIM 高、ETN 低），');
console.log('     说明 DEMAND_K 的**相对结构**需重建 —— 单靠两市场反解不足，需补齐观测或回到 rebuild/ 管线重拟合。');
console.log('\n  建议的下一步（按性价比排序）：');
console.log('    A. 用 CA/VA **各季度的分航线 LF + 票价 + 班次**补齐观测，');
console.log('       前提是从官方 PPT/报告拿到每季度的**机队-航线对应表**（缺失则 ASK 无法还原）；');
console.log('    B. 退回 rebuild/ 管线，用 Route Metrics 的 ASK/RPK/LF 三列直接对**市场总量**做回归，');
console.log('       目标量纲：市场季需求 = ASK × LF（LF<100% 精确成立）；');
console.log('    C. 在 A/B 完成前，沙盘的**相对规模**（三队同表竞争）仍可用，绝对值不可用于对账原版。');
console.log('\n  标定结果（供手工应用或由脚本写入）：');
console.log('   ' + JSON.stringify({
  demandK: Object.fromEntries(Object.entries(solved).map(([k, v]) => [k, Math.round(v.Knew)])),
  marketShareTargets: Object.fromEntries(Object.entries(shareFix).map(([k, v]) => [k, v.target])),
}, null, 2).replace(/\n/g, '\n   '));
