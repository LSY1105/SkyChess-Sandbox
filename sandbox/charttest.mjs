/* ============================================================
   图表与口径断言（jsdom）
   ------------------------------------------------------------
   不启服务：用**确定性小局面**喂给渲染函数，断言结构不变量。
   ============================================================ */
import { JSDOM } from 'jsdom';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MARKETS, GM } from './data.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true, url: 'http://127.0.0.1/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const G = await import('./game.js');

/* 确定性夹具：两条航线、已知座位与票价 */
const ROWS = [
  { code: 'LEW', bh: 1.00, fare: 100, seatsPerFlight: 100, ask: 1000 },
  { code: 'SIM', bh: 1.13, fare: 150, seatsPerFlight: 159, ask: 3000 },
];

test('breakEvenLF：座位翻倍则单班次盈亏平衡 LF 减半', () => {
  const base = G.breakEvenLF([ROWS[0]], 2.4);
  const dbl = G.breakEvenLF([{ ...ROWS[0], seatsPerFlight: 200 }], 2.4);
  assert.ok(base.routeBE[0].beLF > 0, 'BE LF 应为正');
  assert.equal(dbl.routeBE[0].beLF, +(base.routeBE[0].beLF / 2).toFixed(4));
});

test('breakEvenLF：全局值 = 各航线 BE LF 的 ASK 加权平均（落在最小与最大之间）', () => {
  const r = G.breakEvenLF(ROWS, 2.4);
  assert.equal(r.routeBE.length, 2);
  const vals = r.routeBE.map(x => x.beLF);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  assert.ok(r.breakEvenLF >= mn - 1e-6 && r.breakEvenLF <= mx + 1e-6,
    '加权平均应落在各航线区间内：' + r.breakEvenLF);
  const askSum = r.routeBE.reduce((a, x) => a + x.ask, 0);
  const manual = r.routeBE.reduce((a, x) => a + x.ask * x.beLF, 0) / askSum;
  assert.equal(r.breakEvenLF, +(manual).toFixed(4));
});

test('breakEvenLF：空输入返回 null，不返回 NaN', () => {
  const r = G.breakEvenLF([], 2.4);
  assert.deepEqual(r.routeBE, []);
  assert.equal(r.breakEvenLF, null);
});

/* ★ beLF 为 null 的航线（无有效运价/座位）必须**同时**退出加权分子与分母：
   只退分子、分母仍计 ask → 全网 BE LF 被无意义航线拉低（口径失真） */
test('breakEvenLF：beLF=null 的航线不参与加权（分子分母同步剔除）', () => {
  const bad = { code: 'X', bh: 1, fare: 0, seatsPerFlight: 100, ask: 9999 };
  const good = { code: 'Y', bh: 1.13, fare: 150, seatsPerFlight: 159, ask: 3000 };
  const r = G.breakEvenLF([bad, good], 2.4);
  assert.equal(r.routeBE[0].beLF, null, 'fare=0 → beLF 应为 null');
  assert.equal(r.breakEvenLF, r.routeBE[1].beLF,
    '全局值应等于唯一有效航线的 beLF，未被 ask=9999 的 null 航线拉低');
});

/* ★ computeTurn 级断言：锁死「单班口径」（本轮修正的正是行收集那一段）
   局面照抄开局：newGame('CA') → SIM 航线 + CA 初始机队（APT100 100 座 / G160 159 座）
   排班按原版 CA 口径：SIM 540 班/季 = 6 班/日（每机 3 班 × 2 机）→ 每日班次数 F = 6
   ★ 口径说明：若把行收集改回「季座位 ÷ 日班次 + 季 BH」的计划原式，
     BE LF 会**净放大 F 倍**（座位项 ×90、BH 项 ×90×F，相抵后剩 F）
     → 本用例的 beLF 会变成 1.0087（>1）且与期望值差 6 倍 → 必然变红 */
test('computeTurn：report.routeBE 用单班口径（每班次成本 ÷ 每班次满座收入）', () => {
  const g = G.newGame('CA');
  const acA = g.aircraft.find(a => a.type === 'APT100');
  const acB = g.aircraft.find(a => a.type === 'G160');
  const code = 'SIM';
  const bh = MARKETS[code].bh;                     // 市场单程 BH（独立于实现的收集逻辑）
  const deps = ['07:00', '11:00', '15:00'];
  for (const [ac, n] of [[acA, 3], [acB, 3]]) {
    for (let i = 0; i < n; i++) {
      g.schedules.push({ acId: ac.id, code, ac, seats: ac.seats, bh,
                         cargoCap: ac.cargo ?? 0, departure: deps[i] });
    }
  }
  const report = G.computeTurn(g, { label: 'T1' });

  assert.ok(Array.isArray(report.routeBE) && report.routeBE.length >= 1, 'routeBE 缺失或为空');
  const row = report.routeBE.find(r => r.code === code);
  assert.ok(row, 'routeBE 缺少 ' + code);
  assert.ok(row.beLF > 0 && row.beLF < 1, 'BE LF 应落在 (0,1)：' + row.beLF);

  /* 独立算式：平均单班座位 × 运价 = 每班次满座收入；变动成本用市场单程 BH */
  const avgSeats = (3 * acA.seats + 3 * acB.seats) / 6;
  const fare = g.routes.find(r => r.code === code).fare;
  const expect = G.perFlightOpsCost(MARKETS[code].bh, g.fuelPrice) / (avgSeats * fare);
  assert.ok(Math.abs(row.beLF - expect) < 1e-3,
    `BE LF 与单班口径期望不符：实际 ${row.beLF}，期望 ${expect.toFixed(6)}（差 F 倍即为口径回退）`);

  assert.ok(report.breakEvenLF > 0 && report.breakEvenLF < 1,
    '全网 breakEvenLF 应落在 (0,1)：' + report.breakEvenLF);
});

/* ============================================================
   需求图红/绿分段语义（官方《航空公司界面指南 V4》19 项 / Role Guide v3 p4）
   ------------------------------------------------------------
   官方原文：曲线**红色部分显示一天中需求如何变化**，**绿色部分显示枢纽机场的高峰时刻**；
   且枢纽高峰时刻**不一定与飞往航线目的地点的需求峰值吻合**。
   → 绿段必须**恰好**等于「枢纽高峰时段」的点；按涨跌分段（涨红跌绿）是旧实现 → 必须变红。
   ============================================================ */
const R = await import('./reports.js');

