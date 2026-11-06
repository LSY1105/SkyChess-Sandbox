/* ============================================================
   需求总量标定 回归测试   rebuild/../sandbox/demandtest.mjs
   ------------------------------------------------------------
   断言：
     CAL   标定后的 K 与份额值固定（防止被无意改动）
     ASK   真实首季配置可复原原版 ASK（机型×班次×距离）
     DEM   标定后引擎算出的市场季需求 = 原版真实值（误差 <0.1%）
     GAP   留一市场交叉验证误差（量化"K 相对结构待重建"，作为已知缺口的护栏）
   运行：node demandtest.mjs
   ============================================================ */
import { MARKETS } from './data.js';
import * as E from './engine.js';
import * as G from './game.js';

let pass = 0, fail = 0;
const ok = (c, n, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}${e ? '  ' + e : ''}`); }
  else { fail++; console.log(`  ✗ ${n}${e ? '  ' + e : ''}`); }
};
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 58 - s.length))}`);

const FARE_REF = 200, FREQ_REF = 100, FREQ_EXP = 0.50;
const epsOf = (code) => 1 + 0.05 * (MARKETS[code].elasticity || 1);
const pf = (fare, eps) => Math.pow(FARE_REF / Math.max(fare, 1e-6), eps);
const ff = (f) => Math.pow(Math.max(f, 1) / FREQ_REF, FREQ_EXP);

/* ── 原版真实观测（Q4/2027 CA 首季）── */
const REAL = {
  Simone: { code: 'SIM', fare: 120, mFreq: 540, pFreq: 540, share: 1.0,
            ask: 28.4e6, rpk: 15.4e6, lf: 0.543, pax: 29300, seats: 100, km: 525 },
  Ellington: { code: 'ETN', fare: 250, mFreq: 720, pFreq: 360, share: 0.4840,
               ask: 65.8e6, rpk: 37.5e6, lf: 0.569, pax: 32600, seats: 159, km: 1150 },
};
for (const r of Object.values(REAL)) r.mktPax = r.share >= 0.999 ? r.pax : Math.round(r.pax / r.share);

/* ══════════════ CAL：标定值固定 ══════════════ */
head('CAL 标定结果（2026-11-02）');
{
  ok(E.DEMAND_K.Simone === 7188, 'DEMAND_K.Simone = 7,188（原 9,868，×0.728）', String(E.DEMAND_K.Simone));
  ok(E.DEMAND_K.Ellington === 31729, 'DEMAND_K.Ellington = 31,729（原 11,603，×2.735）', String(E.DEMAND_K.Ellington));
  ok(E.MARKET_COMPETITION.Ellington.target === 0.3383,
     'Ellington 份额 target 保持长期均衡位 33.83%（单季 48.40% 不替代均衡位）',
     String(E.MARKET_COMPETITION.Ellington.target));
  ok(Math.abs(E.MARKET_COMPETITION.Ellington.playerOffset + 0.6709) < 1e-4,
     'Ellington playerOffset 保持 −0.6709（长期均衡位）',
     E.MARKET_COMPETITION.Ellington.playerOffset.toFixed(4));
  ok(E.DEMAND_K.Armstrong === 68505 && E.DEMAND_K.Broonzy === 26953 && E.DEMAND_K.Joplin === 12999
     && E.DEMAND_K.Lewis === 7555 && E.DEMAND_K.Fitzgerald === 5951,
     '其余 5 个市场保持现值（未标定，来源为 rebuild 管线旧拟合）');
}

/* ══════════════ ASK：真实首季配置复原 ══════════════ */
head('ASK 真实首季配置复原校验');
{
  for (const [name, r] of Object.entries(REAL)) {
    const askCalc = r.pFreq * r.seats * r.km;
    ok(Math.abs(askCalc - r.ask) / r.ask < 0.02,
       `${name}：${r.pFreq} 班 × ${r.seats} 座 × ${r.km}km ≈ 原版 ASK`,
       `${(askCalc / 1e6).toFixed(2)}MM vs ${(r.ask / 1e6).toFixed(1)}MM`);
  }
}

/* ══════════════ DEM：标定后引擎产出对齐原版 ══════════════ */
head('DEM 标定后引擎市场季需求 vs 原版');
{
  for (const [name, r] of Object.entries(REAL)) {
    const D = E.DEMAND_K[name] * pf(r.fare, epsOf(r.code)) * ff(r.mFreq);
    const err = Math.abs(D - r.mktPax) / r.mktPax;
    ok(err < 0.001, `${name} 市场季需求 = 原版真实值（误差 <0.1%）`,
       `${Math.round(D).toLocaleString()} vs ${r.mktPax.toLocaleString()}（${(err * 100).toFixed(3)}%）`);
  }
}

