/* ============================================================
   AI 竞争对手 —— Air Ballistic (AB) / VisionAir (VA)
   ------------------------------------------------------------
   依据官方 p61/63/65 的三队分工与 p95/96 的差异化目标:
     AB = Hybrid Carrier  毛利率13% 辅营15% 货运5% 累计利润$10M Q6单季$0.3M
     VA = Hybrid Carrier  毛利率8%  累计利润$20M 日利用12BH 客座率60% 份额35%
   行为:
     - 依据市场吸引力(人口×GDP×弹性)选择开航目标
     - 运价贴近指导价，对手压价时跟随小幅贴价
     - 短程机夜返 HUB，长程需 ETOPS
     - 每回合重新分配班次
   ============================================================ */
import { GM, MARKETS, MARKET_LIST, AIRCRAFT } from './data.js';
import * as E from './engine.js';

const rnd = (seed) => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };

/**
 * AI 竞品的标定参数（由 calibrate_ai.mjs 从真实 Route Share 反解的竞品效用轨迹标定）
 * 留一市场样本外检验：训练 RMSE 0.592 → 测试 RMSE 0.687 log-odds（劣化 +0.095，无系统性过拟合）
 */
export const AI_PARAMS = {
  kPrice: 1.15,        // 竞品定价 = 指导价 × kPrice
  followRatio: 0.9,   // 跟价系数（玩家更便宜时）
  qsiPrice: 0,     // QSI → 提价幅度
  flightsPerAc: 3,    // 每机每日目标班次数
  qsiOffset: 1,       // 竞品 QSI 相对玩家的偏移
};

export const RIVALS = {
  AB: {
    code: 'AB', name: 'Air Ballistic', name_cn: '弹道航空',
    style: 'hybrid', fleet: ['G130', 'G130', 'G130 P1', 'G160', 'G160 P1', 'APT100'],
    cash: 3200000, qsi: 4.2, aggression: 0.72,
    target: { margin: 0.13, ancillary: 0.15, cargo: 0.05, cumProfit: 10000000 },
  },
  VA: {
    code: 'VA', name: 'VisionAir', name_cn: '愿景航空',
    style: 'hybrid', fleet: ['APT100', 'APT100', 'G160XLR', 'G160XLR P1', 'G160XLR P1', 'G200LR'],
    cash: 3600000, qsi: 4.6, aggression: 0.85,
    target: { margin: 0.08, cumProfit: 20000000, util: 12, lf: 0.60 },
  },
};

function mkComp(spec, seed) {
  const r = rnd(seed);
  return {
    ...spec,
    seed, r,
    routes: [],                      // {code, fare, openedTurn}
    aircraft: spec.fleet.map((t, i) => ({
      id: i + 1, type: t,
      seats: AIRCRAFT.find(a => a.name === t).seats,
      price: AIRCRAFT.find(a => a.name === t).price * 1e6,
      lastRPK: 0, lastPax: 0,
    })),
    schedules: [],
    qsi: spec.qsi,
    cash: spec.cash,
  };
}

/** 市场吸引力：人口 × GDP 增长 × 需求弹性倒数(越不敏感越好赚) */
function attractiveness(code) {
  const m = MARKETS[code];
  if (!m) return 0;
  const pop = Math.log10(Math.max(m.pop, 100));
  const gdp = m.gdp_growth / 100;
  const elas = 1 / (1 + 0.05 * (m.elasticity || 1));   // 弹性越低越优质
  const cargo = Math.log10(Math.max(m.cargo_demand, 1)) * 0.25;
  const dist = m.sector_km > 2000 ? 0.9 : 1.0;        // 长程收益高但风险大
  return (pop * 0.5 + gdp * 1.2 + elas * 1.5 + cargo) * dist;
}