/* 最小局面：一个市场（LEW）+ 两个已知起飞时刻的班次 */
function makeGame(over = {}) {
  return {
    seat: 'CA',
    routes: [{ code: 'LEW', fare: MARKETS.LEW.guide_fare, bh: MARKETS.LEW.bh }],
    schedules: [
      { acId: 1, code: 'LEW', seats: 100, departure: '08:00' },
      { acId: 1, code: 'LEW', seats: 100, departure: '17:30' },
    ],
    aircraft: [{ id: 1, type: 'APT100', nickname: 'APT100' }],
    lastDetail: {},
    ...over,
  };
}

/* 全天网格：06:00 起、15 分钟一点 → 点 i 的整点 = 6+floor(i/4)；点数由 DOM 读出（不写死） */
const GRID_H0 = 6, GRID_Q = 4;
const hourOf = (i) => GRID_H0 + Math.floor(i / GRID_Q);

/* 折线点 → 曲线点序号：灰色「实际载量」线覆盖全天全部点，且与需求线同源 X 坐标 → 可作点位基准 */
function gridOf(svg) {
  const gray = [...svg.querySelectorAll('polyline')].find(p => p.getAttribute('stroke') === '#8a929c');
  assert.ok(gray, '应存在灰色实际载量曲线');
  const xs = gray.getAttribute('points').trim().split(/\s+/).map(s => s.split(',')[0]);
  return { total: xs.length, at: new Map(xs.map((x, i) => [x, i])), xs: xs.map(Number) };
}
const segPoints = (svg, color, at) =>
  [...svg.querySelectorAll('polyline')].filter(p => p.getAttribute('stroke') === color)
    .map(p => p.getAttribute('points').trim().split(/\s+/).map(s => at.get(s.split(',')[0])));

/* 独立判定：某整点是否落在给定峰时段内（左闭右开）——不复用被测实现 */
const inBands = (h, bands) => bands.some(([a, b]) => h >= a && h < b);

/* 从折线点的 <title> 读「HH:00 需求 N 人/日」 */
function demandByHour(box) {
  const map = new Map();
  for (const c of box.querySelectorAll('circle')) {
    const t = c.querySelector('title');
    const m = t && /(\d{2}):(\d{2}).*需求\s*(\d+)\s*人\/日/.exec(t.textContent);
    if (m && +m[2] === 0) map.set(+m[1], +m[3]);
  }
  return map;
}

test('需求图：绿段恰好覆盖枢纽高峰时段（不按涨跌分段）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: makeGame() }, { peakHours: [[8, 11]] });
  const svg = box.querySelector('svg');
  assert.equal(box.dataset.peakHours, '8-11', '容器应写出峰时段');

  const { total, at } = gridOf(svg);
  const greens = segPoints(svg, '#2da44e', at);
  const reds = segPoints(svg, '#cf222e', at);
  assert.equal(greens.length, 1, '一个峰时段 → 恰好一段绿（按涨跌分段会出现多段绿）');
  assert.ok(reds.length >= 1, '应存在红色段（非峰时段）');

  /* 绿段每个点都必须落在峰时段内 */
  const bands = [[8, 11]];
  for (const seg of greens) for (const i of seg)
    assert.ok(inBands(hourOf(i), bands), '绿段点 ' + hourOf(i) + ':00 不在峰时段内');

  /* 绿段覆盖的点集合 == 峰时段的点集合（不多不少） */
  const want = [];
  for (let i = 0; i < total; i++) if (inBands(hourOf(i), bands)) want.push(i);
  const got = [...new Set(greens.flat())].sort((a, b) => a - b);
  assert.deepEqual(got, want, '绿段应恰好等于峰时段的点');

  /* 红+绿覆盖全天，无遗漏 */
  const covered = new Set([...greens.flat(), ...reds.flat()]);
  assert.equal(covered.size, total, '红+绿应覆盖全天全部点');
  for (let i = 0; i < total; i++) assert.ok(covered.has(i), '点 ' + i + ' 未被任何段覆盖');
});

test('需求图：两个峰时段 → 两段绿，且每段整体落在对应峰时段内', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: makeGame() }, { peakHours: [[8, 11], [16, 19]] });
  const svg = box.querySelector('svg');
  assert.equal(box.dataset.peakHours, '8-11,16-19', '容器应写出两个峰时段');

  const { at } = gridOf(svg);
  const greens = segPoints(svg, '#2da44e', at);
  assert.equal(greens.length, 2, '两个峰时段 → 恰好两段绿');
  const bands = [[8, 11], [16, 19]];
  for (const seg of greens) {
    const hours = seg.map(hourOf);
    assert.ok(bands.some(([a, b]) => hours.every(h => h >= a && h < b)),
      '每段绿应整体落在某一个峰时段内：' + hours.join(','));
  }
});

test('需求图：默认峰时段取全局 GM.fareBandPeakHours（与定价口径同一份）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: makeGame() });
  const svg = box.querySelector('svg');
  assert.equal(box.dataset.peakHours, GM.fareBandPeakHours.map(b => b[0] + '-' + b[1]).join(','));

  const { total, at } = gridOf(svg);
  const greens = segPoints(svg, '#2da44e', at);
  assert.equal(greens.length, GM.fareBandPeakHours.length, '绿段数应等于全局峰时段数');
  const want = [];
  for (let i = 0; i < total; i++) if (inBands(hourOf(i), GM.fareBandPeakHours)) want.push(i);
  assert.deepEqual([...new Set(greens.flat())].sort((a, b) => a - b), want,
    '绿段应恰好等于全局峰时段的点');
});

test('需求图：图例体现官方语义（红=非枢纽高峰时段，绿=枢纽高峰时段）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: makeGame() }, { peakHours: [[8, 11]] });
  const txt = box.textContent;
  assert.ok(txt.includes('红=非枢纽高峰时段'), '图例应写明红=非枢纽高峰时段');
  assert.ok(txt.includes('绿=枢纽高峰时段'), '图例应写明绿=枢纽高峰时段');
  assert.ok(txt.includes('×' + GM.fareBandPeak), '图例应写明峰时运价倍率');
});

test('需求图：未配市场级形状时缺省回落 GM.dayShape', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: makeGame() });
  const d = demandByHour(box);
  const ratio = d.get(9) / d.get(12);
  const expect = GM.dayShape[9] / GM.dayShape[12];
  assert.ok(Math.abs(ratio - expect) < 0.1 * expect,
    '默认形状应为 GM.dayShape：09:00/12:00 需求比 = ' + ratio.toFixed(2) + '，期望 ' + expect.toFixed(2));
});

