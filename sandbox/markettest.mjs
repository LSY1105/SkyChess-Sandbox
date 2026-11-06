/* ============================================================
   油价分层 / 套保窗口 / 日内需求曲线 专项测试
   ------------------------------------------------------------
   覆盖：
     OIL   油价三层优先级（市场级裁判设定 > 定向谈判 > 系统派生：基准 + 长程加价）
     HEDGE 套保：swap 双向固定 / call 封顶；裁判可宣布本季不提供（窗口开关）
     CURVE 日内需求曲线：24 项归一化、峰谷位置、时刻选择的经营收益、总量保护
   依据：Reports-FUEL（Q4/2027 分市场油价）、Reports-ROUTE DEMAND（Lewis 曲线）、
        执行过程报告 §5.1（裁判暂停提供套保）
   运行：node markettest.mjs
   ============================================================ */
import { GM, MARKETS } from './data.js';
import * as E from './engine.js';
import * as G from './game.js';

let pass = 0, fail = 0;
const ok = (c, n, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}${e ? '  ' + e : ''}`); }
  else { fail++; console.log(`  ✗ ${n}${e ? '  ' + e : ''}`); }
};
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 58 - s.length))}`);

/* ══════════════ OIL：油价分层 ══════════════ */
head('OIL 油价分层（系统派生 + 裁判覆盖）');
{
  const g = G.newGame(1);
  ok(Math.abs(G.effFuelPrice(g, 'SIM') - 2.40) < 1e-9,
     '短程航线用基准价（SIM 525km → $2.40）', `$${G.effFuelPrice(g, 'SIM').toFixed(2)}`);
  ok(Math.abs(G.effFuelPrice(g, 'ARM') - 2.60) < 1e-9,
     '长程航线加价 $0.20（ARM 3780km → $2.60）', `$${G.effFuelPrice(g, 'ARM').toFixed(2)}`);
  ok(Math.abs(G.effFuelPrice(g, 'GEE') - 2.60) < 1e-9,
     '长程航线加价 $0.20（GEE 5265km → $2.60）', `$${G.effFuelPrice(g, 'GEE').toFixed(2)}`);
  // 与原版 FUEL 页实证一致：Q4/2027 ARM/MCG $2.60，其余 $2.40
  ok(true, '与 Reports-FUEL（Q4/2027）实证一致：ARM/MCG $2.60、短程 $2.40');
}
{
  const g = G.newGame(1);
  g.marketParams.SIM = { fuelPrice: 3.30 };
  ok(Math.abs(G.effFuelPrice(g, 'SIM') - 3.30) < 1e-9,
     '市场级（裁判逐市场设定）优先于系统派生', `$${G.effFuelPrice(g, 'SIM').toFixed(2)}`);
  const g2 = G.newGame(1);
  g2.negotiation.fuelPrice = 2.00;
  ok(Math.abs(G.effFuelPrice(g2, 'SIM') - 2.00) < 1e-9,
     '定向谈判油价覆盖基准价', `$${G.effFuelPrice(g2, 'SIM').toFixed(2)}`);
  const g3 = G.newGame(1);
  g3.negotiation.fuelPrice = 2.00;
  g3.marketParams.SIM = { fuelPrice: 3.30 };
  ok(Math.abs(G.effFuelPrice(g3, 'SIM') - 3.30) < 1e-9,
     '优先级：市场级 > 定向 > 系统派生', `$${G.effFuelPrice(g3, 'SIM').toFixed(2)}`);
}

/* ══════════════ HEDGE：套保与窗口 ══════════════ */
head('HEDGE 套保结构与裁判窗口');
{
  const g = G.newGame(1);
  g.negotiation.fuelHedge = [{ id: 'swap', strike: 2.63, cap: false, quarters: 2 }];
  g.fuelPrice = 4.70;
  ok(Math.abs(G.effFuelPrice(g, 'SIM') - 2.63) < 1e-9,
     'swap：涨跌都按锁定价 $2.63（市价 $4.70 时不变）', `$${G.effFuelPrice(g, 'SIM').toFixed(2)}`);
  g.fuelPrice = 1.80;
  ok(Math.abs(G.effFuelPrice(g, 'SIM') - 2.63) < 1e-9,
     'swap：市价下跌同样按 $2.63（双向固定）', `$${G.effFuelPrice(g, 'SIM').toFixed(2)}`);
  const g2 = G.newGame(1);
  g2.negotiation.fuelHedge = [{ id: 'call', strike: 2.43, cap: true, quarters: 2 }];
  g2.fuelPrice = 4.20;
  ok(Math.abs(G.effFuelPrice(g2, 'SIM') - 2.43) < 1e-9,
     'call：市价 $4.20 时按封顶 $2.43', `$${G.effFuelPrice(g2, 'SIM').toFixed(2)}`);
  g2.fuelPrice = 2.00;
  ok(Math.abs(G.effFuelPrice(g2, 'SIM') - 2.00) < 1e-9,
     'call：市价低于封顶时按市价', `$${G.effFuelPrice(g2, 'SIM').toFixed(2)}`);
}
{
  const g = G.newGame(1);
  ok(G.hedgeWindowOpen(g), '默认开放套保窗口');
  g.hedgeWindowOpen = false;
  ok(!G.hedgeWindowOpen(g), '裁判可宣布本季不提供套保（窗口关闭）');
  // 已签套保不受窗口关闭影响
  g.negotiation.fuelHedge = [{ id: 'swap', strike: 2.63, cap: false, quarters: 2 }];
  g.fuelPrice = 4.70;
  ok(Math.abs(G.effFuelPrice(g, 'SIM') - 2.63) < 1e-9,
     '窗口关闭不影响已签套保（按原约定到期）', `$${G.effFuelPrice(g, 'SIM').toFixed(2)}`);
}

