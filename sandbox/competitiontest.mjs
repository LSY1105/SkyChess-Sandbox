/* ============================================================
   竞争机制专项测试
   ------------------------------------------------------------
   验证竞争教学沙盘的核心性质：
     1) 无重复计量：全网承运 ≤ 市场需求
     2) 份额和 = 1（同一市场内）
     3) 降价 → 抢份额（自己份额升、对手份额降）
     4) 加班次 → 抢份额
     5) 提 QSI → 抢份额
     6) 不同经营路线（机队/航线/定价）→ 不同结局
     7) 事件对各家影响不对称（被冰雹打中的航司掉份额）
   ============================================================ */
import * as G from './game.js';
import * as E from './engine.js';
import { GM, MARKETS, AIRCRAFT } from './data.js';

const R = [];
const step = async (name, fn) => {
  try { const r = await fn(); R.push({ name, ok: true, note: r || '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/** 构造一个含玩家与 2 家竞品的局面 */
function mkGame(seat = 'CA') {
  const g = G.newGame(20261021);
  g.seat = seat;
  // 玩家：SIM + ETN，两条航线
  g.routes = [
    { code: 'SIM', fare: 160, openedTurn: 0, etopsPaid: false },
    { code: 'ETN', fare: 240, openedTurn: 0, etopsPaid: false },
  ];
  // 玩家排班：每条航线 1 班/日
  g.schedules = [];
  g.aircraft[0].id = 1; g.aircraft[1].id = 2;
  for (const [i, code] of ['SIM', 'ETN'].entries()) {
    g.schedules.push({
      acId: i + 1, code, ac: g.aircraft[i], seats: g.aircraft[i].seats,
      bh: MARKETS[code].bh, cargoCap: g.aircraft[i].cargo ?? 0,
      departure: '08:00', flightNo: `P-${i}`,
    });
  }
  // 竞品：AB 在 SIM，VA 在 ETN（与真实开局结构一致）
  g.competitors = [
    { code: 'AB', name: 'Air Ballistic', qsi: 4.2, cash: 3_200_000,
      routes: [{ code: 'SIM', fare: 150, openedTurn: 0 }],
      aircraft: [{ id: 1, seats: 132 }], schedules: [] },
    { code: 'VA', name: 'VisionAir', qsi: 4.6, cash: 3_600_000,
      routes: [{ code: 'ETN', fare: 250, openedTurn: 0 }],
      aircraft: [{ id: 1, seats: 159 }], schedules: [] },
  ];
  for (const c of g.competitors) {
    for (const r of c.routes) {
      c.schedules.push({
        acId: 1, code: r.code, seats: c.aircraft[0].seats,
        bh: MARKETS[r.code].bh, cargoCap: 0, departure: '09:00',
      });
    }
  }
  return g;
}

await step('场景搭建：玩家 + 2 竞品覆盖 SIM/ETN', async () => {
  const g = mkGame();
  ok(g.competitors.length === 2, '竞品数不对');
  return `玩家 2 航线 / ${g.competitors.length} 竞品`;
});

await step('竞争分配：份额和 = 1', async () => {
  const g = mkGame();
  const alloc = G.allocateMarkets(g);
  for (const [code, al] of Object.entries(alloc)) {
    const s = Object.values(al.shares).reduce((a, x) => a + x, 0);
    ok(near(s, 1, 1e-9), `${code} 份额和 = ${s}`);
    ok(al.totalDemand > 0, `${code} 市场需求为 0`);
  }
  const sim = alloc.SIM;
  return `SIM 需求 ${Math.round(sim.totalDemand).toLocaleString()} | ` +
         Object.entries(sim.shares).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(' ');
});

await step('无重复计量：全网承运 ≤ 市场需求', async () => {
  const g = mkGame();
  const alloc = G.allocateMarkets(g);
  for (const [code, al] of Object.entries(alloc)) {
    const sum = Object.values(al.alloc).reduce((a, x) => a + x, 0);
    ok(sum <= al.totalDemand + 1e-6,
       `${code} 分配总量 ${sum} > 市场需求 ${al.totalDemand}`);
  }
  return Object.entries(alloc)
    .map(([c, al]) => `${c}: ${Math.round(al.totalDemand).toLocaleString()}`)
    .join(' / ');
});

await step('降价 → 抢份额（自己升、对手降）', async () => {
  const g = mkGame();
  const before = G.allocateMarkets(g).SIM.shares;
  g.routes.find(r => r.code === 'SIM').fare = 120;      // 160 → 120
  const after = G.allocateMarkets(g).SIM.shares;
  ok(after.player > before.player + 1e-6,
     `降价后自己份额没升 ${before.player} → ${after.player}`);
  ok(after.AB < before.AB - 1e-6,
     `降价后对手份额没降 ${before.AB} → ${after.AB}`);
  return `player ${(before.player * 100).toFixed(1)}%→${(after.player * 100).toFixed(1)}%，` +
         `AB ${(before.AB * 100).toFixed(1)}%→${(after.AB * 100).toFixed(1)}%`;
});

await step('加班次 → 抢份额', async () => {
  const g = mkGame();
  const before = G.allocateMarkets(g).SIM.shares;
  // 玩家在 SIM 加第二班（隔开过站时间）
  g.schedules.push({
    acId: 1, code: 'SIM', ac: g.aircraft[0], seats: g.aircraft[0].seats,
    bh: MARKETS.SIM.bh, cargoCap: 0, departure: '15:00', flightNo: 'P-1b',
  });
  const after = G.allocateMarkets(g).SIM.shares;
  ok(after.player > before.player + 1e-6,
     `加班次后份额没升 ${before.player} → ${after.player}`);
  return `player ${(before.player * 100).toFixed(1)}%→${(after.player * 100).toFixed(1)}%`;
});

await step('提 QSI → 抢份额', async () => {
  const g = mkGame();
  const before = G.allocateMarkets(g).SIM.shares;
  g.qsi = 9.0;
  const after = G.allocateMarkets(g).SIM.shares;
  ok(after.player > before.player + 1e-6,
     `QSI 提升后份额没升 ${before.player} → ${after.player}`);
  return `QSI 4.5→9.0：player ${(before.player * 100).toFixed(1)}%→${(after.player * 100).toFixed(1)}%`;
});

await step('退出市场 → 份额归零，对手接管', async () => {
  const g = mkGame();
  g.routes = g.routes.filter(r => r.code !== 'SIM');
  g.schedules = g.schedules.filter(s => s.code !== 'SIM');
  const al = G.allocateMarkets(g).SIM;
  ok(!('player' in al.shares), '退出后仍有玩家份额');
  ok(near(al.shares.AB, 1, 1e-9), `对手未接管，实际 ${al.shares.AB}`);
  return `AB 独占 ${(al.shares.AB * 100).toFixed(0)}%`;
});

await step('事件对各家影响不对称：冰雹打中玩家 → 玩家份额塌陷', async () => {
  const g = mkGame();
  const before = G.allocateMarkets(g).SIM.shares;
  // 冰雹：玩家 APT100 停飞（地面限制 → 该机停排）
  G.triggerEvent(g, 'hail', 'APT100');
  G.dropGroundedSchedules(g);          // 停飞 → 班次作废
  const al = G.allocateMarkets(g).SIM;
  // 玩家在 SIM 用 APT100(acId=1) → 被停飞 → 该市场班次为 0 → 无份额
  ok(!('player' in al.shares) || al.shares.player < before.player,
     '冰雹后玩家份额未受影响');
  return `player ${(before.player * 100).toFixed(1)}% → ` +
         ('player' in al.shares ? `${(al.shares.player * 100).toFixed(1)}%` : '已停飞退出');
});

await step('不同经营路线 → 不同份额结构', async () => {
  const g = mkGame();
  const alloc = G.allocateMarkets(g);
  const sim = alloc.SIM.shares;
  // 玩家高价低频 vs 竞品低价高频 → 竞品应占优
  g.routes.find(r => r.code === 'SIM').fare = 220;
  g.competitors[0].routes[0].fare = 110;
  const after = G.allocateMarkets(g).SIM.shares;
  ok(after.AB > after.player, `高价玩家份额 ${(after.player*100).toFixed(1)}% 未低于低价竞品 ${(after.AB*100).toFixed(1)}%`);
  return `玩家高价 $220 → ${(after.player*100).toFixed(1)}%；AB 低价 $110 → ${(after.AB*100).toFixed(1)}%`;
});

await step('全网承运守恒（结算后复算）', async () => {
  const g = mkGame();
  const alloc = G.allocateMarkets(g);
  const per = G.currentPeriod(g);
  const rep = G.computeTurn(g, per);
  let tot = 0;
  for (const d of Object.values(rep.detail)) tot += d.pax;
  const mktDemand = Object.values(alloc).reduce((a, x) => a + x.totalDemand, 0);
  ok(tot <= mktDemand + 1,
     `玩家侧承运 ${tot} 超过市场需求 ${mktDemand}`);
  return `玩家承运 ${Math.round(tot).toLocaleString()} ≤ 市场需求 ${Math.round(mktDemand).toLocaleString()}`;
});

await step('均衡位标定：各市场命中真实 Route Share 目标', async () => {
  // 真实数据给出的各市场长期均衡份额（rebuild/competition-calibration.json）
  const CAL = {
    Armstrong: { target: 0.5793, fare: 640.03, freq: 240, qsi: 11.88 },
    Broonzy:   { target: 0.4827, fare: 698.09, freq: 180, qsi: 7.90 },
    Ellington: { target: 0.3383, fare: 227.71, freq: 300, qsi: 6.53 },
    Fitzgerald:{target: 0.2113, fare: 155.42, freq: 225, qsi: 8.54 },
    Joplin:    { target: 0.7065, fare: 127.91, freq: 450, qsi: 10.68 },
    Lewis:     { target: 0.4490, fare: 98.81,  freq: 324, qsi: 9.12 },
    Simone:    { target: 0.4420, fare: 119.45, freq: 360, qsi: 10.85 },
  };
  let worst = 0;
  const lines = [];
  for (const [m, c] of Object.entries(CAL)) {
    const al = E.allocateMarket(m, [
      { key: 'player', fare: c.fare, freq: c.freq, qsi: c.qsi },
      { key: 'rival', fare: c.fare, freq: c.freq, qsi: c.qsi },
    ], 1);
    const d = Math.abs(al.shares.player - c.target) * 100;
    worst = Math.max(worst, d);
    lines.push(`${m} ${(al.shares.player * 100).toFixed(1)}%/${(c.target * 100).toFixed(1)}%`);
    ok(d < 0.5, `${m} 均衡份额 ${(al.shares.player*100).toFixed(1)}% 偏离目标 ${(c.target*100).toFixed(1)}% 达 ${d.toFixed(2)}pp`);
  }
  return `最大偏差 ${worst.toFixed(3)}pp | ${lines[0]} …`;
});

await step('形态覆盖：能产生真实数据里的全部竞争形态', async () => {
  // 真实数据里的形态分布（rebuild/competition-calibration.json → regime_counts）
  // 独占(100%) / CA主导(>=60%) / 均势(40~60%) / CA弱势(25~40%) / CA极弱势(<25%)
  const seen = new Set();
  // ① 独占形态：市场里只有一家航司（真实数据里 Simone 独占 6 个季度）
  const solo = E.allocateMarket('Simone', [{ key: 'player', fare: 120, freq: 360, qsi: 9 }], 1);
  if (solo.shares.player >= 0.999) seen.add('独占');
  // ② 其余形态：有对手时，通过价格扫描可达区间
  for (const m of ['Armstrong', 'Broonzy', 'Ellington', 'Fitzgerald', 'Joplin', 'Lewis', 'Simone']) {
    // 通过调整玩家价格，扫描可达的份额区间
    for (const mult of [0.5, 0.8, 1.0, 1.3, 1.8, 2.5]) {
      const al = E.allocateMarket(m, [
        { key: 'player', fare: 100 * mult, freq: 180, qsi: 6 },
        { key: 'rival', fare: 100 * mult, freq: 180, qsi: 6 },
      ], 1);
      const s = al.shares.player;
      if (s >= 0.999) seen.add('独占');
      else if (s >= 0.60) seen.add('CA主导');
      else if (s >= 0.40) seen.add('均势');
      else if (s >= 0.25) seen.add('CA弱势');
      else seen.add('CA极弱势');
    }
  }
  for (const need of ['独占', 'CA主导', '均势', 'CA弱势', 'CA极弱势']) {
    ok(seen.has(need), `未能产生形态「${need}」`);
  }
  return `可达形态: ${[...seen].join(' / ')}`;
});

await step('均衡位对玩家决策的敏感度（降价必须从均衡位偏移）', async () => {
  const m = 'Lewis';
  const base = E.allocateMarket(m, [
    { key: 'player', fare: 100, freq: 180, qsi: 9 },
    { key: 'rival', fare: 100, freq: 180, qsi: 9 },
  ], 1).shares.player;
  const cut = E.allocateMarket(m, [
    { key: 'player', fare: 80, freq: 180, qsi: 9 },
    { key: 'rival', fare: 100, freq: 180, qsi: 9 },
  ], 1).shares.player;
  ok(cut > base, `降价后份额未升 ${base} → ${cut}`);
  return `${(base*100).toFixed(1)}% → ${(cut*100).toFixed(1)}%`;
});

await step('M3 回归：AI 竞品标定后各市场均衡份额仍在真实目标附近', async () => {
  // 标定脚本 calibrate_ai.mjs 的留一市场样本外结果：测试 RMSE 6.85pp
  // 回归阈值取 15pp（留出市场的实测最大偏差约 12pp）
  const { AI_PARAMS } = await import('./competitors.js');
  const { MARKET_COMPETITION } = E;
  const REF = {   // 真实数据的 CA 历史常态（用于构造参照局面）
    Armstrong:   { fare: 640.03, freq: 240, qsi: 11.88 },
    Broonzy:     { fare: 698.09, freq: 180, qsi: 7.90 },
    Ellington:   { fare: 227.71, freq: 300, qsi: 6.53 },
    Fitzgerald: { fare: 155.42, freq: 225, qsi: 8.54 },
    Joplin:      { fare: 127.91, freq: 450, qsi: 10.68 },
    Lewis:       { fare: 98.81,  freq: 324, qsi: 9.12 },
    Simone:      { fare: 119.45, freq: 360, qsi: 10.85 },
  };
  let worst = 0, worstM = '';
  for (const [m, st] of Object.entries(REF)) {
    const code = Object.keys(MARKETS).find(c => MARKETS[c].name === m);
    const mk = MARKETS[code];
    const guide = mk.guide_fare || 150;
    let rivalFare = guide * AI_PARAMS.kPrice;
    if (st.fare < guide * 0.97) rivalFare = st.fare * AI_PARAMS.followRatio;
    rivalFare = Math.round(rivalFare * (1 + (st.qsi + AI_PARAMS.qsiOffset - 4) * AI_PARAMS.qsiPrice));
    const fR = Math.max(1, AI_PARAMS.flightsPerAc) * 90;
    const fP = Math.max(1, Math.round(st.freq / 90)) * 90;
    const al = E.allocateMarket(m, [
      { key: 'player', fare: st.fare, freq: fP, qsi: st.qsi },
      { key: 'AB', fare: rivalFare, freq: fR, qsi: st.qsi + AI_PARAMS.qsiOffset },
    ], 1);
    const tgt = E.MARKET_COMPETITION[m].target;
    const d = Math.abs(al.shares.player - tgt) * 100;
    if (d > worst) { worst = d; worstM = m; }
    ok(d < 15, `${m} 均衡份额 ${(al.shares.player*100).toFixed(1)}% 偏离目标 ${(tgt*100).toFixed(1)}% 达 ${d.toFixed(1)}pp`);
  }
  return `最大偏差 ${worst.toFixed(2)}pp（${worstM}）`;
});

await step('M3 回归：AI 参数已标定（非默认值）', async () => {
  const { AI_PARAMS } = await import('./competitors.js');
  ok(AI_PARAMS.kPrice >= 0.85 && AI_PARAMS.kPrice <= 1.15,
     `定价系数 ${AI_PARAMS.kPrice} 超出合理带 [0.85, 1.15]`);
  ok(AI_PARAMS.flightsPerAc >= 1 && AI_PARAMS.flightsPerAc <= 6, '班次目标超出合理范围');
  ok(AI_PARAMS.qsiOffset >= -2 && AI_PARAMS.qsiOffset <= 3, 'QSI 偏移超出合理范围');
  return JSON.stringify(AI_PARAMS);
});

console.log('='.repeat(84));
console.log('★ 竞争机制专项测试');
console.log('='.repeat(84));
console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(44)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
process.exit(pass === R.length ? 0 : 1);