test('需求图：优先用该市场自己的 dayShape（MARKETS[code].dayShape）', () => {
  const custom = GM.dayShape.slice();
  custom[12] = 1.0;                        /* 12:00 抬到峰值 */
  const saved = MARKETS.LEW.dayShape;      /* 保存原值以免误删真实配置 */
  MARKETS.LEW.dayShape = custom;
  try {
    const box = document.createElement('div');
    R.renderRouteDemand(box, { CA: makeGame() });
    const d = demandByHour(box);
    const ratio = d.get(9) / d.get(12);
    const expect = custom[9] / custom[12];
    assert.ok(Math.abs(ratio - expect) < 0.1 * expect,
      '应按该市场形状绘制：09:00/12:00 需求比 = ' + ratio.toFixed(2) + '，期望 ' + expect.toFixed(2));
  } finally {
    if (saved === undefined) delete MARKETS.LEW.dayShape;
    else MARKETS.LEW.dayShape = saved;
  }
});

test('需求图：峰时段底纹存在且与峰时段对应（删掉底纹必须变红）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: makeGame() }, { peakHours: [[8, 11], [16, 19]] });
  const svg = box.querySelector('svg');
  /* 底纹 rect：灰底 + opacity 0.1（运力柱是 width=3 的窄条、填航司色） */
  const shade = [...svg.querySelectorAll('rect')]
    .filter(r => r.getAttribute('fill') === '#8a929c' && r.getAttribute('opacity') === '0.1')
    .map(r => ({ x: +r.getAttribute('x'), w: +r.getAttribute('width') }))
    .sort((a, b) => a.x - b.x);
  /* 峰时段直接取自容器写出的 peakHours（不重复实现画图口径） */
  const bands = box.dataset.peakHours.split(',').map(s => s.split('-').map(Number));
  assert.equal(bands.length, 2);
  assert.equal(shade.length, bands.length, '底纹数量应等于峰时段数量');

  /* 互不重叠且严格递增 */
  for (let k = 1; k < shade.length; k++)
    assert.ok(shade[k].x >= shade[k - 1].x + shade[k - 1].w, '峰时段底纹应递增且互不重叠');

  const { total, xs } = gridOf(svg);
  for (let k = 0; k < bands.length; k++) {
    const [a, b] = bands[k], r = shade[k];
    /* 该底纹覆盖的时刻点（用灰色载量线的 x → 曲线点序号还原） */
    const cover = [];
    for (let i = 0; i < total; i++) if (xs[i] >= r.x - 0.5 && xs[i] <= r.x + r.w + 0.5) cover.push(i);
    assert.ok(cover.length, '底纹应覆盖时刻点');
    const hs = cover.map(i => GRID_H0 + i / GRID_Q);
    assert.ok(hs[0] >= a - 0.25 && hs[0] <= a + 0.25,
      '底纹起点应贴着峰时段起点：' + hs[0] + ' vs ' + a);
    assert.ok(hs[hs.length - 1] >= b - 0.25 && hs[hs.length - 1] <= b,
      '底纹终点应贴着峰时段终点：' + hs[hs.length - 1] + ' vs ' + b);
    for (const h of hs) assert.ok(h >= a - 0.25 && h <= b + 0.25, '底纹盖到了峰时段外的时刻：' + h);
  }
});

test('需求图：形状回落链逐级校验合法性（opts.shapes → opts.shape → 市场 dayShape → GM.dayShape）', () => {
  const A = GM.dayShape.slice();
  A[12] = 1.0;                                  /* 12:00 抬到峰值 → 09:00/12:00 比 = 1 */
  const rA = A[9] / A[12];
  const ratioOf = (bx) => { const d = demandByHour(bx); return d.get(9) / d.get(12); };

  /* 1) opts.shapes[code] 最优先 */
  const b1 = document.createElement('div');
  R.renderRouteDemand(b1, { CA: makeGame() }, { shapes: { LEW: A } });
  assert.ok(Math.abs(ratioOf(b1) - rA) < 0.1 * rA, 'opts.shapes 应优先');

  /* 2) opts.shape（旧的单形状参数）不得静默失效 */
  const b2 = document.createElement('div');
  R.renderRouteDemand(b2, { CA: makeGame() }, { shape: A });
  assert.ok(Math.abs(ratioOf(b2) - rA) < 0.1 * rA, 'opts.shape 应生效');

  /* 3) 长度不合格 → 跳到下一候选（而不是直接掉到 FALLBACK_SHAPE） */
  const b3 = document.createElement('div');
  R.renderRouteDemand(b3, { CA: makeGame() }, { shapes: { LEW: [1, 2, 3] }, shape: A });
  assert.ok(Math.abs(ratioOf(b3) - rA) < 0.1 * rA, '非法长度的 opts.shapes 应被跳过并回落到 opts.shape');

  /* 4) 前几级都非法 → 回落 GM.dayShape（前提：LEW 无自带 dayShape → 用例内显式准备） */
  const saved = MARKETS.LEW.dayShape;
  delete MARKETS.LEW.dayShape;
  try {
    const b4 = document.createElement('div');
    R.renderRouteDemand(b4, { CA: makeGame() }, { shapes: { LEW: [1, 2, 3] }, shape: [0, 1] });
    const rG = GM.dayShape[9] / GM.dayShape[12];
    assert.ok(Math.abs(ratioOf(b4) - rG) < 0.1 * rG, '应回落到 GM.dayShape');
  } finally {
    if (saved !== undefined) MARKETS.LEW.dayShape = saved;
  }

  /* 5) 前两级都合法时按既定顺序取 opts.shapes[code]（护栏：链的前两级顺序） */
  const B = GM.dayShape.slice();                   /* 与 A 明显不同：A 比 1.0、B 比 4.0 */
  const rB = B[9] / B[12];
  const b5 = document.createElement('div');
  R.renderRouteDemand(b5, { CA: makeGame() }, { shapes: { LEW: A }, shape: B });
  assert.ok(Math.abs(ratioOf(b5) - rA) < 0.1 * rA, 'opts.shapes[code] 应优先于 opts.shape');
  assert.ok(Math.abs(ratioOf(b5) - rB) > 0.1 * rB, '不应取到 opts.shape');
});