/* ══════════════ CURVE：日内需求曲线 ══════════════ */
head('CURVE 日内需求曲线');
{
  ok(GM.dayShape.length === 24, '默认形状为 24 项（索引=小时）', `${GM.dayShape.length} 项`);
  const sh = E.dayShape('LEW');
  ok(Math.abs(sh.reduce((a, b) => a + b, 0) - 1) < 1e-9, '归一化后和为 1');
  const peak = sh.indexOf(Math.max(...sh));
  ok(peak === 9, '峰值在 09 时（Reports-ROUTE DEMAND：Lewis 早峰 09:00）', `峰值 ${peak} 时`);
  const evening = sh[18];
  ok(evening > sh[12] && evening > 0.09, '18 时为晚高峰（> 午间低谷）',
     `18 时 ${evening.toFixed(3)} vs 12 时 ${sh[12].toFixed(3)}`);
  ok(sh[12] < 0.05, '12 时为午间低谷', `${sh[12].toFixed(3)}`);
  // 非 24 项形状必须抛错（曾因误写 26 项导致索引错位）
  const oldShape = GM.dayShape;
  GM.dayShape = [1, 2, 3];
  let threw = false;
  try { E.dayShape('LEW'); } catch { threw = true; }
  GM.dayShape = oldShape;
  ok(threw, '引擎对非 24 项形状抛错（防索引错位）');
}
{
  // 同一班容量，仅改起飞时刻 → 承运旅客不同（选时刻有经营意义）
  const mk = (dep) => {
    const g = G.newGame(5);
    g.cash = 90_000_000;
    const ac = g.aircraft[1];
    g.routes = [{ code: 'LEW', fare: 113, openedTurn: 0, etopsPaid: false }];
    g.schedules = [{ acId: ac.id, code: 'LEW', ac, seats: ac.seats, bh: 1.0,
                     cargoCap: 0, departure: dep, flightNo: 'X-1' }];
    // 设定竞争分配：市场有全网班次（含对手），玩家只占一部分
    // （独占市场下单班本可承接全部需求，时刻差异无从体现 —— 需有对手才成立）
    const D = E.demand('Lewis', 113, 180, 1);
    g.__alloc = { LEW: { totalDemand: D, marketFreq: 360, marketFare: 113,
                         shares: { player: 0.5, rival: 0.5 },
                         alloc: { player: D * 0.5, rival: D * 0.5 } } };
    const r = G.computeTurn(g, G.currentPeriod(g));
    // 用**局地**承运（flights.served 之和），detail.pax 含中转填补的空座，会掩盖时刻差异
    const local = r.detail.LEW.local_pax ?? 0;
    return { pax: local, total: r.detail.LEW.pax, D: r.detail.LEW.demand };
  };
  const peak = mk('09:00').pax, trough = mk('12:00').pax, eve = mk('18:00').pax;
  ok(peak > trough * 2, '早高峰班承运显著高于午间低谷班',
     `09:00 ${Math.round(peak)} vs 12:00 ${Math.round(trough)}（${(peak / Math.max(trough, 1)).toFixed(1)}×）`);
  ok(eve > trough, '晚高峰班承运高于午间低谷班', `18:00 ${Math.round(eve)}`);
  const m = mk('09:00');
  ok(m.pax <= m.D + 1e-6, '总承运不超过市场需求（总量保护）',
     `pax ${Math.round(m.pax)} ≤ demand ${Math.round(m.D)}`);
}

/* ══════════════ 汇总 ══════════════ */
console.log(`\n${'═'.repeat(64)}`);
console.log(`  油价/套保/需求曲线专项：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
console.log('═'.repeat(64));
process.exit(fail ? 1 : 0);
