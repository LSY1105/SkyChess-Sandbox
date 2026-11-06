/* ============================================================
   三玩家 + 裁判 全流程模拟 —— 项目完整性测试
   ------------------------------------------------------------
   跑完整对局：3 家航司（策略各异）+ 裁判（事件/油价/利率/市场开放）
   每回合断言不变量，任何违反立即报错。

   用法: node sim3.js [局数] [种子]
   ============================================================ */
import { GM, MARKETS, MARKET_LIST, AIRCRAFT, INVESTMENTS, ASSETS, EVENTS } from './data.js';
import * as E from './engine.js';
import * as G from './game.js';
import { initCompetitors, stepCompetitors, settleCompetitors } from './competitors.js';

const rnd = (seed) => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---------- 三个玩家策略 ---------- */
const STRATEGIES = {
  /* sched = 显式班次配置（对齐原版实录，避免"班次摊薄到多航线"导致 LF 塌陷）：
       CA 型：SIM 6 班/日($135, APT100) + ETN 4 班/日($220, G160)
       AB 型：SIM 4 + ETN 3 + FTZ 3
       VA 型：McGee 1 班/日($825, 需 ETOPS + 过夜) + Broonzy 1 + Armstrong 1 */
  /* 三家策略 —— 机队/航线/票价贴近**原版实录**（而非随手设定）：
       CA（低成本）Fleet Plans Q0：G160 + APT100 = 260 座；
            ROUTE METRICS Q4/2027：SIM 6 班/日 + ETN 4 班/日；
            执行过程报告 Q1 2028：SIM $135 / ETN $220
       VA（全服务）复盘 Q2 2028：租入 G160XLR，McGee $825 独飞 100% 份额
       长程机型折旧重（按官方目录价），必须配高票价长航线才可行 —— 这正是教学要点。 */
  LCC: {
    name: 'LCC', fleet: ['G160', 'APT100'], cash: GM.start_cash,
    farePolicy: (m) => ({ SIM: 135, ETN: 220, LEW: 110, FTZ: 155, JOP: 170 }[m.code] || (m.guide_fare || 160)),
    routes: ['SIM', 'ETN'], qsiTarget: 8.0, invest: ['adv_web', 'adv_social'],
    sched: [ { code:'SIM', ac:1, perDay:6, fare:135 }, { code:'ETN', ac:0, perDay:4, fare:220 } ],
  },
  HYB: {
    name: 'HYB', fleet: ['G160', 'APT100'], cash: GM.start_cash * 1.4,
    farePolicy: (m) => ({ SIM: 150, ETN: 210, LEW: 120, FTZ: 175, JOP: 180 }[m.code] || (m.guide_fare || 180)),
    routes: ['SIM', 'ETN', 'FTZ'], qsiTarget: 6.0, invest: ['ife_basic'],
    sched: [ { code:'SIM', ac:1, perDay:4, fare:150 }, { code:'ETN', ac:0, perDay:3, fare:210 }, { code:'FTZ', ac:0, perDay:3, fare:175 } ],
  },
  FSC: {
    /* 原版 VA 第六季远程机队：G160XLR 003 + P1 004 + P1 008（PPT P73）→ 3 架远程机
       ★ 长程机型**每机每日仅 1 班**（往返 + 过夜），故远程运力 = 机数 × 1 班/日/机，
         必须有足够机数才能撑起 McGee 等长程航线 */
    name: 'FSC', fleet: ['G160XLR', 'G160XLR', 'G160XLR'], cash: GM.start_cash * 4.5, lease: true,
    farePolicy: (m) => ({ GEE: 825, BZY: 700, ARM: 650, ETN: 215, SIM: 120 }[m.code] || (m.guide_fare || 260)),
    routes: ['GEE', 'BZY', 'ARM'], qsiTarget: 5.0, invest: ['adv_tv', 'adv_print'], etops: true,
    sched: [ { code:'GEE', ac:0, perDay:1, fare:825 }, { code:'BZY', ac:1, perDay:1, fare:700 },
             { code:'ARM', ac:2, perDay:1, fare:650 } ],
  },
};

