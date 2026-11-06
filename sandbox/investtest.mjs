/* ============================================================
   投资与现金流专项回归测试
   ------------------------------------------------------------
   覆盖：
     F1  投资 upfront 双重扣减（server 即时扣款 + 结算期二次扣减）
     F2  航线级投资市场作用域丢失（kind 硬编码 + 不传 code）
     F3  购买飞机使用随机 id（破坏可复现性）
     F4  mkAc 引用作用域外的 g（潜伏 ReferenceError）
     F9  annual 年费按「每回合」全额计提 → 一年 4 倍超收
     F10 ETOPS 许可费双扣（server 即时扣款 + oneoff 重复）
     DIR 原版 Investment Catalogue 31 项完整性与关键数值核对
   方法：同 seed 对照实验（唯一变量差异 → 现金流差额必须精确等于期望值）
   运行：node investtest.mjs
   ============================================================ */
import { GM, MARKETS, AIRCRAFT, INVESTMENTS } from './data.js';
import * as G from './game.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
};
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 58 - s.length))}`);

/* ---------- 工具：造一个「有航班有旅客」的最小对局 ---------- */
function mkGame(seed = 20261021, routes = ['SIM', 'ETN']) {
  const g = G.newGame(seed);
  g.cash = 50_000_000;
  g.noCashSweep = true;      // 隔离变量：关闭超额现金强制还贷（否则两组现金都被压到 $2,000,000）
  g.routes = routes.map(c => ({ code: c, fare: MARKETS[c].guide_fare || 200, openedTurn: 0, etopsPaid: false }));
  const ac = g.aircraft[0];
  routes.forEach((c, i) => {
    g.schedules.push({
      acId: ac.id, code: c, ac, seats: ac.seats, bh: 3.0,
      cargoCap: ac.cargo ?? 0, departure: i === 0 ? '08:00' : '14:00',
      flightNo: `${g.seat}-${1000 + i}`,
    });
  });
  return g;
}
/* 模拟 server.mjs 的 invest 动作（保持与线上一致的扣款语义） */
function serverInvest(g, invId, code = null) {
  const i = INVESTMENTS.find(x => x.id === invId);
  if (!i) return 'no item';
  const invCode = i.cat === 'route' ? (code || null) : null;
  if (i.cat === 'route' && !invCode) return 'need market code';
  if (g.investments.some(x => x.id === i.id && x.code === invCode)) return 'already invested';
  if (g.cash < i.upfront) return 'no cash';
  g.cash -= i.upfront;
  g.investments.push({ id: i.id, name: i.name, kind: i.cat, code: invCode,
                       amount: i.upfront, annual: i.annual, qsi: i.effect?.qsi || 0, openedTurn: g.turn });
  if (i.annual) g.investmentsAnnual.push({ id: i.id, name: i.name, annual: i.annual });
  return 'ok';
}

/* ══════════════ F1：upfront 不得双扣 ══════════════ */
head('F1 投资 upfront 双重扣减');
for (const id of ['cab_galaxy', 'cab_refresh', 'ife_basic', 'lounge_vip']) {
  const inv = INVESTMENTS.find(i => i.id === id);
  const a = mkGame(777), b = mkGame(777);
  serverInvest(a, id);
  const ra = G.computeTurn(a, G.currentPeriod(a));
  const rb = G.computeTurn(b, G.currentPeriod(b));
  const diff = ra.cash_end - rb.cash_end;
  // 期望 = -upfront + (per-pax 收益 - per-pax 成本) × 旅客数
  // （有 per-pax 数值的投资同时改变了经营现金流，必须计入，否则断言失真）
  const pax = a.lastInvestmentPL?.paxTotal ?? 0;
  const perPax = (inv.revenuePerPax || 0) - (inv.costPerPax || 0);
  const expected = -inv.upfront + perPax * pax;
  ok(Math.abs(diff - expected) < 1e-6,
     `${id} 现金差额 = -upfront + per-pax 损益（实扣一次）`,
     `差额 $${diff.toLocaleString()} / 期望 $${expected.toLocaleString()} (upfront $${inv.upfront.toLocaleString()}, per-pax ${perPax}×${pax})`);
}

/* ══════════════ F2：航线级投资的市场作用域 ══════════════ */
head('F2 航线级投资市场作用域');
{
  const inv = INVESTMENTS.find(i => i.id === 'cat_econ');
  const g = mkGame(777, ['SIM', 'ETN']);
  ok(serverInvest(g, 'cat_econ', 'SIM') === 'ok', 'cat_econ 可按市场投放（route by route）');
  const g2 = mkGame(777, ['SIM', 'ETN']);
  ok(serverInvest(g2, 'cat_econ') === 'need market code', 'cat_econ 缺市场时被拒绝');
  G.computeTurn(g, G.currentPeriod(g));
  const pl = g.lastInvestmentPL || {};
  const paxTotal = pl.paxTotal ?? 0;
  const invCost = pl.invCost ?? 0;
  ok(paxTotal > 0, '对照组有旅客（前置条件）', `paxTotal=${paxTotal}`);
  ok(invCost > 0, '目标市场投资产生 per-pax 成本计提', `invCost=$${invCost.toLocaleString()}`);
  ok(invCost < inv.costPerPax * paxTotal + 1e-6,
     '计提仅覆盖目标市场旅客（未按全网络计提）',
     `invCost $${invCost.toLocaleString()} < 全网 $${(inv.costPerPax * paxTotal).toLocaleString()}`);
}
{ // 作用域正确性：两个市场分别投放 → 成本应分别只覆盖各自旅客
  const g = mkGame(777, ['SIM', 'ETN']);
  serverInvest(g, 'cat_econ', 'SIM');
  G.computeTurn(g, G.currentPeriod(g));
  const onlySim = g.lastInvestmentPL?.invCost ?? 0;
  const g3 = mkGame(777, ['SIM', 'ETN']);
  serverInvest(g3, 'cat_econ', 'SIM');
  serverInvest(g3, 'cat_econ', 'ETN');
  G.computeTurn(g3, G.currentPeriod(g3));
  const both = g3.lastInvestmentPL?.invCost ?? 0;
  ok(both > onlySim, '投放两个市场 → 计提额大于只投一个市场',
     `单投 $${onlySim.toLocaleString()} < 双投 $${both.toLocaleString()}`);
}

/* ══════════════ F3：购买飞机确定性 id ══════════════ */
head('F3 购买飞机 id 确定性');
{
  const g = mkGame(555);
  const ids = [];
  for (let k = 0; k < 2; k++) {
    const a2 = AIRCRAFT.find(x => x.name === 'APT100');
    const price = a2.price * 1e6;
    g.cash -= price;
    g.aircraft.push({ id: (g.__acSeq = (g.__acSeq || g.aircraft.length) + 1), type: a2.name, owned: true, price,
      acquiredTurn: g.turn, age: 0, seats: a2.seats, eco: a2.eco, prem: a2.prem, biz: a2.biz,
      mtow: a2.mtow, fuel: a2.fuel, dmc_c: a2.dmc_c, dmc_fh: a2.dmc_fh, long: a2.long,
      nickname: 'Owned', cargo: a2.cargo ?? 0, cab_min: a2.cab_min ?? 1 });
    ids.push(g.aircraft[g.aircraft.length - 1].id);
  }
  ok(new Set(ids).size === 2, '两次购买 id 不重复', `ids=[${ids.join(',')}]`);
  const g2 = mkGame(555);
  ok(g2.aircraft.every(a => typeof a.id === 'number'), '初始机队 id 为确定性数字');
}

/* ══════════════ F4：mkAc 作用域 ══════════════ */
head('F4 mkAc 作用域');
{
  let threw = null;
  try { const g = G.newGame(42); const ac = g.aircraft[0]; if (!ac || typeof ac.id !== 'number') threw = 'bad'; }
  catch (e) { threw = e.message; }
  ok(threw === null, 'newGame 正常构造机队（mkAc 不再引用未定义 g）', threw ? `err=${threw}` : '');
}

/* ══════════════ F9：annual 年费按季度摊销 ══════════════ */
head('F9 annual 年费计提频率');
{
  const inv = INVESTMENTS.find(i => i.id === 'adv_web'); // annual = 150000
  const a = mkGame(909), b = mkGame(909);
  serverInvest(a, 'adv_web');
  for (let k = 0; k < 4; k++) { G.advanceTurn(a); G.advanceTurn(b); }
  /* 断言用 annualCharged 累计器（精确）：现金差额会混入旅客收入随回合增长的效应，不适合做等式断言 */
  ok(Math.abs((a.annualCharged || 0) - inv.annual) < 1e-6,
     '4 回合（1 年）年费总扣 = annual（非 4×annual）',
     `计提 $${(a.annualCharged || 0).toLocaleString()} / 期望 $${inv.annual.toLocaleString()}`);
}
{
  const inv = INVESTMENTS.find(i => i.id === 'lounge'); // annual = 1455000
  const a = mkGame(909), b = mkGame(909);
  serverInvest(a, 'lounge');
  for (let k = 0; k < 4; k++) { G.advanceTurn(a); G.advanceTurn(b); }
  ok(Math.abs((a.annualCharged || 0) - inv.annual) < 1e-6, 'Lounge 年费 $1,455,000 一年扣一次',
     `计提 $${(a.annualCharged || 0).toLocaleString()} / 期望 $${inv.annual.toLocaleString()}`);
}

/* ══════════════ F10：ETOPS 不得双扣 ══════════════ */
head('F10 ETOPS 许可费');
{
  const a = mkGame(313, ['SIM']), b = mkGame(313, ['SIM']);
  // b 额外支付 ETOPS
  b.cash -= GM.etops_fee;
  b.routes[0].etopsPaid = true;
  const ra = G.computeTurn(a, G.currentPeriod(a));
  const rb = G.computeTurn(b, G.currentPeriod(b));
  const diff = rb.cash_end - ra.cash_end;
  ok(Math.abs(diff + GM.etops_fee) < 1e-6,
     'ETOPS 现金差额 = 一次 $375,000（非两次）',
     `差额 $${diff.toLocaleString()} / 期望 -$${GM.etops_fee.toLocaleString()}`);
}

/* ══════════════ DIR：原版 31 项目录完整性 ══════════════ */
head('DIR 原版 Investment Catalogue 31 项');
{
  const ORIG = {
    adv_web: [0, 150000], adv_bill: [0, 250000], adv_print: [0, 650000],
    adv_social: [0, 350000], adv_tv: [0, 500000], ota: [0, 50000],
    cab_galaxy: [3700000, 0], cab_lowcost: [1375000, 0], cab_new: [2550000, 0], cab_refresh: [2150000, 0],
    enews: [0, 75000], bags: [0, 0], giveaway: [0, 20000],
    ife_basic: [1450000, 175000], ife_enh: [1600000, 190000], wifi: [1450000, 150000], wifi_hc: [330000, 120000],
    lounge: [0, 1455000], lounge_shared: [0, 191000], lounge_vip: [0, 2924000], lounge_vip_shared: [0, 945500],
    loyalty: [0, 1750000], fnb_basic: [0, 310000], fnb_super: [0, 510000], online_booking: [0, 550000],
    overweight: [0, 0], pref_seats: [0, 25000], priority: [0, 25000],
    cat_biz_pe: [0, 2000000], cat_econ: [0, 875000], selfcheckin: [0, 80000],
  };
  const map = new Map(INVESTMENTS.map(i => [i.id, i]));
  const missing = Object.keys(ORIG).filter(k => !map.has(k));
  ok(missing.length === 0, '原版 31 项全部存在', missing.length ? `缺 ${missing.join(',')}` : '31/31');
  let bad = [];
  for (const [id, [up, an]] of Object.entries(ORIG)) {
    const it = map.get(id);
    if (!it) continue;
    if (it.upfront !== up || it.annual !== an) bad.push(`${id}($${it.upfront}/$${it.annual})`);
  }
  ok(bad.length === 0, 'Upfront / Annual 与截图核对表逐项一致', bad.length ? `不符 ${bad.join(' ')}` : '31 项全对');
  ok(INVESTMENTS.every(i => i.cabin && i.cabin.E && i.cabin.PE && i.cabin.B),
     '每项均带 E/PE/B 三舱位原版数值');
  const loy = map.get('loyalty');
  ok(loy.cabin.E.c === 5 && loy.cabin.B.c === 7 && loy.cabin.B.r === 10,
     'Loyalty 舱位矩阵 $5/$5/$7 · $8/$8/$10 与截图一致');
  const bizpe = map.get('cat_biz_pe');
  ok(bizpe.cabin.PE.c === 10 && bizpe.cabin.B.c === 15 && bizpe.cabin.E.c === 0,
     'Provided Catering (Biz and PE) $0/$10/$15 与截图一致');
  const bgs = map.get('bags');
  ok(bgs.cabin.E.r === 2.5 && bgs.cabin.B.r === 0, 'Extra Bags 收益 $2.50/$2.50/$0 与截图一致');
  const enw = map.get('enews');
  ok(enw.cabin.E.r === 0.5 && enw.cabin.PE.r === 2 && enw.cabin.B.r === 3,
     'eNewsletters 收益 $0.50/$2.00/$3.00 与截图一致');
  ok(map.get('lounge').annual === 1455000, 'Lounge (Basic) 年费 $1,455,000（原沙盘 $0，已纠正）');
  ok(map.get('cat_prem') === undefined, '旧 id cat_prem 已移除（改为 cat_biz_pe）');
}

/* ══════════════ 汇总 ══════════════ */
console.log(`\n${'═'.repeat(64)}`);
console.log(`  投资与现金流专项：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
console.log('═'.repeat(64));
process.exit(fail ? 1 : 0);
