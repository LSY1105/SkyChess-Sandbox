/* ============================================================
   多 Agent 课堂演练：3 家航司各由一个子 Agent 扮演，逐季决策
   sandbox/agentplay.mjs
   ------------------------------------------------------------
   · 每个赛季并行启动 3 个 pi 子进程（--print，扮演 CA/AB/VA 的经营团队）
   · 子 Agent 只输出 JSON 决策 → 本脚本解析并通过 /api/seat 执行 → 不进入主上下文
   · 裁判环节（本脚本扮演 GM）：逐季开规则、放航线、触发事件、审批开线、发布套保报价
   · 每季结束采集结构化数据 → replay_out/agentplay.json + 汇总打印
   运行：node agentplay.mjs [季数]
   ============================================================ */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from './data.js';
import * as G from './game.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'replay_out');
const PORT = 8801;
const BASE = `http://127.0.0.1:${PORT}`;
const KEYFILE = join(OUT, 'agentkeys.json');
const PI = 'C:/Users/qjl10/.pi/agent/bin/pi-launcher.js';
const MAX_TURNS = Number(process.argv[2] || 7);
mkdirSync(OUT, { recursive: true });
try { rmSync(KEYFILE); } catch {}

/* ---------- 启动独立服务 ---------- */
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), SANDBOX_KEY_FILE: KEYFILE }, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { await wait(300); try { const r = await fetch(BASE + '/api/keys'); if (r.ok) break; } catch {} }
const KEYS = JSON.parse(readFileSync(KEYFILE, 'utf8'));
const api = async (path, body, key) => {
  const res = await fetch(BASE + path, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-sandbox-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const gmPost = b => api('/api/gm', b, KEYS.teacher);
const seatGet = s => api('/api/seat/' + s, null, KEYS.seats[s]);
const seatPost = (s, b) => api('/api/seat/' + s, b, KEYS.seats[s]);

const SEATS = ['CA', 'AB', 'VA'];
const STYLE = { CA: 'LCC 低成本型', AB: 'FSC 全服务型', VA: 'Hybrid 混合型' };
const OWN = { CA: ['SIM', 'ETN', 'LEW', 'JOP', 'ARM'], AB: ['ETN', 'PKR', 'CHA', 'BZY'], VA: ['ETN', 'FTZ', 'GEE'] };
const EVENTS = { 1: [{ eventId: 'cyber', seat: 'AB' }], 2: [{ eventId: 'volcano', target: 'ETN' }],
                 3: [{ eventId: 'hail', seat: 'AB' }], 4: [{ eventId: 'pandemic' }], 5: [{ eventId: 'fuel_shock' }] };
const HEDGE_TURNS = { 0: { CA: 'C', AB: 'A', VA: 'B' }, 1: { CA: 'A', AB: 'C', VA: 'B' },
                      3: { CA: 'B', AB: 'A', VA: 'C' }, 5: { CA: 'C', AB: 'B', VA: 'A' } };

/* ---------- 子 Agent ---------- */
const ROLE = `你是 SkyChess 航空运营沙盘里某家航司的经营决策团队（总经理 + 运营 + 财务）。
你只能通过 JSON 动作清单影响沙盘，每季决策一次。规则要点：
· 每条排班 = 该机每日 1 班；短程机每机每日最多 2 班，长程机最多 1 班
· 同机两班间隔 ≥ 2×单程BH + 周转；短程须 06:00 后起飞、22:00 前当日返航
· 运价决定需求：价高客少、价低客多；客座率( LF)是核心指标，盈亏平衡 LF 约 45%~50%
· 固定成本高：自有飞机折旧按 16.28 年；湿租每架每季约 \$1.1M；融资买机现金压力更低
· 现金为负不会立即结束，但会锁死扩张；扩张前先算单架增量贡献
· 你的目标：7 季内现金稳健、份额提升、最终盈利
★ 三条铁律（务必遵守）：
  ① 被网络攻击时面板全屏不可操作 → 解法：购买网络安全服务 $250,000/季（动作 buyCyberService）自行恢复
  ② 独占 ≠ 赚钱（市场太小照样亏）→ 先看本组盈亏平衡 LF 再定航线与班次
  ③ 高票价 → 客座率掉；票价上限为指导价 × 3；中转旅客只按续程比例结算，**不要靠拉高票价接中转**
输出严格为一个 JSON 对象（不要任何其他文字）：
{"actions":[{"type":"setFare","code":"SIM","fare":130}],"note":"不超过40字的理由"}
可用动作 type：setFare{code,fare} / addFlight{acId,code,departure} / removeFlight{index}
 / invest{id} / buyAircraft{acType:"APT100"} / lease{acType:"APT100"} / propose{kind}
 / openRoute{code} / setFareBands{code,peak,offPeak} / buyIntel{code} / borrow{amount}
 / sellBack{acId} / payEtops{code} / acceptHedgeQuote{quoteId} / **buyCyberService**(被攻击时购买网络安全服务解封) / payRansom(付赎金)
（一次最多 12 个动作，按优先级排序；不确定的动作不要写）`;

function buildPrompt(seat, g, turn, state) {
  const routeRows = g.routes.map(r => `${r.code}(${D.MARKETS[r.code].name_c},${D.MARKETS[r.code].sector_km}km,票价$${r.fare})`).join('、');
  const fleetRows = g.aircraft.map(a => `#${a.id} ${a.type} ${a.seats}座 ${a.owned ? '自有' : '租赁'}`).join('、');
  const prev = state[seat] || {};
  const lfRows = Object.entries(prev.detail || {}).map(([c, d]) => `${c} LF ${(d.lf * 100).toFixed(0)}% 份额${(d.share * 100).toFixed(0)}%`).join('、');
  const avail = Object.entries(D.MARKETS).filter(([c, m]) => !g.routes.some(r => r.code === c) && (D.GM.routeReleaseTurn[c] ?? 99) <= turn)
    .map(([c, m]) => `${c}(${m.name_c},${m.sector_km}km)`).join('、');
  const own = (OWN[seat] || []).filter(c => !g.routes.some(r => r.code === c)).join('、');
  const cash = Math.round(g.cash);
  const hedge = (g.negotiation && g.negotiation.fuelHedge || []).map(h => `${h.id} ${h.strike}×${(h.share * 100).toFixed(0)}%`).join('、') || '无';
  const rej = (prev.rejects || []).slice(0, 6).map(r => `${r.type}→${r.why}`).join('；');
  return `【第 ${turn + 1} 季 · 你是 ${seat}（${STYLE[seat]}）】
本组可经营航线：${routeRows || '（无）'}
机队：${fleetRows}
现金：$${cash.toLocaleString()}｜QSI ${g.qsi}
上季（本组）：收入 ${prev.revenue != null ? '$' + Math.round(prev.revenue).toLocaleString() : '—'}｜营业利润 ${prev.operating_profit != null ? '$' + Math.round(prev.operating_profit).toLocaleString() : '—'}｜LF ${prev.load_factor != null ? (prev.load_factor * 100).toFixed(1) + '%' : '—'}｜份额 ${prev.share != null ? (prev.share * 100).toFixed(1) + '%' : '—'}
上季分航线：${lfRows || '（无）'}
可申请开线（你归属的）：${own || '（无）'}｜本季可申请但非你归属：${avail || '（无）'}
燃油套保：${hedge}
上季你提交的操作被拒原因（如有，必须据此修正，不要重复同样的错误）：${rej || '（无）'}
⚠ 若排班被拒，通常是：① 同机每日班次超限（短程≤2、长程≤1）② 同机两班间隔不足（≥2×BH+周转）
   ③ 起飞过晚无法当日返航（短程须 22:00 前返航）④ 航线未开通/未获批 ⑤ 现金或额度不足
   → 建议每季**先只改 1–2 个班次**验证通过后再加量，避免整批被拒
本季市场动态：${turn === 1 ? '网络攻击事件（AB 设备被黑）' : turn === 2 ? '火山爆发（ETN 需求崩塌）' : turn === 3 ? '冰雹（AB 飞机停飞 6 周）' : turn === 4 ? '疾病大流行（全球需求骤降）' : turn === 5 ? '能源价格冲击（油价暴涨）' : '无'}
请给出本季决策 JSON。`;
}

function runAgent(seat, prompt) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [PI, '--print', '--no-session', '--no-tools', '--system-prompt', ROLE, prompt],
      { cwd: HERE, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.on('error', function(e){ err = 'SPAWN_ERROR: ' + (e && e.message); });
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, 240000);
    p.on('close', (code) => { clearTimeout(timer); resolve({ out, err, code }); });
  });
}
function ruleStrategy(seat, g, prev) {
  let removeIdx = []; let expanded = [];
  // ★ 裁定 A（双口径）：允许「战略性亏损扩张」——
  //   若某航线现金口径可打平（LF 较高）且我方份额仍低 → 增 1 架（优先融资买机，现金压力最小）
  const detail = (prev && prev.detail) || {};
  /* ★ 排班目标：按**边际贡献**决定飞哪条航线、飞几班
     —— 旧逻辑用 LF 门槛(LF≥40%) 筛选 → 首季 LF 仅 16% → 一班不飞 → 零收入 → 必死（死结另一半）
     —— 正确逻辑：单班边际贡献（旅客×运价 − 每班次运营成本）> 0 就飞 */
  const wanted = [];
  let fallback = null;
  for (const [code, x] of Object.entries(detail)) {
    const r = g.routes.find(q => q.code === code); if (!r) continue;
    const freq = x.freq || 0;
    const perOps = freq > 0
      ? ((x.cost['Fuel'] || 0) + (x.cost['Maintenance'] || 0) + (x.cost['Flight Crew'] || 0)) / freq : 0;
    const paxPerFlight = freq > 0 ? (x.pax || 0) / freq : 0;
    const margin = paxPerFlight * r.fare - perOps;
    if (!fallback || margin > fallback.margin) fallback = { code, margin, perDay: 2 };
    if (margin > 0) wanted.push([code, 2]);
  }
  if (!wanted.length && fallback) wanted.push([fallback.code, fallback.perDay]);   // 至少飞最不亏的一条

  // ★ 组合式扩张判据（scale economy）：候选规模 N → 沙盘侧 estimateScale 选净收益最大者
  let bestN = 0, bestNet = 0, bestEst = null;
  for (let N = 1; N <= 4; N++) {
    const est = G.estimateScale(g, N);
    if (est.net > bestNet) { bestNet = est.net; bestN = N; bestEst = est; }
  }
  if (bestN > 0 && g.cash > 0) {
    const buys = [];
    for (let i = 0; i < bestN; i++) buys.push({ type: 'buyAircraft', acType: 'APT100', financed: true });
    return { actions: buys, removeIdx: removeIdx,
             note: '组合测算：扩 ' + bestN + ' 架 → 季度净 ' + Math.round(bestNet).toLocaleString() + '（含利息与折旧）' };
  }

  const acPool = g.aircraft.slice(); let ci = 0;
  for (const [code, perDay] of wanted) {
    const bh = D.MARKETS[code] ? D.MARKETS[code].bh : 1.5;
    const gapH = Math.ceil(2 * bh + 0.6);
    let done = 0, t0 = 6;
    while (done < perDay && ci < acPool.length) {
      const ac = acPool[ci]; const maxPerAc = ac.long ? 1 : 2;
      for (let k = 0; k < maxPerAc && done < perDay; k++) {
        const dep = String((t0 + k * gapH) % 24).padStart(2, "0") + ":00";
        actions.push({ type: "addFlight", acId: ac.id, code, departure: dep }); done++; }
      t0 += gapH * maxPerAc; ci++; }
  }
  return { actions: actions, removeIdx: removeIdx, note: "规则型策略兜底（LLM 不可用）" };
}
async function decideWithRetry(seat, prompt) {
  let last = { out: "", err: "", code: null };
  for (let k = 0; k < 2; k++) {
    const r = await runAgent(seat, prompt);
    last = r;
    const d = parseDecision(r.out);
    if (d) return { dec: d, raw: r };
    await wait(2000);
  }
  return { dec: null, raw: last };
}
function parseDecision(raw) {
  const s = raw || '';
  // 从后往前尝试所有 '{' 起点，取第一个能解析出 {actions:[...]} 的 JSON 块
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] !== '{') continue;
    let depth = 0, end = -1;
    for (let x = i; x < s.length; x++) {
      if (s[x] === '{') depth++;
      else if (s[x] === '}') { depth--; if (depth === 0) { end = x; break; } }
    }
    if (end < 0) continue;
    try {
      const o = JSON.parse(s.slice(i, end + 1));
      if (o && Array.isArray(o.actions)) return o;
    } catch { /* 继续尝试更早的起点 */ }
  }
  return null;
}
const ALLOWED = new Set(['setFare', 'addFlight', 'removeFlight', 'invest', 'buyAircraft', 'lease', 'propose', 'buyCyberService',
  'openRoute', 'setFareBands', 'buyIntel', 'borrow', 'sellBack', 'payEtops', 'acceptHedgeQuote']);