function mkPlayer(spec, seed) {
  const r = rnd(seed);
  const p = {
    ...spec, r, code: spec.name,
    // ETOPS：原版 VA（长程机型）Q1 2028「出于战略考虑抢先申请 ETOPS 能力」
    //   → 需 ETOPS 的市场（McGee/Broonzy/Armstrong）对 FSC 开放，否则远程机无法运营
    routes: spec.routes.map(c => ({
      code: c, fare: MARKETS[c].guide_fare || 180, openedTurn: 0,
      etopsPaid: !!(MARKETS[c].etops && spec.etops),
    })),
    aircraft: spec.fleet.map((t, i) => {
      const a = AIRCRAFT.find(x => x.name === t);
      const price = a.price * 1e6;
      return {
        id: i + 1, type: t, owned: !spec.lease, price,
        acquiredTurn: 0, age: 0, seats: a.seats,
        eco: a.eco, prem: a.prem, biz: a.biz, mtow: a.mtow,
        fuel: a.fuel, dmc_c: a.dmc_c, dmc_fh: a.dmc_fh, long: a.long,
        cargo: a.cargo ?? 0, cab_min: a.cab_min ?? 1,
        nickname: spec.lease ? 'Leased' : 'Owned',
      };
    }),
    leases: spec.lease ? spec.fleet.map((t, i) => {
      const price = AIRCRAFT.find(x => x.name === t).price * 1e6;
      return {
        acId: i + 1, type: t,
        deposit: price * GM.lease_deposit_rate,
        quarterlyRent: price * GM.lease_rate_annual / 4,
        monthsLeft: GM.lease_min_months, startTurn: 0,
      };
    }) : [],
    schedules: [], qsi: 4.5, lastDetail: {}, history: [],
    bankrupt: false,
  };
  // 租赁机队的押金从初始现金里扣（真实游戏开局亦需支付押金）
  p.cash = spec.cash - (p.leases || []).reduce((a, l) => a + l.deposit, 0);
  return p;
}

/* ---------- 裁判 ---------- */
function gmTurn(gm, turn, players) {
  // 1) 油价按剧本波动
  const path = [2.40, 2.50, 2.60, 4.50, 3.75, 2.75, 2.70];
  gm.fuelPrice = path[Math.min(turn, path.length - 1)] * (1 + (gm.r() - 0.5) * 0.12);
  gm.carbonPrice = turn >= 3 ? 52.0 : 22.0;
  gm.interestRate = turn >= 2 ? 4.0 : 5.0;

  // 2) 事件：第 3 回合起随机触发
  if (turn >= 2 && gm.r() < 0.35) {
    const pool = EVENTS.filter(e => e.id !== 'pandemic');
    const ev = pool[Math.floor(gm.r() * pool.length)];
    let target = null;
    if (ev.scope === 'market') {
      const opened = MARKET_LIST.filter(c => players.some(p => p.routes.some(r => r.code === c)));
      if (opened.length) target = opened[Math.floor(gm.r() * opened.length)];
    } else if (ev.scope === 'airline') {
      const p = players[Math.floor(gm.r() * players.length)];
      const ac = p.aircraft[0];
      target = ac ? ac.type : null;
      if (ev.effect.util_cap) { p.utilCap = p.utilCap || {}; p.utilCap[ac.type] = { bh: ev.effect.util_cap * 90, turnsLeft: ev.effect.turns || 1 }; }
      if (ev.effect.qsi) p.qsi = Math.max(0, p.qsi + ev.effect.qsi);
    }
    gm.log.push(`T${turn} 事件 ${ev.title} @ ${target || '全局'}`);
  }
  // 3) 市场开放
  if (turn === 3) { gm.newMarkets = ['JOP', 'CHA', 'BZY']; }
}