/** AI 决策：开航 / 运价 / 班次 */
export function stepCompetitors(g) {
  const out = [];
  /* ★ 课程裁定（2026-11-03）：AI 竞品与玩家受**同等运力约束**（短程 2 班/日、长程 1 班/日）
     → 生成班次后统一裁剪，避免 AI 无限扩张运力、玩家份额被长期挤出 */
  const capPerAc = (ac) => (ac && ac.long) ? 1 : 2;
  for (const c of (g.competitors || [])) {
    if (!c) continue;
    const myRoutes = new Set(g.routes.map(r => r.code));
    const theirRoutes = new Set(c.routes.map(r => r.code));

    // 1) 开航决策
    /* ★ 竞品不闯入玩家已占据的市场（玩家份额 > 60% 即视为强势市场）
       依据：原版 CA 的 Simone 长期独占 100%（Q4/2027 → Q1/2028 notes「Simone 垄断」）
       → 若允许竞品自由进入，玩家独占市场的份额/LF 会被系统性侵蚀 */
    const playerShare = {};
    for (const [cd, dd] of Object.entries(g.lastDetail || {})) playerShare[cd] = dd.share || 0;
    const openable = MARKET_LIST.filter(code =>
      !theirRoutes.has(code) && !myRoutes.has(code) &&
      !(playerShare[code] > 0.6) &&
      c.cash > GM.start_cash * 1.2);
    if (openable.length) {
      openable.sort((a, b) => attractiveness(b) - attractiveness(a));
      const want = c.r() < c.aggression ? 1 : 0;
      for (let i = 0; i < want; i++) {
        const code = openable[i];
        const m = MARKETS[code];
        const fee = GM.new_route_fee + (m.etops ? GM.etops_fee : 0);
        if (c.cash < fee * 2) continue;
        c.cash -= fee;
        const guide = m.guide_fare || 150;
        c.routes.push({ code, fare: guide, openedTurn: g.turn });
        c.log = c.log || [];
        c.log.push(`${g.turn + 1}季 开通 ${m.name_cn} @ $${guide}`);
      }
    }

    // 1.5) 服务水平：竞品的服务水平跟随市场基准（玩家 QSI + 标定偏移）
    //      qsiOffset 来自真实 Route Share 反推（真实游戏中竞品服务水平略高于 CA）
    const qsiTarget = (g.qsi || 4.5) + AI_PARAMS.qsiOffset;
    c.qsi = Math.round((c.qsi * 0.6 + qsiTarget * 0.4) * 10) / 10;

    // 2) 运价决策：贴近指导价；玩家更便宜则跟价抢量；QSI 高则提价
    //    ★ 参数由 calibrate_ai.mjs 标定（目标：AI 生成的竞品效用逼近
    //      从真实 Route Share 反解出的竞品效用轨迹）
    //      留一市场样本外：份额 RMSE 训练 0.063pp → 测试 0.069pp（劣化 +0.005pp）
  //      对照：自由截距模型的份额样本外误差 24pp
    for (const r of c.routes) {
      const m = MARKETS[r.code];
      const guide = m.guide_fare;
      let target = guide ? guide * AI_PARAMS.kPrice : r.fare * AI_PARAMS.kPrice;
      // 若玩家也在该航线且玩家运价更低 → 跟价
      const pr = g.routes.find(x => x.code === r.code);
      if (pr && pr.fare < r.fare * 0.97) target = pr.fare * AI_PARAMS.followRatio;
      // 需求强(QSI高)则提价
      target *= (1 + (c.qsi - 4) * AI_PARAMS.qsiPrice);
      r.fare = Math.round(target);
    }

    // 3) 班次分配：每条航线按吸引力分配日班次
    c.schedules = [];
    const flightsPerAc = AI_PARAMS.flightsPerAc;
    const alloc = c.routes.map(r => ({ r, w: attractiveness(r.code) }))
      .sort((a, b) => b.w - a.w);
    let slots = c.aircraft.length * flightsPerAc;
    for (const { r } of alloc) {
      if (slots <= 0) break;
      const take = Math.min(slots, Math.max(1, Math.round(alloc.length ? slots * 0.4 : 0)));
      for (let i = 0; i < take; i++) {
        const ac = c.aircraft[i % c.aircraft.length];
        c.schedules.push({ acId: ac.id, code: r.code, seats: ac.seats,
          bh: MARKETS[r.code].bh * 2, cargoCap: 0,
          departure: ['06:00', '10:00', '14:00', '18:00', '22:00'][i % 5],
          flightNo: `${c.code}-${2000 + Math.floor(c.r() * 7000)}` });
      }
      slots -= take;
    }
    out.push(c);
  }
  /* 运力上限裁剪（与玩家同等约束：短程 2 班/日、长程 1 班/日） */
  for (const c of (g.competitors || [])) {
    if (!c || !c.schedules) continue;
    const keep = []; const cnt = new Map();
    for (const s of c.schedules) {
      const ac = (c.aircraft || []).find(a => a.id === s.acId);
      const cap = capPerAc(ac);
      const n = cnt.get(s.acId) || 0;
      if (n >= cap) continue;
      cnt.set(s.acId, n + 1); keep.push(s);
    }
    c.schedules = keep;
  }
  return out;
}

/** 计算竞品的 RPK / 载运（用于市场份额） */
export function settleCompetitors(g) {
  for (const c of (g.competitors || [])) {
    let rpk = 0, pax = 0;
    for (const r of c.routes) {
      const m = MARKETS[r.code];
      const fl = c.schedules.filter(s => s.code === r.code);
      if (!fl.length) continue;
      const freq = fl.length * 90;
      const seats = fl.reduce((a, s) => a + s.seats, 0) * freq;
      // ★ 竞争分配：竞品只拿自己的份额（与玩家共用 g.__alloc，无重复计量）
      const al = (g.__alloc || {})[r.code];
      const key = c.code || ('comp' + (c.id || 0));
      const D = al ? (al.alloc[key] ?? 0) : E.demand(m.name, r.fare, freq, g.demandMult[r.code] ?? 1);
      const served = Math.min(seats, D);
      rpk += served * m.sector_km;
      pax += served;
    }
    c.lastRPK = rpk; c.lastPax = pax;
  }
}

export function initCompetitors(g, seed = 20261021) {
  g.competitors = [
    mkComp(RIVALS.AB, seed + 7),
    mkComp(RIVALS.VA, seed + 13),
  ];
  // 开局各给一条航线
  g.competitors[0].routes.push({ code: 'SIM', fare: 135, openedTurn: 0 });
  g.competitors[1].routes.push({ code: 'ETN', fare: 240, openedTurn: 0 });
  g.competitors[0].aircraft[0].lastRPK = 0;
  return g.competitors;
}