async function applyActions(seat, actions) {
  const applied = [], rejected = [];
  for (const a of (actions || []).slice(0, 12)) {
    if (!a || !ALLOWED.has(a.type)) { rejected.push({ ...a, why: '未知动作' }); continue; }
    const body = { ...a }; delete body.type;
    const r = await seatPost(seat, { type: a.type, ...body });
    if (r.result === 'ok' || (r.result && r.result.indexOf('ok') === 0)) applied.push({ type: a.type, ...body });
    else rejected.push({ type: a.type, ...body, why: String(r.result) });
  }
  return { applied, rejected };
}

/* ---------- 裁判剧本 ---------- */
async function judgeTurn(turn) {
  const acts = [];
  for (const r of D.RULE_SCHEDULE) if (r.turn <= turn) { await gmPost({ type: 'setRule', key: r.key, turn: r.turn }); acts.push('rule:' + r.key); }
  const rel = Object.entries(D.GM.routeReleaseTurn).filter(([, t]) => t === turn).map(([c]) => c);
  if (rel.length) { await gmPost({ type: 'releaseRoutes', codes: rel.join(',') }); acts.push('release:' + rel.join('+')); }
  for (const ev of (EVENTS[turn] || [])) { await gmPost({ type: 'triggerEvent', eventId: ev.eventId, target: ev.target, seat: ev.seat }); acts.push('event:' + ev.eventId); }
  /* ★ 裁判触发大修（时机由裁判定）：T2 对 CA 的 G160（机龄 18 年）触发 */
  if (turn === 2) {
    const gca = (await seatGet('CA')).game;
    const wide = (gca.aircraft || []).find(a => a.type === 'G160');
    if (wide) { const hc = await gmPost({ type: 'triggerHeavyCheck', seat: 'CA', acId: wide.id }); acts.push('heavyCheck:CA:' + hc.result); }
  }
  if (HEDGE_TURNS[turn]) {
    const quotes = D.HEDGE_QUOTES.map(q => ({ ...q }));
    await gmPost({ type: 'setHedgeQuotes', quotes });
    acts.push('hedgeQuotes:3');
  }
  // 开线审批：按归属表批准（裁判按教学目的放行）
  for (const s of SEATS) {
    const g = (await seatGet(s)).game;
    for (const r of (g.routeRequests || [])) {
      if (r.status !== 'pending') continue;
      const mine = (OWN[s] || []).includes(r.code);
      const approve = mine && (turn % 2 === 0);
      await gmPost({ type: 'approveRoute', seat: s, code: r.code, approve, note: approve ? '按归属放行' : '本季暂不放行' });
      acts.push(`route:${s}:${r.code}:${approve ? '批准' : '驳回'}`);
    }
    for (const pr of (g.proposals || [])) {
      if (pr.status !== 'pending') continue;
      await gmPost({ type: 'resolveProposal', seat: s, id: pr.id, action: turn % 3 === 1 ? 'reject' : 'approve', note: 'GM 裁决' });
      acts.push(`proposal:${s}:${pr.kind}:${turn % 3 === 1 ? '驳回' : '批准'}`);
    }
  }
  return acts;
}