test('需求图：形状候选必须是有限数数组（字符串/含 NaN 一律跳过，曲线不得出现 NaN）', () => {
  const A = GM.dayShape.slice();
  A[12] = 1.0;
  const rA = A[9] / A[12];
  const ratioOf = (bx) => { const d = demandByHour(bx); return d.get(9) / d.get(12); };

  /* 长度为 24 的字符串（非数组）→ 跳过，回落到 opts.shape */
  const b1 = document.createElement('div');
  R.renderRouteDemand(b1, { CA: makeGame() }, { shapes: { LEW: '0'.repeat(24) }, shape: A });
  assert.ok(Math.abs(ratioOf(b1) - rA) < 0.1 * rA, '字符串候选应被跳过并回落到 opts.shape');
  assert.ok(!b1.innerHTML.includes('NaN'), '曲线不得出现 NaN');

  /* 含 NaN 的数组 → 跳过，回落到 opts.shape */
  const bad = A.slice();
  bad[3] = NaN;
  const b2 = document.createElement('div');
  R.renderRouteDemand(b2, { CA: makeGame() }, { shapes: { LEW: bad }, shape: A });
  assert.ok(Math.abs(ratioOf(b2) - rA) < 0.1 * rA, '含 NaN 的候选应被跳过并回落到 opts.shape');
  assert.ok(!b2.innerHTML.includes('NaN'), '曲线不得出现 NaN');

  /* 全部候选都非法 → 回落 GM.dayShape，仍不得出现 NaN（前提：LEW 无自带 dayShape） */
  const saved = MARKETS.LEW.dayShape;
  delete MARKETS.LEW.dayShape;
  try {
    const b3 = document.createElement('div');
    R.renderRouteDemand(b3, { CA: makeGame() }, { shapes: { LEW: 'x'.repeat(24) }, shape: [1, 2] });
    const rG = GM.dayShape[9] / GM.dayShape[12];
    assert.ok(Math.abs(ratioOf(b3) - rG) < 0.1 * rG, '应回落到 GM.dayShape');
    assert.ok(!b3.innerHTML.includes('NaN'), '曲线不得出现 NaN');
  } finally {
    if (saved !== undefined) MARKETS.LEW.dayShape = saved;
  }
});

/* ============================================================
   需求图柱＝官方口径（《界面指南 V4》第 19 项）
   ------------------------------------------------------------
   柱数＝各航司各航线的**日航班数**（每条排班＝每日 1 班）
   柱高＝该班次**单日承运**（季度承运量 ÷ 90），**不是**座位容量
   标题＝市场名 + (每日承运总量 passengers carried)
   夹具刻意让「座位 272 ≠ 单日承运 100/200/20」→ 画成座位容量必被比例断言抓住
   ============================================================ */
const BAR_DAYS = G.DAYS_PER_QUARTER;      /* 90 天/季 */

function mkBarGame(seat, deps, flights) {
  return {
    seat,
    routes: [{ code: 'LEW', fare: MARKETS.LEW.guide_fare, bh: MARKETS.LEW.bh }],
    schedules: deps.map((d, i) => ({ acId: i + 1, code: 'LEW', seats: 272, departure: d })),
    aircraft: deps.map((d, i) => ({ id: i + 1, type: 'G250', nickname: 'G250' })),
    lastDetail: flights ? { LEW: { flights } } : {},
  };
}

/* CA 三班：08:00 日承运 100、12:00 日承运 200、20:00 **无明细**（尚未结算） */
const CA_BAR = mkBarGame('CA', ['08:00', '12:00', '20:00'], [
  { departureMin: 480, served: 100 * BAR_DAYS, slot: 8 },
  { departureMin: 720, served: 200 * BAR_DAYS, slot: 12 },
]);
/* AB 一班：09:00 日承运 20 */
const AB_BAR = mkBarGame('AB', ['09:00'], [
  { departureMin: 540, served: 20 * BAR_DAYS, slot: 9 },
]);

/* Y 轴刻度 → 比例尺：把柱高（px）还原成数值（用轴标签反推，不复用被测实现） */
function barScale(svg) {
  const ticks = [...svg.querySelectorAll('text')]
    .filter(t => t.getAttribute('text-anchor') === 'end')
    .map(t => ({ y: +t.getAttribute('y'), v: parseFloat(t.textContent) }))
    .filter(p => Number.isFinite(p.y) && Number.isFinite(p.v));
  assert.ok(ticks.length >= 2, '应存在 Y 轴刻度');
  const top = ticks.reduce((a, b) => (a.y < b.y ? a : b));
  const bot = ticks.reduce((a, b) => (a.y > b.y ? a : b));
  const k = (bot.v - top.v) / (bot.y - top.y);
  return (px) => -k * px;
}

/* 柱 → {时刻, 航司, 座位, 单日承运, LF, 像素高, 还原数值} */
function barInfo(box) {
  const svg = box.querySelector('svg');
  const scale = barScale(svg);
  return [...svg.querySelectorAll('rect')].filter(r => r.querySelector('title')).map(r => {
    const p = r.querySelector('title').textContent.trim().split(/\s+/);
    const px = +r.getAttribute('height');
    return {
      clock: p[0], seat: p[1], seats: parseFloat(p[3]),
      carried: p[4] === '单日承运' ? parseFloat(p[5]) : null,
      lf: p[7] === 'LF' ? parseFloat(p[8]) : null,
      px, v: scale(px), x: +r.getAttribute('x'), raw: p.join(' '),
    };
  });
}

test('需求图：柱＝各航司日班次，柱高＝该班次单日承运（季度承运 ÷ 90，不是座位容量）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR, AB: AB_BAR });
  const bars = barInfo(box);
  assert.equal(bars.length, 4, '柱数应＝各航司日班次之和（CA 3 + AB 1）');

  const withData = bars.filter(b => b.carried != null);
  assert.equal(withData.length, 3, '三根班次有结算明细');
  for (const b of withData) {
    assert.ok(Math.abs(b.v - b.carried) <= Math.max(1, b.carried * 0.03),
      `柱高应＝单日承运 ${b.carried}（实测 ${b.v.toFixed(2)}）`);
    assert.ok(b.carried !== b.seats, '夹具要求：承运与座位必须可区分');
    assert.ok(Math.abs(b.lf - b.carried / b.seats * 100) <= 0.2,
      `LF 应＝单日承运 ÷ 座位（${b.carried}/${b.seats}）`);
  }
  /* 画成座位容量 → 两根 CA 柱等高（比 1）；单日承运口径 → 比 2 */
  const ca = withData.filter(b => b.seat === 'CA');
  assert.equal(ca.length, 2, 'CA 应有两根有明细的柱');
  const ratio = ca[1].v / ca[0].v;
  assert.ok(Math.abs(ratio - 2) < 0.1, '两根 CA 柱高度比应＝2（承运口径），实测 ' + ratio.toFixed(3));

  /* X 位＝起飞时刻：x 与时刻成线性（60 分 : 180 分 ≈ 1:3） */
  const at = (c) => bars.find(b => b.clock === c);
  const d1 = at('09:00').x - at('08:00').x;
  const d2 = at('12:00').x - at('09:00').x;
  assert.ok(d1 > 0 && Math.abs(d2 / d1 - 3) < 0.05, '柱 X 位应随起飞时刻线性');
});

test('需求图：无结算明细的班次不当成 0 承运（悬停写明暂无承运数据）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR });
  const bars = barInfo(box);
  const nd = bars.find(b => b.clock === '20:00');
  assert.ok(nd, '无明细班次仍应有柱（官方：柱数＝日班次数）');
  assert.equal(nd.carried, null, '无明细班次不应有承运数值');
  assert.ok(nd.raw.includes('暂无承运数据'), '悬停应写明暂无承运数据');
  assert.ok(!nd.raw.includes('单日承运 0'), '不得把无明细当成 0 承运');
});