/* ---------- 玩家决策 ---------- */
function playerTurn(p, turn, gm) {
  if (p.bankrupt) return;
  p.fuelPrice = gm.fuelPrice; p.carbonPrice = gm.carbonPrice;
  p.interestRate = gm.interestRate; p.carbon_price = gm.carbonPrice;
  // QSI 投资维持
  for (const id of p.invest) {
    const inv = INVESTMENTS.find(x => x.id === id);
    if (inv && inv.annual) { p.cash -= inv.annual; p.qsi = Math.min(10, p.qsi + inv.effect.qsi * 0.15); }
  }
  // 开航
  if (gm.newMarkets && gm.newMarkets.length) {
    const code = gm.newMarkets.shift();
    const m = MARKETS[code];
    const fee = GM.new_route_fee + (m.etops ? GM.etops_fee : 0);
    if (p.cash > fee * 3 && !p.routes.some(r => r.code === code)) {
      p.cash -= fee;
      p.routes.push({ code, fare: m.guide_fare || 200, openedTurn: turn, etopsPaid: false });
    }
  }
  // 运价
  for (const r of p.routes) {
    const m = MARKETS[r.code];
    r.fare = Math.round(p.farePolicy(m, p) * (1 + (p.qsi - 4.5) * 0.04));
  }
  /* 排班：按**显式班次配置**（对齐原版实录的航线-机型-班次密度）
     —— 此前"每架飞机在每条航线都排 n 班"会把运力摊薄到 3–4 条航线，
        每线每机型班次过少 → 每班分得需求小 → LF 塌陷、收入不足覆盖固定成本。 */
  p.schedules = [];
  const usedBH = {};
  const shapeOf = (name) => E.dayShape(name);
  for (const s of (p.sched || [])) {
    const ac = p.aircraft[s.ac];
    const m = MARKETS[s.code];
    const r = p.routes.find(x => x.code === s.code);
    if (!ac || !m || !r) continue;
    r.fare = s.fare;                                   // 该航线的执行价（原版实录）
    const cap = G.acCapacity({ utilCap: p.utilCap || {} }, ac) || 0;
    const room = cap - (usedBH[ac.id] || 0);
    const perAc = Math.min(s.perDay, Math.floor(room / 90 / m.bh));
    if (perAc <= 0) continue;
    const turn = G.turnaroundFor(ac, s.code);
    const bhMin = m.bh * 60;
    const longHaul = !!ac.long;                        // 过夜资格按机型能力（演练规则）
    /* 候选起飞时刻：短程须当日返航（22:00 前），长程允许过夜；
       按日内需求曲线排序取用（错峰失客是真实代价） */
    const shape = shapeOf(m.name);
    const cand = [];
    for (let t = 6 * 60; t <= 22 * 60; t += Math.ceil(bhMin + turn)) {
      if (!longHaul && t + 2 * bhMin + turn > 22 * 60) continue;
      cand.push({ t, hhmm: G.minToHHMM(t), w: shape[Math.max(0, Math.min(23, Math.floor(t / 60)))] });
    }
    cand.sort((a, b) => b.w - a.w);
    const n = Math.min(perAc, cand.length);
    if (n <= 0) continue;
    usedBH[ac.id] = (usedBH[ac.id] || 0) + n * m.bh * 90;
    const chosen = cand.slice(0, n).sort((a, b) => a.t - b.t);
    for (const c of chosen) {
      p.schedules.push({
        acId: ac.id, code: r.code, ac, seats: ac.seats, bh: m.bh,
        cargoCap: ac.cargo ?? 0, departure: c.hhmm,
        flightNo: `${p.code}-${1000 + p.schedules.length}`,
      });
    }
  }
}