/* ---------- 主循环 ---------- */
const seasons = [];
const state = {};
for (let turn = 0; turn < MAX_TURNS; turn++) {
  const judgeActs = await judgeTurn(turn);
  if (HEDGE_TURNS[turn]) {
    // 裁判发布报价后，提示各组可选（Agent 自行选择 quoteId）
  }
  const prompts = {};
  for (const s of SEATS) {
    const g = (await seatGet(s)).game;
    prompts[s] = buildPrompt(s, g, turn, state);
    // ★ 若该组正处于被攻击状态 → 明确指示其第一步执行 buyCyberService（对应小组端遮罩上的按钮）
    if (g.hacked && !g.hacked.resolved) {
      prompts[s] += `
★★ 你当前所在小组的面板正被网络攻击覆盖，无法进行任何经营操作。`
        + `你的**第一个且必须**的动作是 buyCyberService（购买网络安全服务 $${((D.GM.cyber_service_price || 250000)).toLocaleString()}/季）来解封面板；`
        + '在解封之前不要提交其他动作。';
    }
  }
  // ★ 串行执行：并发 3 个 LLM 调用会触发 provider 限流 → 后续请求 stdout 为空 → 演练冻结
  const results = [];
  for (const s of SEATS) results.push(await decideWithRetry(s, prompts[s]));
  const decisionLog = [];
  for (let i = 0; i < SEATS.length; i++) {
    const s = SEATS[i];
        let dec = results[i].dec;
    /* ★ 网络攻击遮罩：该组面板完全不可操作 → 本季无法做任何动作（困难由事件内生产生） */
    const gg0 = (await seatGet(s)).game;
    if (gg0.hacked && !gg0.hacked.resolved) {
      // ★ 被攻击时**只允许解封动作**（购买网络安全服务 / 付赎金），其余经营动作不可执行
      //   —— 真实小组在遮罩上就能点这两个按钮；若连解封也禁掉＝永久锁死（上一版演练的 bug）
      const dec0 = results[i].dec;
      const rescue = (dec0 && dec0.actions || []).filter(a => a.type === 'buyCyberService' || a.type === 'payRansom');
      const rr = await applyActions(s, rescue);
      decisionLog.push({ seat: s, blocked: true, note: '面板遭勒索覆盖 → 仅允许解封动作', applied: rr.applied, rejected: rr.rejected });
      console.log('  [' + s + '] 面板被攻击覆盖 → 解封动作 ' + (rr.applied.length ? rr.applied.map(a=>a.type).join(',') : '未选择'));
      continue;
    }
    if (!dec) {
      const raw = (results[i].raw.out || results[i].raw.err || "(无输出)").slice(-400);
      console.log("  [RAW " + s + "] code=" + results[i].raw.code + " outLen=" + results[i].raw.out.length + " err=" + raw.slice(-180));
      const gg = (await seatGet(s)).game;
      dec = ruleStrategy(s, gg, state[s]);
      decisionLog.push({ seat: s, fallback: true, note: dec.note, rawTail: raw });
    } else {
    }
    for (const i2 of (dec.removeIdx || [])) await seatPost(s, { type: "removeFlight", index: i2 });
    const { applied, rejected } = await applyActions(s, dec.actions);
    // ★ 第二层兜底（结果导向）：执行后若本组排班仍为空（决策被拒）→ 用规则策略补排班
    //   否则该组空回合 → advance 被拒 → 状态冻结（此前演练冻结的第二条路径）
    const gAfter = (await seatGet(s)).game;
    if (!gAfter.schedules.length) {
      const fb = ruleStrategy(s, gAfter, state[s]);
      const r2 = await applyActions(s, fb.actions);
      decisionLog.push({ seat: s, fallback: "rule-after-reject", applied: r2.applied, rejected: r2.rejected });
    }
    decisionLog.push({ seat: s, note: dec.note || '', applied, rejected });
  }
  // 套保选型（若 Agent 未选，则按预设）
  if (HEDGE_TURNS[turn]) {
    for (const s of SEATS) {
      const pick = HEDGE_TURNS[turn][s];
      const g = (await seatGet(s)).game;
      const already = (g.negotiation.fuelHedge || []).some(h => (h.quarters ?? 0) > 0);
      if (!already) { await seatPost(s, { type: 'acceptHedgeQuote', quoteId: pick }); decisionLog.push({ seat: s, autoHedge: pick }); }
    }
  }
  const adv = await gmPost({ type: 'advanceAll' });
  const season = { turn, period: `T${turn}`, judgeActs, decisions: decisionLog, advance: adv.result, seats: {} };
  for (const s of SEATS) {
    const g = (await seatGet(s)).game;
    const h = (g.history || [])[g.history.length - 1] || {};
    const d = h.detail || {};
    season.seats[s] = {
      cash: Math.round(g.cash), qsi: g.qsi,
      revenue: h.revenue != null ? Math.round(h.revenue) : null,
      cost: h.cost != null ? Math.round(h.cost) : null,
      operating_profit: h.operating_profit != null ? Math.round(h.operating_profit) : null,
      pax: h.paxTotal != null ? Math.round(h.paxTotal) : null,
      load_factor: h.load_factor != null ? +h.load_factor.toFixed(4) : null,
      ask: h.askTotal != null ? Math.round(h.askTotal) : null,
      share: h.market_share != null ? +h.market_share.toFixed(4) : null,
      routes: g.routes.map(r => r.code), schedules: g.schedules.length,
      fleet: g.aircraft.length, loans: Math.round(g.loan_balance || 0),
      investments: (g.investments || []).map(i => i.id),
      detail: Object.fromEntries(Object.entries(d).map(([c, v]) => [c, { pax: Math.round(v.pax), lf: +v.lf.toFixed(3), rev: Math.round(v.rev['Total Revenue']), op: Math.round(v.operating_profit), share: +(+v.share).toFixed(3) }])),
    };
    state[s] = { rejects: decisionLog.filter(d => d.seat === s).flatMap(d => (d.rejected || []).map(r => ({ type: r.type, why: r.why }))), revenue: season.seats[s].revenue, operating_profit: season.seats[s].operating_profit,
                 load_factor: season.seats[s].load_factor, share: season.seats[s].share, detail: season.seats[s].detail };
  }
  seasons.push(season);
  console.log(`\n【第 ${turn} 季】`);
  for (const s of SEATS) {
    const v = season.seats[s];
    console.log(`  ${s}(${STYLE[s]}) 现金 $${v.cash.toLocaleString()}｜收入 ${v.revenue ?? '—'}｜利润 ${v.operating_profit ?? '—'}｜LF ${v.load_factor ?? '—'}｜份额 ${v.share ?? '—'}｜航线 ${v.routes.join('+')}`);
  }
  for (const d of decisionLog) console.log(`   ${d.seat}: ${d.note || ''}${d.error ? ' [解析失败]' : ''} 动作 ${(d.applied || []).length} 拒绝 ${(d.rejected || []).length}`);
}
const report = { generatedAt: new Date().toISOString(), turns: MAX_TURNS, seasons, serverLog: srvLog.split('\n').slice(-30) };
writeFileSync(join(OUT, 'agentplay.json'), JSON.stringify(report, null, 2));
console.log('\n结构化数据已写入', join(OUT, 'agentplay.json'));
srv.kill(); process.exit(0);