test('需求图：标题按官方口径＝市场名 + (每日承运总量 passengers carried)', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR, AB: AB_BAR });
  const divs = [...box.querySelectorAll('div')];
  assert.ok(divs.some(d => d.textContent.trim() === MARKETS.LEW.name_cn),
    '标题行应显示市场名（name_cn 优先）');
  assert.ok(!divs.some(d => d.textContent.trim() === 'LEW'), '不应把航线代码当市场名');
  const m = /Flight Capacity and Actual Loads - \((\d+) passengers carried\)/.exec(box.textContent);
  assert.ok(m, '应输出官方标题格式');
  assert.equal(+m[1], 100 + 200 + 20, '标题数字＝各班次单日承运之和');
});

/* ══════════════════════════════════════════════════════════════════
   Task 4：需求图**版式**对齐官方《界面指南 V4》界面-19
   ------------------------------------------------------------
   只锁版式/口径文案，不改数据语义（分段语义见 Task 2、柱口径见 Task 3）。
   每条断言都应能抓住「改回旧实现」。
   ══════════════════════════════════════════════════════════════════ */

/* Y 轴刻度 → 值域换算（不复用被测实现的 Y()）：
   刻度文字有基线偏移，故用**网格线**的 y1 作几何基准（文字对应其正上方那条线） */
function yAxisOf(svg) {
  const lines = [...svg.querySelectorAll('line')].map(l => +l.getAttribute('y1'))
    .filter(y => Number.isFinite(y)).sort((a, b) => a - b);
  const texts = [...svg.querySelectorAll('text')]
    .filter(t => t.getAttribute('text-anchor') === 'end')
    .map(t => ({ y: +t.getAttribute('y'), v: parseFloat(t.textContent) }))
    .filter(p => Number.isFinite(p.y) && Number.isFinite(p.v))
    .sort((a, b) => a.y - b.y);
  assert.ok(texts.length >= 3, '应存在 Y 轴刻度');
  const pts = texts.map(t => {
    const cand = lines.filter(y => y <= t.y);
    return { lineY: cand.length ? Math.max(...cand) : t.y, v: t.v };
  });
  const top = pts.reduce((a, b) => (a.lineY < b.lineY ? a : b));
  const bot = pts.reduce((a, b) => (a.lineY > b.lineY ? a : b));
  return {
    ticks: pts.map(p => p.v),
    yMax: Math.max(...pts.map(p => p.v)),
    valueAt: (y) => bot.v + (bot.lineY - y) * (top.v - bot.v) / (bot.lineY - top.lineY),
  };
}

/* 需求曲线的峰值（用圆点 cy 反推，不复用被测实现的 Y()） */
function curvePeak(svg, ax) {
  const ys = [...svg.querySelectorAll('circle')].map(c => +c.getAttribute('cy'));
  assert.ok(ys.length, '应存在需求曲线圆点');
  return ax.valueAt(Math.min(...ys));
}

test('需求图：Y 轴标题用官方口径 Capacity and actual loads（旧文案已作废）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR });
  const texts = [...box.querySelectorAll('text')].map(t => t.textContent);
  assert.ok(texts.some(t => t === 'Capacity and actual loads'), 'Y 轴标题应为官方文案');
  assert.ok(!texts.some(t => t === 'Capacity per aircraft seats'), '不得保留旧 Y 轴文案');
});

test('需求图：Y 轴主刻度按 20 取整，最大刻度覆盖柱与曲线峰值', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR, AB: AB_BAR });
  const svg = box.querySelector('svg');
  const ax = yAxisOf(svg);
  for (const v of ax.ticks) assert.equal(v % 20, 0, '主刻度应为 20 的倍数：' + v);
  assert.equal(Math.min(...ax.ticks), 0, '应有 0 基线刻度');
  const peak = Math.max(curvePeak(svg, ax), ...barInfo(box).map(b => b.v));
  assert.ok(ax.yMax >= peak,
    `最大刻度 ${ax.yMax} 应覆盖峰值 ${peak.toFixed(1)}（旧实现 yMax 非 20 倍数且可能小于峰值）`);
});

test('需求图：X 轴逐时刻度 06:00–23:00（旧实现 04:00 起且每 2 小时）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR });
  const svg = box.querySelector('svg');
  const labels = [...svg.querySelectorAll('text')].map(t => t.textContent.trim())
    .filter(s => /^\d{2}:00$/.test(s));
  assert.ok(labels.includes('06:00'), '应含 06:00');
  assert.ok(labels.includes('23:00'), '应含 23:00');
  assert.deepEqual(labels.map(s => +s.slice(0, 2)),
    Array.from({ length: 18 }, (_, i) => i + 6), '应逐时连续 06:00–23:00');
});

test('需求图：曲线最右点（23:45）落在绘图区内（旧实现溢出 viewBox 被裁）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR });
  const svg = box.querySelector('svg');
  const vb = svg.getAttribute('viewBox').trim().split(/\s+/).map(Number);
  const width = vb[2];
  const gray = [...svg.querySelectorAll('polyline')].find(p => p.getAttribute('stroke') === '#8a929c');
  assert.ok(gray, '应存在灰色实际载量曲线');
  const xs = gray.getAttribute('points').trim().split(/\s+/).map(s => +s.split(',')[0]);
  assert.ok(Math.max(...xs) < width,
    `最右点 x=${Math.max(...xs)} 应 < viewBox 宽 ${width}（旧实现 X(23.75)≈639 越界）`);
  assert.ok(Math.min(...xs) > 0, '最左点应在画布内');
});

test('需求图：图例口径统一（底纹是灰色不是绿；柱＝日班次；灰线＝实际载量）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR });
  const txt = box.textContent;
  assert.ok(txt.includes('底纹＝枢纽高峰时段'), '图例应写明底纹＝枢纽高峰时段');
  assert.ok(!txt.includes('绿底纹'), '底纹实际是灰色，不得写「绿底纹」');
  assert.ok(txt.includes('柱＝各航司日班次'), '图例应写明柱＝各航司日班次');
  assert.ok(txt.includes('灰线＝实际载量'), '图例应写明灰线＝实际载量');
});

test('需求图：页内标题 FLIGHTS & DEMAND CHARTS + 金色规则线', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR });
  assert.ok(box.textContent.includes('FLIGHTS & DEMAND CHARTS'), '应含官方页内标题');
  /* jsdom 的 CSSOM 会把 #d8a33f 归一化成 rgb(216, 163, 63) → 两种写法都认 */
  const gold = [...box.querySelectorAll('div')].filter(d => {
    const st = d.getAttribute('style') || '';
    return st.includes('#d8a33f') || (d.style && d.style.backgroundColor === 'rgb(216, 163, 63)');
  });
  assert.ok(gold.length >= 1, '标题下应有金色规则线（--acc #d8a33f）');
});