/* ---------- 结算单个玩家 ---------- */
function settlePlayer(p, turn, rivals = []) {
  /* 把另外两家包装成**真实竞品**（原版是三方同市场竞争，不是各自独占）
     竞品结构见 competitors.js：{code, qsi, routes, schedules, aircraft} */
  const competitors = rivals.map(x => ({
    code: x.code, qsi: x.qsi,
    routes: (x.routes || []).map(r => ({ code: r.code, fare: r.fare, openedTurn: 0 })),
    schedules: (x.schedules || []).map(s => ({
      code: s.code, ac: s.ac, seats: s.seats, bh: s.bh,
      cargoCap: s.cargoCap, departure: s.departure,
    })),
    aircraft: x.aircraft || [], demandMult: {},
  }));
  const fake = { ...p, schedules: p.schedules, routes: p.routes, qsi: p.qsi,
                 connectingDemand: 2, lastDetail: p.lastDetail, competitors,
                 demandMult: p.demandMult || {}, utilCap: p.utilCap || {},
                 groundUntil: p.groundUntil || {}, fuelPrice: p.fuelPrice,
                 carbonPrice: p.carbonPrice, interestRate: p.interestRate,
                 carbon_price: p.carbonPrice, leases: [], loans: [],
                 investments: [], assets: [], turn: p.history.length };
  /* ★ 先做竞争分配（三家同市场博弈），再结算 —— 原版即如此
     （此前直接 computeTurn → __alloc 为空 → 各家独占市场，与原版不符） */
  G.allocateMarkets(fake);
  const rep = G.computeTurn(fake, G.currentPeriod({ turn }));
  if (process.env.SIM_DEBUG && turn === 0) {
    const dsum = (k) => Math.round(Object.values(rep.detail).reduce((a, d) => a + (d.cost?.[k] || 0), 0));
    console.log(`  [DBG] ${p.code}: 班次/日=${p.schedules.length} 收入=${Math.round(rep.revenue)}`
      + ` 成本=${Math.round(rep.cost)} 碳=${dsum('Carbon')} 燃油=${dsum('Fuel')} 旅=${Math.round(rep.paxTotal)}`
      + ` 现金=${Math.round(rep.cash_end)}`);
  }
  p.lastDetail = rep.detail;
  p.cash = rep.cash_end;
  p.history.push(rep);
  return rep;
}

/* ---------- 不变量断言 ---------- */
function assertInvariants(p, rep, turn, errors) {
  const E_ = (cond, msg) => { if (!cond) errors.push(`T${turn} ${p.code}: ${msg}`); };
  E_(Number.isFinite(rep.revenue), '收入非有限数');
  E_(Number.isFinite(rep.cost), '成本非有限数');
  E_(Number.isFinite(rep.cash_end), '现金非有限数');
  E_(rep.revenue >= 0, '收入为负');
  E_(rep.cost >= 0, '成本为负');
  for (const [code, d] of Object.entries(rep.detail)) {
    E_(d.pax >= 0, `${code} 旅客为负`);
    E_(d.lf <= 1.0001, `${code} 客座率 ${d.lf} > 100%`);
    E_(d.pax <= d.ask / (MARKETS[code].sector_km) + 1, `${code} 承运超过可供座位`);
    E_(near(d.rev['Total Revenue'], d.rev['Passenger Revenue'] + d.rev['Cargo Revenue'] + d.rev['Ancillary Revenue'], 1),
       `${code} 收入三项加总≠总收入`);
    E_(near(d.operating_profit, d.rev['Total Revenue'] - d.dco - d.ind, 1),
       `${code} 航线损益未闭合`);
  }
  // 现金守恒
  const expect = p.cashAtTurnStart + rep.operating_profit - rep.oneoff + rep.financing;
  E_(near(rep.cash_end, expect, Math.max(2, Math.abs(expect) * 0.001)), '现金未守恒');
  // 容量约束
  for (const ac of p.aircraft) {
    const used = p.schedules.filter(s => s.acId === ac.id).reduce((a, s) => a + s.bh, 0) * 90;
    const cap = ac.long ? GM.max_bh : GM.flight_crew_max_bh;
    E_(used <= cap + 1, `${ac.type} 超出 ${cap} BH/回合 (${used.toFixed(1)})`);
  }
}

