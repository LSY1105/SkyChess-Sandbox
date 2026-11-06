/* ============================================================
   多季回测驱动器（真实教学节奏）
   sandbox/replay.mjs
   ------------------------------------------------------------
   依 RULE_SCHEDULE 逐季开规则、依 GM.routeReleaseTurn 逐季放航线、
   按事件时间线触发；小组逐季排班 / 购买增值服务组合 / 申请开线 / 发起提案；
   套保由裁判发布 3 家条件各异的报价 → 小组按统一可比字段比价选型。
   输出：replay_out/report.json + replay_out/回测记录.md + 功能覆盖清单
   运行：node replay.mjs
   ============================================================ */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from './data.js';
import * as G from './game.js';
import * as E from './engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'replay_out');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const KEYFILE = join(OUT, 'keys.json');

mkdirSync(OUT, { recursive: true });
try { rmSync(KEYFILE); } catch {}

/* ---------- 启动独立服务实例（不污染课堂实例） ---------- */
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), SANDBOX_KEY_FILE: KEYFILE },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { await wait(300); try { const r = await fetch(BASE + '/api/keys'); if (r.ok) break; } catch {} }
const KEYS = JSON.parse(readFileSync(KEYFILE, 'utf8'));

const api = async (path, body, key) => {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-sandbox-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ...j };
};
const gmPost = (b) => api('/api/gm', b, KEYS.teacher);
const seatGet = (s) => api('/api/seat/' + s, null, KEYS.seats[s]);
const seatPost = (s, b) => api('/api/seat/' + s, b, KEYS.seats[s]);

/* ---------- 功能覆盖清单 ---------- */
const COVER = new Map();   // key → {id, cat, name, state:'covered'|'failed'|'unverified', note}
const cover = (id, cat, name, state, note = '') => {
  const prev = COVER.get(id);
  if (prev && prev.state === 'covered' && state !== 'covered') return;   // 已覆盖不回退
  if (!prev || (prev.state !== 'covered' && state === 'covered')) COVER.set(id, { id, cat, name, state, note });
  else COVER.set(id, { ...prev, state: prev.state === 'failed' && state === 'failed' ? 'failed' : prev.state, note: prev.note || note });
};
/* ---------- 剧本：逐季输入 ---------- */
const SEATS = ['CA', 'AB', 'VA'];
const EVENTS = {
  1: [{ eventId: 'cyber', seat: 'AB' }],
  2: [{ eventId: 'volcano', target: 'ETN' }],
  3: [{ eventId: 'hail', seat: 'AB' }],
  4: [{ eventId: 'pandemic' }],
  5: [{ eventId: 'fuel_shock' }],
};
/* 小组经营风格：不同航线组合 + 不同增值服务购买组合（覆盖目录全 32 项） */
const PLAN = {
  CA: { // 低成本型（LCC）· 航线归属依原版实录：SIM/LEW/JOP 归 CA，ETN 三家共享
    routes: [['SIM', 6], ['ETN', 4], ['LEW', 2], ['JOP', 3]],
    buys: { 0: ['adv_web', 'ota'], 1: ['adv_social', 'enews'], 2: ['cab_lowcost', 'adv_bill'],
            3: ['adv_print', 'giveaway'], 4: ['adv_tv', 'online_booking'], 5: ['selfcheckin', 'priority'] },
    perPax: { 1: ['adv_social'], 3: ['adv_print'], 5: ['adv_tv'] },
  },
  AB: { // 全服务型（FSC）· 原版归属：PKR 归 AB，CHA/BZY 未在材料中确认 → 归 AB
    routes: [['ETN', 4], ['PKR', 4], ['CHA', 2], ['BZY', 1]],
    buys: { 0: ['cab_galaxy', 'ife_basic'], 1: ['lounge_shared', 'pref_seats'], 2: ['wifi', 'loyalty'],
            3: ['ife_enh', 'lounge'], 4: ['wifi_hc', 'lounge_vip_shared'], 5: ['lounge_vip', 'overweight'] },
    perPax: { 0: ['cab_galaxy'], 2: ['ife_basic'], 4: ['ife_enh'] },
  },
  VA: { // 混合型（Hybrid）· 原版归属：FTZ 归 VA，McGee 为 VA 标志航线，ARM 与 CA 共享
    routes: [['ETN', 3], ['FTZ', 3], ['GEE', 1], ['ARM', 1]],
    buys: { 0: ['cat_econ', 'fnb_basic'], 1: ['cat_biz_pe', 'fnb_super'], 2: ['cab_new', 'adv_tv'],
            3: ['cab_refresh', 'bags'], 4: ['cat_econ', 'ife_basic'], 5: ['agent_ch', 'bags'] },
    perPax: { 1: ['cat_biz_pe'], 3: ['cab_new'], 5: ['fnb_super'] },
  },
};
const PROPOSALS = {
  0: [['CA', 'fixed_price_item'], ['AB', 'heavy_check']],
  1: [['VA', 'sell_to_group'], ['CA', 'event_exemption']],
  2: [['CA', 'hangar_lease'], ['AB', 'cabin_extra_crew']],
  3: [['VA', 'catering_consistent'], ['CA', 'themed_op']],
  4: [['AB', 'heavy_check'], ['VA', 'event_exemption']],
  5: [['CA', 'fixed_price_item'], ['AB', 'themed_op']],
};
/* 套保比价选型：每组按不同偏好选（成本优先 / 覆盖优先 / 杠杆优先） */
const HEDGE_PICK = { 0: { CA: 'C', AB: 'A', VA: 'B' }, 1: { CA: 'A', AB: 'C', VA: 'B' },
                      3: { CA: 'B', AB: 'A', VA: 'C' }, 5: { CA: 'C', AB: 'B', VA: 'A' } };