test('需求图：灰色实际载量线为单日量纲（季度承运 ÷ 90），与柱/标题同量纲', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR, AB: AB_BAR });
  const svg = box.querySelector('svg');
  const ax = yAxisOf(svg);
  const gray = [...svg.querySelectorAll('polyline')].find(p => p.getAttribute('stroke') === '#8a929c');
  const vals = gray.getAttribute('points').trim().split(/\s+/).map(s => ax.valueAt(+s.split(',')[1]));
  const peak = Math.max(...vals);
  /* 夹具：08:00 日承运 100、09:00 日承运 20、12:00 日承运 200 → 灰线峰值应为 200（整季口径是 18000） */
  const tol = Math.max(12, ax.yMax * 0.02);
  assert.ok(Math.abs(peak - 200) <= tol,
    `灰线峰值应≈单日承运 200（整季口径 18000），实测 ${peak.toFixed(1)}`);
  /* 悬停说明也要写清单日 */
  const tt = [...box.querySelectorAll('circle title')].map(t => t.textContent);
  assert.ok(tt.some(s => /实际载量\s*\d+\s*人\/日/.test(s)), '悬停应写明实际载量为单日（人/日）');
});

/* ★ 修复轮：官方英文标题只在图表容器（reports.js）里渲染一次；
   两端 HTML 的 <h3> 只能是中文说明 → 同一句英文标题不能在页面上出现两遍 */
test('需求图：两端 HTML 不再重复官方英文标题（标题只在图表容器渲染一次）', () => {
  for (const f of ['player.html', 'teacher.html']) {
    const html = readFileSync(join(HERE, f), 'utf8');
    assert.ok(!html.includes('FLIGHTS &amp; DEMAND CHARTS') && !html.includes('FLIGHTS & DEMAND CHARTS'),
      f + ' 不应再出现官方英文标题（会与图内标题重复）');
    assert.ok(/航线需求图/.test(html), f + ' 应保留中文说明标题');
  }
});

test('需求图：回归——市场名仍用 name_cn（非航线代码）', () => {
  const box = document.createElement('div');
  R.renderRouteDemand(box, { CA: CA_BAR });
  const divs = [...box.querySelectorAll('div')];
  assert.ok(divs.some(d => d.textContent.trim() === MARKETS.LEW.name_cn), '应显示市场中文名');
  assert.ok(!divs.some(d => d.textContent.trim() === 'LEW'), '不应把航线代码当市场名');
});


/* ============================================================
   甘特图（官方 DAILY SCHEDULE）：07:00 起点 + 每小时竖线 + 点击选中黑描边
   ============================================================ */
test('甘特图：07:00 起、每小时竖线、点击航班块出现黑描边', () => {
  const box = document.createElement('div');
  const g = makeGame({ schedules: [{ acId: 1, code: 'LEW', departure: '08:00', seats: 100, flightNo: 'CA-1' }] });
  R.renderGantt(box, { CA: g });
  const xTicks = [...box.querySelectorAll('text')].map(t => t.textContent).filter(t => /^\d{2}:00$/.test(t));
  assert.equal(xTicks[0], '07:00', '首刻度应为 07:00，实得 ' + xTicks[0]);
  /* 竖线 = 时间刻度线（y 起点/终点不同、x 相同） */
  const vlines = [...box.querySelectorAll('line')].filter(l => l.getAttribute('y1') !== l.getAttribute('y2'));
  assert.ok(vlines.length >= 17, '应有 07:00–23:00 共 17 条竖线，实得 ' + vlines.length);
  /* 点击后整张 svg 重绘 → 旧节点失效，每次都从容器重新查 */
  const blk = () => [...box.querySelectorAll('rect')].filter(r => r.querySelector('title'));
  assert.ok(blk().length >= 1, '未找到航班块');
  blk()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(blk()[0].getAttribute('stroke'), '#111111', '选中块应带黑色描边');
});


/* ============================================================
   Reports 页签：新增「航线需求」（官方界面-19 入口）
   ============================================================ */
test('Reports：存在「航线需求」页签并能渲染出 SVG', () => {
  const root = document.createElement('div');
  const g = makeGame();
  g.history = [{ period: 'Q1 2028', turn: 0, revenue: 100, cost: 50, operating_profit: 50,
    oneoff: 0, financing: 0, cash_end: 100, load_factor: 0.5, paxTotal: 10, askTotal: 20,
    rpkTotal: 10, market_share: 0.3, gross_margin: 0.5, detail: {} }];
  R.renderReports(root, g);
  const btn = [...root.querySelectorAll('.tabs button')].find(b => /航线需求/.test(b.textContent));
  assert.ok(btn, '未找到「航线需求」页签');
  btn.click();
  assert.ok(root.querySelector('svg'), '页签内应渲染出 SVG');
});


/* ★ 旧的「Summary 呈现官方六项 KPI 卡片」用例已删（它的 KPI 清单含 Total Operating Cost = 原版误读），
   覆盖由下方新用例承担（口径 + 顺序 + 数值 + 页签状态复位）。 */


/* ============================================================
   COSTS SUMMARY 成本分解图（原版 Summary 页签下方，完全缺失项）
   结构：左列收入三分支 → 中列 Quarter → 右列 8 个成本/利润科目
   闭合等式：Σ收入 = Σ八项成本 + 经营利润（容差 $1）
   ============================================================ */