/* ---------- 主循环 ---------- */
export function runGame(seed = 12345, verbose = false) {
  const r = rnd(seed);
  const gm = { r, fuelPrice: 2.40, carbonPrice: 22.0, interestRate: 5.0, newMarkets: [], log: [] };
  const players = [
    mkPlayer(STRATEGIES.LCC, seed + 1),
    mkPlayer(STRATEGIES.HYB, seed + 2),
    mkPlayer(STRATEGIES.FSC, seed + 3),
  ];
  const errors = [];
  const trace = [];

  for (let turn = 0; turn < GM.max_turns; turn++) {
    gmTurn(gm, turn, players);
    for (const p of players) playerTurn(p, turn, gm);
    const reps = [];
    for (const p of players) {
      const before = p.cash;
      p.cashAtTurnStart = before;
      const rep = settlePlayer(p, turn, players.filter(x => x !== p));
      assertInvariants(p, rep, turn, errors);
      reps.push({ code: p.code, rep, cashBefore: before });
    }
    // 三玩家共享份额
    const totRPK = reps.reduce((a, x) => a + Object.values(x.rep.detail).reduce((b, d) => b + d.rpk, 0), 0);
    for (const x of reps) {
      const mine = Object.values(x.rep.detail).reduce((b, d) => b + d.rpk, 0);
      x.rep.market_share = totRPK ? mine / totRPK : 0;
      x.rep.market_share = x.rep.market_share;
      x.rep.share = x.rep.market_share;
    }
    trace.push({ turn, gm: { ...gm }, players: reps });
    if (verbose) {
      console.log(`  T${turn + 1} 油价 ${gm.fuelPrice.toFixed(2)} 碳 ${gm.carbonPrice} 利率 ${gm.interestRate}%`);
      for (const { code, rep } of reps)
        console.log(`     ${code}  收入 ${Math.round(rep.revenue).toLocaleString().padStart(12)}  ` +
          `利润 ${Math.round(rep.operating_profit).toLocaleString().padStart(11)}  ` +
          `现金 ${Math.round(rep.cash_end).toLocaleString().padStart(12)}  ` +
          `LF ${(rep.load_factor * 100).toFixed(0)}%  份额 ${(rep.market_share * 100).toFixed(1)}%`);
    }
  }

  // 汇总
  const summary = players.map(p => {
    const cum = p.history.reduce((a, r) => a + r.operating_profit, 0);
    const last = p.history[p.history.length - 1];
    const anc = p.history.reduce((a, r) => a + r.ancillary_share * r.revenue, 0);
    const rev = p.history.reduce((a, r) => a + r.revenue, 0);
    return {
      code: p.code, cumProfit: cum, finalCash: p.cash,
      grossMargin: rev ? cum / rev : 0,
      ancillaryShare: rev ? anc / rev : 0,
      loadFactor: last ? last.load_factor : 0,
      marketShare: last ? last.market_share : 0,
      bankrupt: p.cash < 0,
      routes: p.routes.map(x => x.code),
    };
  });
  return { summary, errors, trace, gm };
}

/* ---------- 批量 ---------- */
if (process.argv[1] && process.argv[1].endsWith('sim3.js')) {
  const N = +(process.argv[2] || 5);
  const seed0 = +(process.argv[3] || 1000);
  console.log('='.repeat(88));
  console.log(`★ 三玩家 + 裁判 全流程模拟   局数=${N}`);
  console.log('='.repeat(88));
  let allErr = [], bankrupt = 0, wins = {};
  for (let i = 0; i < N; i++) {
    const { summary, errors } = runGame(seed0 + i * 37, i === 0);
    allErr = allErr.concat(errors);
    const sorted = [...summary].sort((a, b) => b.cumProfit - a.cumProfit);
    wins[sorted[0].code] = (wins[sorted[0].code] || 0) + 1;
    if (summary.some(s => s.bankrupt)) bankrupt++;
    if (i > 0) {
      const s = sorted[0];
      console.log(`  局${i + 1}: 冠军 ${s.code}  累计利润 $${Math.round(s.cumProfit).toLocaleString().padStart(11)}` +
        `  毛利率 ${(s.grossMargin * 100).toFixed(1)}%  辅营 ${(s.ancillaryShare * 100).toFixed(1)}%  ` +
        `客座率 ${(s.loadFactor * 100).toFixed(0)}%`);
    }
  }
  console.log();
  console.log('='.repeat(88));
  console.log('★ 完整性测试结论');
  console.log('='.repeat(88));
  console.log(`  模拟局数        ${N}`);
  console.log(`  不变量违反      ${allErr.length} ${allErr.length ? '★ 有问题' : '✓ 全部通过'}`);
  if (allErr.length) { console.log('   ', allErr.slice(0, 10).join('\n    ')); }
  console.log(`  破产局数        ${bankrupt}/${N}`);
  console.log(`  冠军分布        ${Object.entries(wins).map(([k, v]) => k + ':' + v).join('  ')}`);
  process.exit(allErr.length ? 1 : 0);
}