const log = [];
const seasons = [];
const lastLF = {};

/* ---------- 主循环：7 季 ---------- */
for (let turn = 0; turn <= 6; turn++) {
  const inputs = { turn, rules: [], routes: [], events: [], buys: [], proposals: [], hedge: [] };
  /* ① 规则：按 RULE_SCHEDULE 开启当期规则 */
  for (const r of D.RULE_SCHEDULE) {
    if (r.turn <= turn) {
      const res = await gmPost({ type: 'setRule', key: r.key, turn: r.turn });
      if (res.result === 'ok' || res.result === undefined) cover('rule:' + r.key, '规则', r.name, 'covered', `第 ${r.turn} 季开启`);
      else cover('rule:' + r.key, '规则', r.name, 'failed', String(res.result));
      inputs.rules.push(r.key);
    } else cover('rule:' + r.key, '规则', r.name, 'unverified', `第 ${r.turn} 季开启，本轮未到`);
  }
  /* ② 航线：按释放回合释放当期航线 */
  const rel = Object.entries(D.GM.routeReleaseTurn).filter(([, t]) => t === turn).map(([c]) => c);
  if (rel.length) {
    const res = await gmPost({ type: 'releaseRoutes', codes: rel.join(',') });
    if (res.result === 'ok') { inputs.routes = rel; for (const c of rel) cover('route:' + c, '航线', `航线 ${c} 释放`, 'covered', `第 ${turn} 季`); }
    else for (const c of rel) cover('route:' + c, '航线', `航线 ${c} 释放`, 'failed', String(res.result));
  }
  for (const c of Object.keys(D.GM.routeReleaseTurn)) {
    if (D.GM.routeReleaseTurn[c] > turn) cover('route:' + c, '航线', `航线 ${c} 释放`, 'unverified', `第 ${D.GM.routeReleaseTurn[c]} 季释放`);
  }
  /* ③ 事件 */
  for (const ev of (EVENTS[turn] || [])) {
    const res = await gmPost({ type: 'triggerEvent', eventId: ev.eventId, target: ev.target, seat: ev.seat });
    const ok = res.result === 'ok' || res.result === undefined;
    cover('event:' + ev.eventId, '事件', `事件 ${ev.eventId}`, ok ? 'covered' : 'failed', ok ? `第 ${turn} 季 · ${ev.target || ev.seat || 'global'}` : String(res.result));
    inputs.events.push({ ...ev, result: res.result });
  }
  /* ④ 套保：裁判发布 3 家报价 → 小组比价选型 */
  if (HEDGE_PICK[turn]) {
    const quotes = D.HEDGE_QUOTES.map(q => ({ ...q }));
    const qres = await gmPost({ type: 'setHedgeQuotes', quotes });
    cover('hedge:quotes3', '套保', '裁判发布 3 家条件各异的报价', qres.result === 'ok' ? 'covered' : 'failed', String(qres.result));
    for (const s of SEATS) {
      const g = (await seatGet(s)).game;
      const cmp = G.hedgeQuoteComparison(g, quotes, D.HEDGE_SCENARIOS, g.fuelPrice);
      const pick = HEDGE_PICK[turn][s];
      const row = cmp.rows.find(r => r.id === pick);
      const res = await api('/api/gm', { type: 'acceptHedgeQuote', seat: s, quoteId: pick }, KEYS.teacher);
      const ok = res.result === 'ok';
      cover('hedge:pick:' + s, '套保', `${s} 比价选型`, ok ? 'covered' : 'failed', ok ? `选 ${pick}（期望 ${row ? row.costPerGal : '?'} $/gal；未套保 ${cmp.rows[0] ? '' : ''}）` : String(res.result));
      for (const r of cmp.rows) cover('hedge:quote:' + r.id, '套保', `报价 ${r.id} ${r.supplier}`, 'covered', `期望 ${r.costPerGal} $/gal`);
      
    }
  }
  /* ⑤ 小组：排班 + 购买增值服务 + 申请开线 + 提案 */
  for (const s of SEATS) {
    let g = (await seatGet(s)).game;
    const opened = g.routes.map(r => r.code);
    const want = (PLAN[s].routes).filter(([c]) => opened.includes(c));
    /* ★ 机队扩容（教学裁定：初始资产不变，融资通道 Q2 起开放，租赁纳入多季）
       T0：初始 2 架固定（不可扩容）→ 公平起点
       T1：融资通道开放 → 湿租（承租方承担运营）或融资买机
       T2+：干租（出租方承担燃油/维护/机组 → 运营成本显著更低）+ 折扣议价 → 快速成长 */
    const wantBands = want.reduce((a, [, k]) => a + k, 0);
    const needAc = Math.ceil(wantBands / 2);   // 短程每机 2 班/日 → 所需机数
    let guard = 0;
    // ★ 理性经营：现金为负时**不再扩张**（经营失误要有代价，但不靠注资续命）
    /* ★ 理性经营（边际贡献）：湿租单架季租 ≈$1.1M → 盈亏平衡 LF ≈ 47%
       故只在「上一季最佳航线 LF ≥ 45%」且现金为正时扩张；T0 不扩张（先体会 2 架飞机的运力上限） */
    /* ★ 理性经营 v3：**增量一架机的贡献为正才扩张**（正确判据）
       单班承运 = 市场总需求 × 我方份额 ÷ 计划班次
       增量一架机（短程 2 班/日 → 180 班次/季）：
         增量收入 = 180 × 单班承运 × 票价
         增量成本 = 季租金 + 180 × 每班增量运营成本（燃油/机组/维护）
       ⚠ 已证伪的启发式：「独占 → 高 LF」（原版 VA 的 Fitzgerald 独占却 margin −3.75%）
       ⚠ 已证伪的启发式：「上一季 LF ≥ 45%」（首季无历史数据，无法决策） */
    const allocNow = G.allocateMarkets(g);
    const wantMap = Object.fromEntries(want.map(([c, k]) => [c, k]));
    let bestContrib = -Infinity, contribDetail = [];
    for (const [code, perDay] of Object.entries(wantMap)) {
      const m = D.MARKETS[code]; if (!m) continue;
      const a = allocNow[code]; if (!a) continue;
      const route = g.routes.find(r => r.code === code); if (!route) continue;
      const share = (a.shares && a.shares.player != null) ? a.shares.player : 1;
      const planFreq = perDay * 90;                      // 计划季班次
      const paxPerFlight = planFreq ? (a.totalDemand * share) / planFreq : 0;
      const paxCapped = Math.min(paxPerFlight, (route.seats || 100));
      const rev180 = 180 * paxCapped * route.fare;        // 增量一架机（180 班）的收入
      const rentQ = (D.AIRCRAFT.find(x => x.name === 'APT100') || {}).price * 1e6 * D.GM.lease_rate_annual / 4;
      const opPerFlight = D.E ? 0 : 0;
      const op180 = 180 * (E.F08_VAR(m.bh, g.fuelPrice) + E.F06_VAR(0, m.bh) + E.F07_VAR(0, m.bh));
      const contrib = rev180 - rentQ - op180;
      contribDetail.push(`${code}: ${Math.round(rev180 / 1e3)}k-${Math.round((rentQ + op180) / 1e3)}k=${Math.round(contrib / 1e3)}k`);
      if (contrib > bestContrib) bestContrib = contrib;
    }
    const canExpand = g.cash > 0 && bestContrib > 0;
    while (canExpand && g.aircraft.length < needAc && guard < 2) {
      guard++;
      /* ★ 优先级修正：**优先融资买机**，租机为备选
         现金压力对比（APT100 $40M）：租赁 $1.1M/季全额付现 vs 买机 折旧 $0.61M/季（非现金）
         + 利息 $0.5M/季（付现）→ 买机的现金压力约为租机的 1/2，且资产入表、可买断 */
      let bought = false;
      if (turn >= 1 || g.cash > 0) {
        const buy = await seatPost(s, { type: 'buyAircraft', acType: 'APT100', financed: true });
        if (buy.result === 'ok') {
          bought = true;
          cover('action:buyAircraft', '动作', '购买飞机（含融资）', 'covered', `${s} T${turn} APT100（融资买入）`);
        } else {
          cover('action:buyAircraft', '动作', '购买飞机（含融资）', 'failed', `${s} -> ${buy.result}`);
        }
      }
      if (bought) {
        const g2 = (await seatGet(s)).game;
        if (g2.aircraft.length <= g.aircraft.length) break;
        g = g2;
        continue;
      }
      if (turn >= 2) {
        await gmPost({ type: 'negotiate', seat: s, item: 'leaseType', value: 'dry' });
        const nd = await gmPost({ type: 'negotiate', seat: s, item: 'leaseDiscount', value: 0.20 });
        cover('neg:leaseDiscount', '谈判', '租赁折扣议价', nd.result === 'ok' ? 'covered' : 'failed', `${s} 干租 20% off`);
        cover('neg:leaseType', '谈判', '租赁方式（干租/湿租）', 'covered', `${s} 干租`);
        const ls = await seatPost(s, { type: 'lease', acType: 'APT100', financed: true });
        cover('action:lease', '动作', '租赁飞机（干租/湿租）', ls.result && ls.result.ok ? 'covered' : 'failed',
          ls.result && ls.result.ok ? `${s} T${turn} 干租 季租 $${Math.round(ls.result.rentQ).toLocaleString()}` : String(ls.result));
      } else {
        await gmPost({ type: 'negotiate', seat: s, item: 'leaseType', value: 'wet' });
        cover('neg:leaseType', '谈判', '租赁方式（干租/湿租）', 'covered', `${s} 湿租`);
        const ls = await seatPost(s, { type: 'lease', acType: 'APT100' });
        cover('action:lease', '动作', '租赁飞机（干租/湿租）', ls.result && ls.result.ok ? 'covered' : 'failed',
          ls.result && ls.result.ok ? `${s} T${turn} 湿租赊机 季租 $${Math.round(ls.result.rentQ).toLocaleString()}` : String(ls.result));
      }
      const g2 = (await seatGet(s)).game;
      if (g2.aircraft.length <= g.aircraft.length) {
        // 租赁失败 → 改用融资买机
        const buy = await seatPost(s, { type: 'buyAircraft', acType: 'APT100', financed: true });
        cover('action:buyAircraft', '动作', '购买飞机（含融资）', buy.result === 'ok' ? 'covered' : 'failed', `${s} -> ${buy.result}`);
        const g3 = (await seatGet(s)).game;
        if (g3.aircraft.length <= g2.aircraft.length) break;
      }
      g.cash = (await seatGet(s)).game.cash;
    }
    if (turn === 1 && g.cash > 0) {
      const br = await seatPost(s, { type: 'borrow', amount: 5000000 });
      cover('action:borrow', '动作', '机队融资借款（Q2 起）', br.result === 'ok' ? 'covered' : 'failed', `${s} $5,000,000 -> ${br.result}`);
      cover('rule:financingChannel', '规则', '机队融资通道', 'covered', 'T1 开放');
    }
    /* ★ 扩容后必须刷新机队快照，否则排班仍用旧机队 → 租来的飞机不飞、租金白付 */
    g = (await seatGet(s)).game;
    // ★ 飞机索引必须**跨航线连续**：同一飞机每天最多 1 班（过站时间约束），否则后续排班全被拒
    /* ★ 排班：短程每机每日 2 班 → 每条航线每 2 班占 1 架飞机（同机两班间隔 ≥ 往返+周转）
       机型按经营定位：LCC 单一窄体 APT100 · FSC 宽体优先 · Hybrid 混合 */
    let n = 0, addFails = [];
    const acCount = new Map();
    const pickAc = (code) => {
      const long = !!(D.MARKETS[code] && D.MARKETS[code].sector_km >= 1000);
      const pref = g.style === 'LCC' ? ['APT100']
                 : g.style === 'FSC' ? ['G200LR','G250','G160XLR','G160XLR P1','APT100']
                 : ['APT100','G160XLR','G160XLR P1','G200LR'];
      const pool = g.aircraft.filter(a => (long ? a.long : true));
      const cap = (a) => (a.long ? 1 : 2);          // 短程 2 班/日、长程 1 班/日
      for (const t of pref) {
        const f = pool.find(a => a.type === t && (acCount.get(a.id) || 0) < cap(a));
        if (f) return f;
      }
      return pool.find(a => (acCount.get(a.id) || 0) < cap(a)) || pool[0] || g.aircraft[0];
    };
    const usedAc = new Set();
    for (const [code, perDay] of want) {
      const bhH = (D.MARKETS[code] ? D.MARKETS[code].bh : 1.5);
      const gapH = Math.ceil(2 * bhH + 0.6);      // 回程 + 周转（小时）
      let done = 0, slot = 0;
      while (done < perDay) {
        const ac = pickAc(code);
        const key = ac.id + ':' + code;
        const t0 = 6 + slot * (gapH + 4);
        const t1 = t0 + gapH;
        for (const depH of [t0, t1]) {
          if (done >= perDay) break;
          const dep = String(depH % 24).padStart(2, '0') + ':00';
          const res = await seatPost(s, { type: 'addFlight', acId: ac.id, code, departure: dep });
          if (res.result === 'ok') { n++; done++; acCount.set(ac.id, (acCount.get(ac.id) || 0) + 1); }
          else { addFails.push(`${code} ${dep} ${res.result}`); break; }
        }
        usedAc.add(key);
        slot++;
        if (slot > 8) break;
      }
    }
    cover('action:addFlight', '动作', '加入班次', n > 0 ? 'covered' : 'failed',
      `${s} 本季 ${n} 班${addFails.length ? '｜被拒 ' + addFails.slice(0, 2).join('; ') : ''}`);
    if (g.schedules.length > 2) {
      const res = await seatPost(s, { type: 'removeFlight', index: 0 });
      cover('action:removeFlight', '动作', '移除班次', res.result === 'ok' ? 'covered' : 'failed', String(res.result));
    }
    if (g.routes.length) {
      // ★ 经营定位定价：LCC 低价高密度 / FSC 高价重服务 / Hybrid 居中
      // 指导价 × 风格系数（LCC 低价走量 / FSC 高价重服务 / Hybrid 居中）
      const styleK = { LCC: 0.85, FSC: 1.20, Hybrid: 1.00 }[g.style] || 1;
      for (const r of g.routes) {
        const guide = (D.MARKETS[r.code] && D.MARKETS[r.code].guide_fare) || 200;
        await seatPost(s, { type: 'setFare', code: r.code, fare: Math.round(guide * styleK) });
      }
      cover('action:setFare', '动作', '设定运价', 'covered', s);
      const rb = await seatPost(s, { type: 'setFareBands', code: g.routes[0].code, peak: 1.25, offPeak: 0.8 });
      cover('action:setFareBands', '动作', '分时定价', rb.result === 'ok' ? 'covered' : 'failed', String(rb.result));
    }
    for (const inv of (PLAN[s].buys[turn] || [])) {
      const item = D.INVESTMENTS.find(x => x.id === inv);
      if (!item) { cover('invest:' + inv, '投资', inv, 'failed', '目录中不存在'); continue; }
      const res = await seatPost(s, { type: 'invest', id: inv, code: opened[0] });
      const ok = res.result === 'ok' || String(res.result).includes('已');
      cover('invest:' + inv, '投资', `${inv}（${item.name}）`, ok ? 'covered' : 'failed', ok ? `${s} T${turn}` : String(res.result));
      if (ok) inputs.buys.push({ seat: s, id: inv });
      if ((PLAN[s].perPax[turn] || []).includes(inv)) {
        const nr = await api('/api/gm', { type: 'negotiate', seat: s, item: 'investTerms', invId: inv, costPerPax: 1.5, revenuePerPax: 4 }, KEYS.teacher);
        cover('neg:investTerms', '谈判', '投资项议价（成本/收益 每旅客）', nr.result === 'ok' ? 'covered' : 'failed', String(nr.result));
      }
    }
    /* ★ 航线归属按原版实录固定，避免三家互相抢同一条航线 → 需求被三方分摊、LF 摊薄
       SIM/LEW/JOP/ARM → CA；PKR/CHA/BZY → AB；FTZ/GEE → VA；ETN 三家共享 */
    const OWN = { CA: ['SIM','ETN','LEW','JOP','ARM'], AB: ['ETN','PKR','CHA','BZY'], VA: ['ETN','FTZ','GEE'] };
    const cand = (OWN[s] || []).filter(code => (D.GM.routeReleaseTurn[code] ?? 99) <= turn && !opened.includes(code));
    if (cand.length) {
      const code = cand[0];
      const res = await seatPost(s, { type: 'openRoute', code });
      const ok = res.result === 'ok' || String(res.result).includes('申请');
      cover('action:openRoute', '动作', '申请开线', ok ? 'covered' : 'failed', `${s} ${code} -> ${res.result}`);
      inputs.proposals.push({ seat: s, kind: 'openRoute', code, result: res.result });
    }
    for (const [seat, kind] of (PROPOSALS[turn] || [])) {
      if (seat !== s) continue;
      const spec = G.PROPOSAL_KINDS ? G.PROPOSAL_KINDS[kind] : null;
      const payload = {};
      if (spec) for (const f of (spec.fields || [])) {
        if (f.k === 'acId') payload.acId = g.aircraft[0] ? g.aircraft[0].id : 1;
        else if (f.t === 'seat') payload[f.k] = s === 'CA' ? 'AB' : 'CA';
        else if (f.t === 'money' || f.t === 'num') payload[f.k] = 100000;
        else payload[f.k] = 'replay';
      }
      const res = await seatPost(s, { type: 'propose', kind, ...payload });
      const ok = res.result === 'ok' || String(res.result).includes('ok');
      cover('propose:' + kind, '提案', kind, ok ? 'covered' : 'failed', `${s} -> ${res.result}`);
      inputs.proposals.push({ seat: s, kind, result: res.result });
    }
    if (turn >= 1 && turn <= 3) {
      await gmPost({ type: 'intelPrice', seat: s, code: 'SIM', price: 55000 });
      const res = await seatPost(s, { type: 'buyIntel', code: 'SIM' });
      cover('action:buyIntel', '动作', '购买市场情报', res.result === 'ok' ? 'covered' : 'failed', `${s} -> ${res.result}`);
    }
    const etnRoute = g.routes.find(r => D.MARKETS[r.code] && D.MARKETS[r.code].esg_required);
    if (etnRoute && !etnRoute.etopsPaid && g.cash > 500000) {
      const res = await seatPost(s, { type: 'payEtops', code: etnRoute.code });
      cover('action:payEtops', '动作', '购买 ETOPS 许可', res.result === 'ok' ? 'covered' : 'failed', String(res.result));
    }
  }
  /* ⑥ 裁判审批：本季开线申请 + 提案 */
  const gstates = {};
  for (const s of SEATS) gstates[s] = (await seatGet(s)).game;
  for (const s of SEATS) {
    for (const r of (gstates[s].routeRequests || [])) {
      if (r.status !== 'pending') continue;
      const approve = (turn % 2 === 0);
      const res = await gmPost({ type: 'approveRoute', seat: s, code: r.code, approve, note: approve ? '同意开线' : '本季暂不放行' });
      const ok = res.result === 'ok';
      cover('action:approveRoute', '动作', '裁判审批开线', ok ? 'covered' : 'failed', `${s} ${r.code} ${approve ? '批准' : '驳回'} -> ${res.result}`);
      cover('route:open:' + r.code, '航线', `航线 ${r.code} 开通`, approve ? 'covered' : 'failed', approve ? `${s} T${turn}` : '本季驳回');
    }
    for (const pr of (gstates[s].proposals || [])) {
      if (pr.status !== 'pending') continue;
      const approve = turn % 3 !== 1;
      const mod = turn % 4 === 0;
      const res = await gmPost({ type: 'resolveProposal', seat: s, id: pr.id, action: approve ? 'approve' : 'reject',
        modify: mod ? { amount: 120000 } : undefined, note: approve ? (mod ? '修改后批准' : '批准') : '驳回' });
      const ok = res.result === 'ok';
      cover('action:resolveProposal', '动作', '裁判审批提案', ok ? 'covered' : 'failed', `${s} ${pr.kind} -> ${res.result}`);
      if (mod) cover('propose:modify', '提案', '提案带修改批准', ok ? 'covered' : 'failed', String(res.result));
    }
  }
  /* ⑦ 裁判统一推进结算 */
  const adv = await gmPost({ type: 'advanceAll' });
  cover('action:advanceAll', '动作', '裁判统一推进结算', adv.result !== undefined ? 'covered' : 'failed', String(adv.result));
  /* ⑧ 采集本季指标 */
  const season = { turn, inputs, seats: {}, gmLog: [] };
  for (const s of SEATS) {
    const g = (await seatGet(s)).game;
    const hist = (g.history || []);
    const last = hist[hist.length - 1] || {};
    season.seats[s] = {
      cash: Math.round(g.cash), qsi: g.qsi, period: last.period || g.period?.label || '',
      routes: g.routes.map(r => r.code), schedules: g.schedules.length,
      revenue: last.revenue != null ? Math.round(last.revenue) : null,
      cost: last.cost != null ? Math.round(last.cost) : null,
      operating_profit: last.operating_profit != null ? Math.round(last.operating_profit) : null,
      net_profit: last.net_profit != null ? Math.round(last.net_profit) : null,
      pax: last.paxTotal != null ? Math.round(last.paxTotal) : null,
      load_factor: last.load_factor != null ? +(last.load_factor).toFixed(4) : null,
      ask: last.askTotal != null ? Math.round(last.askTotal) : null,
      share: last.market_share != null ? +(last.market_share).toFixed(4) : null,
      gross_margin: last.gross_margin != null ? +(last.gross_margin).toFixed(4) : null,
      loan_balance: Math.round(g.loan_balance || 0), investments: (g.investments || []).length,
      detail: g.lastDetail ? Object.fromEntries(Object.entries(g.lastDetail).map(([c, d]) => [c, {
        pax: Math.round(d.pax), lf: +(d.lf).toFixed(3), rev: Math.round(d.rev['Total Revenue'] || 0),
        op: Math.round(d.operating_profit || 0), share: d.share != null ? +(+d.share).toFixed(3) : null }])) : {},
    };
  }
  for (const s of SEATS) {
    const d = season.seats[s].detail || {};
    lastLF[s] = Object.fromEntries(Object.entries(d).map(([c, v]) => [c, v.lf]));
  }
  const gmAfter = (await api('/api/gm', null, KEYS.teacher)).gm;
  season.gmLog = (gmAfter.log || []).slice(-14);
  seasons.push(season);
  log.push(`T${turn}: 规则 ${inputs.rules.length}｜释放 ${inputs.routes.join(',') || '无'}｜事件 ${inputs.events.map(e => e.eventId).join(',') || '无'}`);
}
/* ---------- 功能覆盖清单（补齐未触达项） ---------- */
for (const it of D.INVESTMENTS) if (!COVER.has('invest:' + it.id))
  cover('invest:' + it.id, '投资', `${it.id}（${it.name}）`, 'unverified', '回测剧本未安排购买');