test('Summary：COSTS SUMMARY 图含 11 个标签且成本科目合计与报告 cost 闭合', async () => {
  const E = await import('./engine.js');
  const root = document.createElement('div');
  const g = makeGame();
  const detail = { LEW: {
    rev: { 'Passenger Revenue': 700, 'Cargo Revenue': 100, 'Ancillary Revenue': 100, 'Total Revenue': 900 },
    cost: { 'Fuel': 200, 'Carbon': 20, 'Sustainable Aviation Fuel': 0, 'Maintenance': 50,
      'Flight Crew': 100, 'Cabin Crew': 20, 'Landing': 30, 'Navigation': 20,
      'Aircraft Handling': 30, 'Traffic Handling': 20, 'Cargo Handling': 10,
      'Cargo Overheads': 10, 'General & Administration': 20, 'Passenger Services': 10,
      'Ticketing, Sales and Promotion': 10 },
    own: 40, leasePayments: 0 } };
  const fixed = E.F06_FIXED + E.F07_FIXED + E.F08_FIXED;   // 公司级固定项（机组/维护/燃油）
  const cost = 590 + fixed;
  g.history = [{ period: 'Q1 2028', turn: 0, revenue: 900, cost, operating_profit: 900 - cost,
    oneoff: 0, financing: 0, cash_end: 2000, load_factor: 0.56, paxTotal: 10, askTotal: 20,
    rpkTotal: 10, market_share: 0.3591, gross_margin: 0.13, detail, invCost: 0,
    breakEvenLF: 0.56, routeBE: [] }];
  R.renderReports(root, g);
  [...root.querySelectorAll('.tabs button')].find(b => /总览/.test(b.textContent)).click();
  const txt = root.textContent;
  for (const l of ['Passenger Revenue', 'Cargo Revenue', 'Ancillary Revenue', 'Quarter',
    'Fuel Costs', 'Maintenance Costs', 'Crew Costs', 'Handling Costs', 'Nav and Landing Costs',
    'Total Indirect Operating Costs', 'Total Ownership Costs', 'Profit']) {
    assert.ok(txt.includes(l), '成本分解图缺少：' + l);
  }
  assert.ok(txt.includes('收入 $900'), '应给出收入合计，实得片段：' + txt.slice(0, 260));
  assert.ok(txt.includes('$' + cost.toLocaleString()), '成本科目合计应等于报告 cost：$' + cost.toLocaleString());
});

test('Summary：未结算时成本分解图给出提示而非空白', () => {
  const root = document.createElement('div');
  const g = makeGame();       // 无 history → 本季未结算
  R.renderReports(root, g);
  [...root.querySelectorAll('.tabs button')].find(b => /总览/.test(b.textContent)).click();
  const txt = root.textContent;
  assert.ok(txt.includes('尚未结算'), '未结算时应给出提示，实得：' + txt.slice(0, 200));
  assert.ok(!txt.includes('NaN') && !txt.includes('undefined'), '不得出现 NaN/undefined');
});

/* ============================================================
   P3：状态色 --bad 必须对三种深底达 WCAG AA（≥4.5:1）
   —— 旧值 #c1544c 对卡片底仅 3.7:1，而「现金 -$2,575,774」这类最该被读懂的负值全用它
   ⚠ 原版席位三色（AB 绿 4.4 / VA 蓝 3.2）与图表红 3.1 不达 AA，是**刻意保留**的代价（H5 忠于原版）→ 不在此断言
   ============================================================ */