/* ══════════════ GAP：留一交叉验证（已知缺口护栏）══════════════ */
head('GAP 留一市场交叉验证（量化 K 相对结构缺口）');
{
  const ratios = {
    Simone: E.DEMAND_K.Simone / 9868,
    Ellington: E.DEMAND_K.Ellington / 11603,
  };
  const errs = [];
  for (const [src, dst] of [['Simone', 'Ellington'], ['Ellington', 'Simone']]) {
    const R = REAL[dst];
    const Kpred = E.DEMAND_K[dst] * ratios[src];
    const Dpred = Kpred * pf(R.fare, epsOf(R.code)) * ff(R.mFreq);
    const err = (Dpred - R.mktPax) / R.mktPax;
    errs.push(Math.abs(err));
    console.log(`    用 ${src} 的缩放 ${ratios[src].toFixed(3)}× 预测 ${dst}：`
      + `误差 ${(err * 100).toFixed(1)}%`);
  }
  ok(Math.min(...errs) > 0.25,
     '两市场缩放因子互相预测误差 >25% ⇒ K 的相对结构确有偏差（已知缺口，未修）',
     '→ 需补齐自洽观测后重建 DEMAND_K（见方案 U13″‴-b）');
}

/* ══════════════ E2E：真实首季配置复现（方案 M11 验收标准）══════════════ */
head('E2E 真实首季配置复现（原版 CA Q4/2027）');
{
  const g = G.newGame(20261021);
  g.cash = 2_000_000; g.noCashSweep = true;
  const apt = g.aircraft.find(a => a.type === 'APT100');
  const g160 = g.aircraft.find(a => a.type === 'G160');
  g.routes = [{ code: 'SIM', fare: 120, openedTurn: 0, etopsPaid: false },
              { code: 'ETN', fare: 250, openedTurn: 0, etopsPaid: false }];
  for (const d of ['07:00','09:00','11:00','13:30','16:00','19:00'])
    g.schedules.push({ acId: apt.id, code: 'SIM', ac: apt, seats: apt.seats, bh: 1.13, cargoCap: apt.cargo, departure: d, flightNo: 'S' + d });
  for (const d of ['08:00','10:30','15:00','18:30'])
    g.schedules.push({ acId: g160.id, code: 'ETN', ac: g160, seats: g160.seats, bh: 1.88, cargoCap: g160.cargo, departure: d, flightNo: 'E' + d });
  const Dsim = E.demand('Simone', 120, 540, 1);
  const Detn = E.demand('Ellington', 250, 720, 1);
  g.__alloc = {
    SIM: { totalDemand: Dsim, marketFreq: 540, marketFare: 120, shares: { player: 1 }, alloc: { player: Dsim } },
    ETN: { totalDemand: Detn, marketFreq: 720, marketFare: 250,
           shares: { player: 0.484, rival: 0.516 }, alloc: { player: Detn * 0.484, rival: Detn * 0.516 } },
  };
  const r = G.computeTurn(g, G.currentPeriod(g));
  const s = r.detail.SIM, e = r.detail.ETN;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  ok(near(s.ask / 1e6, 28.4, 0.2), 'SIM ASK ≈ 28.4MM', `${(s.ask / 1e6).toFixed(2)}MM`);
  ok(near(e.ask / 1e6, 65.8, 0.2), 'ETN ASK ≈ 65.8MM', `${(e.ask / 1e6).toFixed(2)}MM`);
  ok(near(r.askTotal / 1e6, 94.2, 0.3), '网络 ASK ≈ 94.2MM', `${(r.askTotal / 1e6).toFixed(2)}MM`);
  ok(near(e.pax, 32600, 32600 * 0.05), 'ETN 玩家旅客 ≈ 32,600（原版）', `${Math.round(e.pax).toLocaleString()}`);
  ok(near(r.paxTotal, 61900, 61900 * 0.06), '网络旅客 ≈ 61,900（原版）',
     `${Math.round(r.paxTotal).toLocaleString()}（${((r.paxTotal / 61900 - 1) * 100).toFixed(1)}%）`);
  ok(near(r.load_factor, 0.561, 0.02), '网络 LF ≈ 56.1%（原版）',
     `${(r.load_factor * 100).toFixed(1)}%`);
  /* LF 护栏：分市场 LF 也须贴近原版（Simone 54.3% / Ellington 56.9%）
     —— 防止「班次摊薄到多航线」或「形状归一化基准」改动悄悄压低 LF */
  ok(near(s.lf, 0.543, 0.04), 'Simone LF ≈ 54.3%（原版）', `${(s.lf * 100).toFixed(1)}%`);
  ok(near(e.lf, 0.569, 0.04), 'Ellington LF ≈ 56.9%（原版）', `${(e.lf * 100).toFixed(1)}%`);
  /* 独占市场（无竞手）时的 LF 也应合理：Simone 需求被本方独占 → LF 不应异常高 */
  const gSolo = G.newGame(20261021);
  gSolo.cash = 2000000;
  const a2 = gSolo.aircraft.find(a => a.type === 'APT100');
  gSolo.routes = [{ code: 'SIM', fare: 120, openedTurn: 0, etopsPaid: false }];
  for (const d of ['07:00','09:00','11:00','13:30','16:00','19:00'])
    gSolo.schedules.push({ acId: a2.id, code: 'SIM', ac: a2, seats: a2.seats, bh: 1.13,
                          cargoCap: a2.cargo, departure: d, flightNo: 'S' + d });
  const rs = G.computeTurn(gSolo, G.currentPeriod(gSolo));
  /* 首季损益逐项对账护栏（依据原版 CA Q4/2027 真实损益表） */
  const agg = {};
  for (const d of Object.values(r.detail)) {
    for (const [k, v] of Object.entries(d.rev)) agg[k] = (agg[k] || 0) + v;
    for (const [k, v] of Object.entries(d.cost)) agg[k] = (agg[k] || 0) + v;
  }
  const near2 = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1) < 0.02;
  ok(near2(agg['Passenger Revenue'], 11573329), '客运收入 ≈ 原版 11,573,329（±2%）',
     Math.round(agg['Passenger Revenue']).toLocaleString());
  ok(near2(agg['Fuel'] + E.F08_FIXED, 1929780), 'Fuel ≈ 原版 1,929,780（±2%，含公司级固定项）',
     Math.round(agg['Fuel'] + E.F08_FIXED).toLocaleString());
  ok(near2(agg['Ancillary Revenue'], 154800), '辅营收入 ≈ 原版 154,800（±2%）',
     Math.round(agg['Ancillary Revenue']).toLocaleString());
  ok(near2(r.revenue, 11987057), '总收入 ≈ 原版 11,987,057（±2%）',
     Math.round(r.revenue).toLocaleString());
  ok(r.operating_profit > 0, '经营利润为正（与原版同向）', Math.round(r.operating_profit).toLocaleString());
  /* ★ 裁定 L1（2026-11-03）：折旧年限 16.28 → 25 年（教学假设）
     → 首季折旧由原版 1,866,600 变为 135,040,000/25/4 = 1,350,400（低 516,200）
     → 总营业成本与经营利润的期望值相应调整，其余 16 项仍与原版闭合 */
  const DEP25 = 135040000 / 25 / 4;
  ok(Math.abs(DEP25 - 1350400) < 1, '折旧口径 = 25 年教学假设 1,350,400（原版 1,866,600，低 27.7%）',
     Math.round(DEP25).toLocaleString());
  ok(Math.abs(r.cost - (11078071 - (1866600 - DEP25))) / (11078071 - (1866600 - DEP25)) < 0.03,
     '总营业成本 ≈ 10,566,365（原版 11,078,071 − L1 折旧差）（±3%）', Math.round(r.cost).toLocaleString());
  ok(Math.abs(r.operating_profit - (908986 + (1866600 - DEP25))) / (908986 + (1866600 - DEP25)) < 0.12,
     '经营利润 ≈ 1,338,520（原版 908,986 + L1 折旧差）（±12%）', Math.round(r.operating_profit).toLocaleString());
  ok(Math.abs(r.detail.SIM.cost['Cabin Crew'] + r.detail.ETN.cost['Cabin Crew'] - 521460) / 521460 < 0.03,
     'Cabin Crew ≈ 原版 521,460（±3%）',
     Math.round(r.detail.SIM.cost['Cabin Crew'] + r.detail.ETN.cost['Cabin Crew']).toLocaleString());
  ok(Math.abs(r.detail.SIM.cost['Navigation'] + r.detail.ETN.cost['Navigation'] - 294781) / 294781 < 0.03,
     'Navigation ≈ 原版 294,781（±3%）',
     Math.round(r.detail.SIM.cost['Navigation'] + r.detail.ETN.cost['Navigation']).toLocaleString());
  /* 长程市场 K 标定护栏（2026-11-03 单点反解，rebuild/calibrate_longhaul_k.mjs） */
  ok(E.DEMAND_K.McGee === 59332, 'K_McGee = 59,332（单点反解落地）', String(E.DEMAND_K.McGee));
  const geePool = E.demand('McGee', 825, 180, 1);
  ok(Math.abs(geePool - 19297) / 19297 < 0.08, 'GEE 需求池 ≈ 原版反解 19,297（±8%）', Math.round(geePool).toLocaleString());
  ok(E.DEMAND_K.Armstrong === 68505 && E.DEMAND_K.Broonzy === 26953,
     'Armstrong 保持 68,505（反解 65,860 相互印证）／Broonzy 保持 26,953（无一手锚点，未采纳类比值）',
     `ARM ${E.DEMAND_K.Armstrong} / BZY ${E.DEMAND_K.Broonzy}`);
  ok(rs.detail.SIM.lf < 0.70, '独占市场时 LF 不异常高（<70%）',
     `${(rs.detail.SIM.lf * 100).toFixed(1)}%（原版 54.3%，上限为防止过度承运）`);
}

console.log(`\n${'═'.repeat(64)}`);
console.log(`  需求总量标定回归：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
console.log('═'.repeat(64));
process.exit(fail ? 1 : 0);