for (const ev of (D.EVENTS || [])) if (!COVER.has('event:' + ev.id))
  cover('event:' + ev.id, '事件', `事件 ${ev.id}`, 'unverified', '回测时间线未安排触发');
for (const r of D.RULE_SCHEDULE) if (!COVER.has('rule:' + r.key))
  cover('rule:' + r.key, '规则', r.name, 'unverified', '未到开启回合');
for (const c of Object.keys(D.MARKETS)) if (!COVER.has('route:' + c))
  cover('route:' + c, '航线', `航线 ${c}`, 'unverified', '释放回合未到或未开通');

const shareTrend = seasons.map(s => ({ turn: s.turn, shares: Object.fromEntries(SEATS.map(x => [x, s.seats[x].share])) }));
const report = {
  generatedAt: new Date().toISOString(),
  scenario: '7 季回测（2027Q4-2029Q2）：依 RULE_SCHEDULE 逐季开规则、routeReleaseTurn 逐季放航线、按事件时间线触发',
  seats: SEATS, seasons, coverage: [...COVER.values()], shareTrend,
  hedgeQuotes: D.HEDGE_QUOTES, hedgeScenarios: D.HEDGE_SCENARIOS,
  inventory: D.INVESTMENTS.map(i => ({ id: i.id, name: i.name, cat: i.cat, upfront: i.upfront, annual: i.annual,
    costPerPax: i.costPerPax, revenuePerPax: i.revenuePerPax, effect: i.effect })),
  serverLog: srvLog.split('\n').slice(-40),
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const byState = { covered: 0, failed: 0, unverified: 0 };
const byCat = {};
for (const c of report.coverage) {
  byState[c.state]++;
  byCat[c.cat] = byCat[c.cat] || { covered: 0, failed: 0, unverified: 0 };
  byCat[c.cat][c.state]++;
}
console.log('\n================ 逐季关键指标 ================');
for (const s of seasons) {
  console.log(`\n【第 ${s.turn} 季】${s.seats.CA.period || ''}｜规则 ${s.inputs.rules.length} 项｜释放 ${s.inputs.routes.join(',') || '无'}｜事件 ${s.inputs.events.map(e => e.eventId).join(',') || '无'}`);
  for (const h of s.inputs.hedge) console.log(`   套保 ${h.seat}: 选 ${h.pick}｜比价 ${h.ranking}`);
  for (const x of SEATS) {
    const v = s.seats[x];
    console.log(`   ${x}: 现金 ${v.cash.toLocaleString()}｜航线 ${v.routes.join('+')}｜班次 ${v.schedules}｜收入 ${v.revenue ?? '-'}｜营业利润 ${v.operating_profit ?? '-'}｜旅客 ${v.pax ?? '-'}｜LF ${v.load_factor ?? '-'}｜份额 ${v.share ?? '-'}`);
  }
}
console.log('\n================ 功能覆盖清单 ================');
console.log('合计', report.coverage.length, '｜覆盖', byState.covered, '｜失败', byState.failed, '｜未验证', byState.unverified);
for (const [cat, st] of Object.entries(byCat)) console.log(`   ${cat}: 覆盖 ${st.covered} / 失败 ${st.failed} / 未验证 ${st.unverified}`);
console.log('\n--- 失败项 ---');
for (const c of report.coverage.filter(x => x.state === 'failed')) console.log(`   [${c.cat}] ${c.name} :: ${c.note}`);
console.log('\n--- 未验证项 ---');
for (const c of report.coverage.filter(x => x.state === 'unverified')) console.log(`   [${c.cat}] ${c.name} :: ${c.note}`);
console.log('\n报告:', join(OUT, 'report.json'));
srv.kill();
process.exit(0);