test('可读性：状态色 --bad 对页面底/卡片底/控件面均达 WCAG AA（≥4.5:1）', () => {
  const css = readFileSync(new URL('./player.html', import.meta.url), 'utf8');
  const root = (css.match(/:root\{([\s\S]*?)\}/) || [])[1] || '';
  const v = (n) => (root.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];
  const bad = v('bad');
  assert.ok(bad, '未解析到 --bad');
  const lum = (h) => {
    h = h.slice(1);
    const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      .map(x => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  for (const bg of ['bg', 'surface', 'raised']) {
    const c = v(bg);
    assert.ok(c, '未解析到 --' + bg);
    const r = ratio(bad, c);
    assert.ok(r >= 4.5, `--bad ${bad} 对 --${bg} ${c} 仅 ${r.toFixed(2)}:1（AA 需 4.5）`);
  }
  return `--bad ${bad} 三底色均 ≥4.5:1`;
});

/* ============================================================
   11-17 P0-2：竞争分配里「本方无班次」的市场，shares.player 必须是数字（0）
   —— 此前该键直接缺失 → 上层读到 undefined → 页面渲染出 NaN%
   ============================================================ */
test('竞争分配：本方在某市场无班次时，shares.player 仍是数字 0（不得 undefined）', () => {
  const g = G.newGame('CA');
  g.schedules = [];                       // 本方一班不排（ETN 是共享市场，竞品仍在飞）
  const alloc = G.allocateMarkets(g);
  const etn = alloc.ETN;
  assert.ok(etn, 'ETN 应有分配结果');
  assert.equal(typeof etn.shares.player, 'number',
    'shares.player 必须是数字（未投入运力 = 0），实得 ' + JSON.stringify(etn.shares.player));
  assert.equal(etn.shares.player, 0);
});

/* ============================================================
   P0-2 FLIGHT INFORMATION 弹窗：顶部季度页签可切换（此前只测了数值口径，未测交互）
   ============================================================ */
test('FLIGHT INFORMATION 弹窗：季度页签可切换到历史季', () => {
  const root = document.createElement('div');
  const g = makeGame();
  const mkSeason = (period, pax, fuel) => ({
    period, turn: 0, revenue: 1000, cost: 600, operating_profit: 400, oneoff: 0, financing: 0,
    cash_end: 2000, load_factor: 0.56, paxTotal: pax, askTotal: 20, rpkTotal: 10,
    market_share: 0.3591, gross_margin: 0.13, breakEvenLF: 0.56, routeBE: [], invCost: 0,
    detail: { LEW: {
      freq: 90, ask: 1e6, rpk: 5e5, pax, seats: 100, fare: 120, lf: 0.5,
      rev: { 'Passenger Revenue': pax * 10, 'Cargo Revenue': 0, 'Ancillary Revenue': 0, 'Total Revenue': pax * 10 },
      cost: { Fuel: fuel, Carbon: 0, Maintenance: 50, 'Flight Crew': 60 },
      operating_profit: 100, marketDemand: 1000, share: 0.5, rivals: [], connected_pax: 0,
      flights: [{ departureMin: 480, served: pax * 90, slot: 8 }],
      own: 40, leasePayments: 0 } } });
  g.history = [mkSeason('Q1 2028', 100, 200), mkSeason('Q2 2028', 200, 400)];
  g.schedules = [{ acId: 1, code: 'LEW', seats: 100, departure: '08:00', flightNo: 'CA-1' }];
  g.aircraft = [{ id: 1, type: 'APT100', seats: 100, nickname: 'APT100' }];
  g.lastDetail = g.history[1].detail;
  R.renderReports(root, g);
  [...root.querySelectorAll('.tabs button')].find(b => /航班与利用/.test(b.textContent)).click();
  const btn = [...root.querySelectorAll('td')].find(td => /详情/.test(td.textContent));
  assert.ok(btn, 'Flights 页签应出现「≡ 详情」入口');
  btn.click();
  const pop = document.getElementById('flightPop');
  assert.ok(pop, '未打开 FLIGHT INFORMATION 弹窗');
  const qtabs = [...pop.querySelectorAll('.tabs button')];
  assert.equal(qtabs.length, 2, '弹窗顶部应有两个季度页签，实得 ' + qtabs.length);
  assert.ok(/Q2 2028/.test(pop.textContent), '默认显示最新季度 Q2 2028');
  qtabs[0].click();
  const pop2 = document.getElementById('flightPop');
  assert.ok(pop2 && /Q1 2028/.test(pop2.textContent), '点第一个季度页签后应切到 Q1 2028');
});

/* ============================================================
   票价矩阵改「网格」形态（官方界面-3 / Role Guide p11：行=市场、列=航司）
   ============================================================ */
test('票价矩阵：网格形态——行=市场、列=各航司、格内报价', () => {
  const root = document.createElement('div');
  const g = makeGame({ peerFares: { CA: [{ code: 'LEW', fare: 100 }], AB: [{ code: 'LEW', fare: 120 }] } });
  R.renderOpsViews(root, g);
  const btn = [...root.querySelectorAll('.tabs button')].find(b => /票价矩阵/.test(b.textContent));
  assert.ok(btn, '未找到「票价矩阵」页签');
  btn.click();
  const txt = root.textContent;
  assert.ok(txt.includes('路易斯'), '应出现市场名（name_cn）');
  assert.ok(/\$100/.test(txt) && /\$120/.test(txt), '格内应含各航司报价');
  assert.ok(/—/.test(txt), '未开通市场应显示 —');
});


/* ============================================================
   Summary 六张 KPI 卡：口径与顺序对齐原版（Reports(VIEW REPORTS)-Summary.jpg）
   ★ 原版第 3 张卡是 **Market Share 35.91%**，不是 Total Operating Cost
     （后者只作为成本分解图里的科目出现）—— 11-12 规格曾误读，本轮更正
   ============================================================ */
test('Summary：六张 KPI 卡为原版口径与顺序（含 Market Share、无 Total Operating Cost）', () => {
  const root = document.createElement('div');
  const g = makeGame();
  g.qsi = 4.5;   /* 原版 QSI 4.50 */
  g.history = [{ period: 'Q1 2028', turn: 0, revenue: 1000, cost: 600, operating_profit: 400,
    oneoff: 0, financing: 0, cash_end: 2000, load_factor: 0.56, paxTotal: 10, askTotal: 20,
    rpkTotal: 10, market_share: 0.3591, gross_margin: 0.0013, detail: {},
    breakEvenLF: 0.56, routeBE: [] }];
  R.renderReports(root, g);
  /* 页签是模块级状态 → 显式点回「总览」，断言不依赖测试执行顺序 */
  [...root.querySelectorAll('.tabs button')].find(b => /总览/.test(b.textContent)).click();
  const txt = root.textContent;
  for (const l of ['Average Load Factor', 'Quality Service Indicator', 'Market Share',
    'Break-even Load Factor', 'Margin', 'Closing Cash']) assert.ok(txt.includes(l), '缺少 KPI：' + l);
  assert.ok(txt.includes('56.0%'), 'Break-even LF 应显示 56.0%');
  assert.ok(txt.includes('4.50'), 'QSI 应显示 4.50');
  assert.ok(txt.includes('$2,000'), 'Closing Cash 应显示 $2,000');
  assert.ok(!txt.includes('Total Operating Cost'), '不应再出现 Total Operating Cost 卡');
  assert.ok(txt.includes('35.91%'), 'Market Share 应显示 35.91%，实得片段：' + txt.slice(0, 200));
  const order = ['Average Load Factor', 'Quality Service Indicator', 'Market Share',
    'Break-even Load Factor', 'Margin', 'Closing Cash'].map(l => txt.indexOf(l));
  assert.ok(order.every((v, i) => i === 0 || v > order[i - 1]), '卡片顺序应与原版一致：' + order.join(','));
});

/* ============================================================
   TD-12 字段名：市场名一律 name_cn（渲染不得出现 undefined / 航线代码）
   ============================================================ */
test('报表：各页签渲染的市场名用 name_cn（不出现 undefined）', () => {
  const root = document.createElement('div');
  const g = makeGame();
  /* 完整的航线明细（含 rev/cost 分项，否则网络经济页签会抛异常） */
  const detail = { LEW: {
    freq: 540, ask: 1e6, rpk: 5e5, pax: 500, seats: 100, fare: 120, lf: 0.5,
    rev: { 'Passenger Revenue': 500, 'Cargo Revenue': 0, 'Ancillary Revenue': 0, 'Total Revenue': 500 },
    cost: { Fuel: 100, Carbon: 50, Maintenance: 80, 'Flight Crew': 60 },
    operating_profit: 210, marketDemand: 1000, share: 0.5, rivals: [], connected_pax: 0,
  } };
  g.history = [{ period: 'Q1 2028', turn: 0, revenue: 100, cost: 50, operating_profit: 50,
    oneoff: 0, financing: 0, cash_end: 100, load_factor: 0.5, paxTotal: 10, askTotal: 20,
    rpkTotal: 10, market_share: 0.3, gross_margin: 0.5, detail }];
  R.renderReports(root, g);
  /* 页签两级化（11-17）：默认 4 个高频 + 「更多报表」→ 展开后才是 10 个 */
  const tabs = [...root.querySelectorAll('.tabs button')];
  assert.equal(tabs.length, 5, '默认应露 4 个高频页签 + 更多按钮，实得 ' + tabs.length);
  const more = tabs.find(b => /更多报表/.test(b.textContent));
  assert.ok(more, '缺「更多报表」按钮');
  more.click();
  assert.equal(root.querySelectorAll('.tabs button').length, 11, '展开后应为 10 个页签 + 更多按钮');
  for (const b of tabs) {
    b.click();
    const txt = root.textContent;
    assert.ok(!txt.includes('undefined'), '页签「' + b.textContent + '」渲染出 undefined（TD-12 字段名错误）');
  }
});

/* ============================================================
   P-12：票价网格显示分时档价（官方按「枢纽机场高峰时段的航班」调价）
   ============================================================ */
test('票价网格：显示分时档价（峰/谷），竞对仅公开基准运价', () => {
  const root = document.createElement('div');
  const g = makeGame({ peerFares: { CA: [{ code: 'LEW', fare: 100 }], AB: [{ code: 'LEW', fare: 150 }] } });
  R.renderOpsViews(root, g);
  const btn = [...root.querySelectorAll('.tabs button')].find(b => /票价矩阵/.test(b.textContent));
  assert.ok(btn, '未找到「票价矩阵」页签');
  btn.click();
  const txt = root.textContent;
  assert.ok(txt.includes('峰') && txt.includes('谷'), '应显示峰/谷分时档价');
  assert.ok(txt.includes('$100'), '我方基准价 $100');
  assert.ok(txt.includes('$120'), '我方峰时价（100×1.2）');
  assert.ok(txt.includes('$85'), '我方谷时价（100×0.85）');
  assert.ok(txt.includes('$150'), '竞对基准价 $150');
});
