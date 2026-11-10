/* ============================================================
   报表与运营视图渲染模块（U4 Reports 七页签 + U9 三视图）
   sandbox/reports.js
   ------------------------------------------------------------
   U4 Reports：Summary / Network Economics / Route Economics /
              Route Metrics / Fuel / Investments / 对标基线
              + 历史季度选择器
   U9 Ops：Fare Matrix / Live Schedules / Fleet Plans
   数据来源：席位 game 对象（history 每季报告 + lastDetail + 机队/租赁/投资）
   ============================================================ */
import { MARKETS, AIRCRAFT, GM } from './data.js';
import * as G from './game.js';
import * as E from './engine.js';

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString());
const num = (v, d = 0) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : (v * 100).toFixed(d) + '%');

function table(head, rows) {
  const t = el('table');
  const tr = el('tr');
  head.forEach(h => tr.appendChild(el('th', null, h)));
  t.appendChild(tr);
  for (const r of rows) {
    const rr = el('tr');
    (r.cells || r).forEach(c => {
      const td = el('td', c && c.cls, c && c.text != null ? c.text : c);
      if (c && c.onclick) { td.style.cursor = 'pointer'; td.onclick = c.onclick; }
      if (c && c.title) td.title = c.title;
      rr.appendChild(td);
    });
    t.appendChild(rr);
  }
  return t;
}

/** 取选中季度的报告（默认最后一季） */
export function pickReport(g, idx) {
  const h = g.history || [];
  if (!h.length) return null;
  return h[idx == null ? h.length - 1 : Math.max(0, Math.min(h.length - 1, idx))];
}

/* ─────────────── U4：Reports 七页签 ─────────────── */
const UI = { repTab: 0, repSeason: null, opsTab: 0 };
export function renderReports(root, g, opts = {}) {
  root.innerHTML = '';
  const hist = g.history || [];
  const tabs = el('div', 'tabs');
  const body = el('div', 'scroll');
  root.appendChild(tabs); root.appendChild(body);

  let sel = opts.seasonIdx != null ? opts.seasonIdx
    : (UI.repSeason != null ? Math.min(UI.repSeason, Math.max(0, hist.length - 1)) : hist.length - 1);
  const TABS = [
    ['Summary', '总览'],
    ['Network Economics', '网络经济'],
    ['Route Economics', '航线经济'],
    ['Route Metrics', '航线指标'],
    ['Fuel', '燃油'],
    ['Investments', '投资'],
    ['Flights', '航班与利用'],
    ['Baseline', '对标基线'],
    ['Charts', '趋势图'],
  ];
  let active = UI.repTab;

  const draw = () => {
    UI.repTab = active;
    tabs.innerHTML = '';
    TABS.forEach(([en, cn], i) => {
      const b = el('button', i === active ? 'on' : '', en + ' · ' + cn);
      b.onclick = () => { active = i; draw(); };
      tabs.appendChild(b);
    });
    body.innerHTML = '';
    const h = pickReport(g, sel);
    if (!h) { body.appendChild(el('div', 'small', '尚无历史报告（完成一个回合后生成）。')); return; }
    /* 历史季度选择器 */
    const selBar = el('div', 'row small');
    selBar.appendChild(el('span', null, '季度：'));
    hist.forEach((x, i) => {
      const b = el('button', i === sel ? 'on' : '', x.period || ('T' + x.turn));
      b.onclick = () => { sel = i; UI.repSeason = i; draw(); };
      selBar.appendChild(b);
    });
    body.appendChild(selBar);
    const content = el('div');
    body.appendChild(content);
    [summary, network, routeEcon, routeMetrics, fuel, investments, flights, baseline, charts]
      [active](content, h, g);
  };
  draw();
  return { refresh: draw };
}


/* ─────────────── FLIGHTS AND UTILISATION（原版 Reports-FLIGHTS 页签复刻）───────────────
   一手依据：主截图 Reports(VIEW REPORTS)-FLIGHTS.jpg + 六季度完结/…_22213….jpg
   结构：左「本航司 FLIGHTS DETAILED」+ 右「本航司 AIRCRAFT UTILISATION」，
        下方「竞品 FLIGHTS」+「竞品 AIRCRAFT UTILISATION」
   ★ 数值性质：Passengers / LF / Average Daily BH 全部为**当季动态量**（A 类），
     运价为当季参数（B 类）；竞品的客流与客座率**不公开** → 显示 '-'（保密规则，非 0） */
function flights(root, h, g) {
  /* ★ 按 Reports 的**季度选择器**取该季明细（h.detail 随 report 存入 history）
     —— 当期 = 最新一季；历史季 = 所选那一季 → 无需在弹窗里再加分页签 */
  const hist = g.history || [];
  const isCur = !h || (hist.length && hist[hist.length - 1] === h);
  const det = (isCur ? (g.lastDetail || {}) : ((h && h.detail) || {}));
  const cur = (g.schedules || []).map(s => {
    const ac = (g.aircraft || []).find(a => a.id === s.acId) || {};
    const m = MARKETS[s.code] || {};
    const route = (g.routes || []).find(r => r.code === s.code);
    /* 逐班次旅客数：与结算明细按起飞时刻匹配（★结算后才存在） */
    const d = det[s.code];
    let pax = null, lf = null;
    if (d && Array.isArray(d.flights)) {
      const depMin = (() => { const [h2, m2] = String(s.departure || '00:00').split(':').map(Number); return (h2 || 0) * 60 + (m2 || 0); })();
      const hit = d.flights.find(f => Math.abs((f.departureMin || 0) - depMin) < 1);
      /* ★ served 是**季度**旅客数（每班次每日 1 班 × 90 天）→ 单班旅客 = served ÷ 90 */
      if (hit && hit.served != null) {
        pax = Math.round(hit.served / 90);
        lf = s.seats ? pax / s.seats : null;
      }
    }
    return { s, ac, m, fare: route ? route.fare : null, pax, lf };
  });
  const known = cur.filter(x => x.pax != null);
  const wLF = known.length ? known.reduce((a, x) => a + x.pax, 0) / Math.max(1, known.reduce((a, x) => a + (x.s.seats || 0), 0)) : null;   // 座位加权

  const sec = (title, color) => {
    const d = el('div');
    d.style.marginBottom = '14px';
    const h3 = el('div', null, title);
    h3.style.cssText = 'border-bottom:2px solid ' + color + ';padding-bottom:4px;margin-bottom:8px;font-size:11px;color:var(--tx2);font-weight:600';
    d.appendChild(h3);
    root.appendChild(d);
    return d;
  };
  /* 自家航班明细 */
  const own = sec('本航司航班明细 · ' + (g.seat || '') + (h && h.period ? ' · ' + h.period : ''), 'var(--acc)');
  const rows = cur.map(x => [
    x.s.flightNo || '—', x.s.departure, (x.m.name || x.s.code), money(x.fare),
    x.ac.type || '—',
    x.pax != null ? num(x.pax) : '-',
    num(x.s.seats),
    x.lf != null ? pct(x.lf, 1) : '-',
    { text: '≡ 详情', cls: 'small', onclick: () => flightPopup(g, x.s) },
  ]);
  own.appendChild(table(['航班', '起飞', '市场', '运价', '机型', '旅客', '座位', '客座率', '详情'], rows));
  own.appendChild(el('div', 'small', '本季平均客座率：' + (wLF != null ? pct(wLF, 1) : '（结算后可见）')
    + '　· 旅客与客座率为**结算实绩**，未结算显示 '-'（原版同样不显示）'));

  /* 本航司机队利用 */
  const util = sec('本航司机队利用 · 平均每日 BH', 'var(--acc)');
  const byType = {};
  for (const ac of (g.aircraft || [])) {
    let used = null, cap = null;
    try { used = G.acUsedBH(g, ac.id); cap = G.acCapacity(g, ac.id); } catch { /* 无数据 */ }
    if (used == null || !Number.isFinite(used)) continue;
    const k = ac.type || '—';
    byType[k] = byType[k] || { sum: 0, n: 0, cap: 0 };
    byType[k].sum += used; byType[k].n++; byType[k].cap += cap || 0;
  }
  const uRows = Object.entries(byType).map(([k, v]) => [k, num(v.sum / v.n / 90, 2)]);
  /* 机队利用按**当季累计已用 BH**（A 类，每季变化）；历史季暂无逐机 BH 快照 → 显示当期值 */
  util.appendChild(table(['机型', '平均每日 BH'], uRows.length ? uRows : [['(尚无排班)', '—']]));
  util.appendChild(el('div', 'small', '口径：已用 BH ÷ 90 季内天数，按机型取机队平均（★每季随排班变化）'));

  /* 竞品航班与利用 */
  const peers = g.peerSchedules || {};
  const peerSeats = Object.keys(peers).filter(x => x !== g.seat);   // ★ 排除本组（本组在自家块）
  for (const seat of peerSeats) {
    const pg = peers[seat] || {};
    const ps = pg.schedules || [];
    const bl = sec('竞品航班明细 · ' + seat + '（客流与客座率不公开）', '#5b8fd6');
    const pRows = ps.map(s => {
      const ac = (pg.aircraft || []).find(a => a.id === s.acId) || {};
      const m = MARKETS[s.code] || {};
      return [s.flightNo || '—', s.departure, (m.name || s.code), money(s.fare), ac.type || '—', '-', num(s.seats), '-'];
    });
    bl.appendChild(table(['航班', '起飞', '市场', '运价', '机型', '旅客', '座位', '客座率'],
      pRows.length ? pRows : [['(该组尚无排班)', '', '', '', '', '', '', '']]));
    /* 竞品机队利用：按机型聚合其排班占用（公开可推算） */
    const pb = {};
    for (const s of ps) {
      const ac = (pg.aircraft || []).find(a => a.id === s.acId) || {};
      const k = ac.type || '—';
      pb[k] = (pb[k] || 0) + (s.bh || 0);
    }
    const pu = Object.entries(pb).map(([k, v]) => [k, num(v / 90, 2)]);
    bl.appendChild(el('div', 'small', '该组机队平均每日 BH：'
      + (pu.length ? pu.map(([k, v]) => `${k} ${v}`).join('　') : '—')
      + '　（★按公开排班推算，每季变化）'));
  }
}

function summary(root, h, g) {
  const rows = [
    ['期间', h.period], ['收入', money(h.revenue)], ['营业成本', money(h.cost)],
    ['经营利润', { text: money(h.operating_profit), cls: h.operating_profit >= 0 ? 'ok' : 'bad' }],
    ['一次性支出', money(h.oneoff)], ['融资项', money(h.financing)],
    ['期末现金', money(h.cash_end)], ['客座率 LF', pct(h.load_factor)],
    ['旅客', num(h.paxTotal)], ['ASK', (h.askTotal / 1e6).toFixed(1) + 'MM'],
    ['RPK', ((h.rpkTotal || 0) / 1e6).toFixed(1) + 'MM'], ['市场份额', pct(h.market_share, 2)],
    ['QSI', num(g.qsi, 1)], ['贷款余额', money(g.loan_balance)], ['毛利率', pct(h.gross_margin, 1)],
  ];
  root.appendChild(table(['项目', '数值'], rows.map(([k, v]) => [k, v && v.text != null ? v : { text: v == null ? '—' : String(v) }])));
}

function network(root, h, g) {
  const d = h.detail || {};
  const ask = Object.values(d).reduce((a, x) => a + x.ask, 0);
  const rpk = Object.values(d).reduce((a, x) => a + x.rpk, 0);
  const pax = Object.values(d).reduce((a, x) => a + x.pax, 0);
  root.appendChild(el('div', 'small', `网络 ASK ${(ask / 1e6).toFixed(1)}MM ｜ RPK ${(rpk / 1e6).toFixed(1)}MM ｜ LF ${ask ? (rpk / ask * 100).toFixed(1) : '—'}% ｜ 旅客 ${num(pax)} ｜ 市场总需求 ${num(Object.values(d).reduce((a, x) => a + (x.marketDemand || 0), 0))}`));
  const rows = Object.entries(d).map(([c, x]) => [
    MARKETS[c] ? MARKETS[c].name_c : c, num(x.freq), (x.ask / 1e6).toFixed(1), (x.rpk / 1e6).toFixed(1),
    pct(x.lf), money(x.rev['Total Revenue']), money(x.operating_profit),
  ]);
  root.appendChild(table(['航线', '频次', 'ASK(MM)', 'RPK(MM)', 'LF', '收入', '经营利润'], rows));
}

/** S5 舱位收入单元格：经济舱 / 超经舱 / 公务舱（未设分舱票价则显示 —） */
function cabinCell(cabin) {
  if (!cabin || !cabin.Y) return { text: '—' };
  const f = v => '$' + Math.round(v).toLocaleString();
  return { text: `${f(cabin.Y.rev)} / ${f(cabin.W.rev)} / ${f(cabin.J.rev)}
${Math.round(cabin.Y.pax)} / ${Math.round(cabin.W.pax)} / ${Math.round(cabin.J.pax)} 人` };
}

function routeEcon(root, h, g) {
  const rows = [];
  for (const [c, x] of Object.entries(h.detail || {})) {
    const m = MARKETS[c] || {};
    const yieldPerKm = m.sector_km ? x.fare / m.sector_km : 0;
    rows.push([
      m.name_c || c, num(x.fare, 2), num(m.sector_km), yieldPerKm.toFixed(4),
      money(x.rev['Passenger Revenue']), money(x.rev['Cargo Revenue']), money(x.rev['Ancillary Revenue']),
      money(x.cost['Fuel']), money(x.cost['Maintenance']), money(x.cost['Flight Crew']),
      cabinCell(x.cabin),
      { text: money(x.operating_profit), cls: x.operating_profit >= 0 ? 'ok' : 'bad' },
    ]);
  }
  root.appendChild(table(['航线', '运价', '航段km', 'YIELD', '客运', '货邮', '辅营', '燃油', '维修', '机组', '舱位收入(经/超/公)', '经营利润'], rows));
}

function routeMetrics(root, h, g) {
  const rows = [];
  for (const [c, x] of Object.entries(h.detail || {})) {
    const m = MARKETS[c] || {};
    const rivals = (x.rivals || []).map(r => `${r.key} ${(r.share * 100).toFixed(1)}%`).join('\r\n');
    rows.push([
      m.name_c || c, num(x.freq), num(Math.round(x.seats || 0)),
      (x.ask / 1e6).toFixed(1), (x.rpk / 1e6).toFixed(1), pct(x.lf),
      num(Math.round(x.marketDemand || 0)), pct(x.share, 1), rivals || '—', num(x.connected_pax || 0),
    ]);
  }
  root.appendChild(table(['航线', '频次/季', '座位', 'ASK(MM)', 'RPK(MM)', 'LF', '市场总需求', '我方份额', '对手份额', '中转'], rows));
}

function fuel(root, h, g) {
  const d = h.detail || {};
  const fuel = Object.values(d).reduce((a, x) => a + (x.cost['Fuel'] || 0), 0);
  const carbon = Object.values(d).reduce((a, x) => a + (x.cost['Carbon'] || 0), 0);
  const saf = Object.values(d).reduce((a, x) => a + (x.cost['Sustainable Aviation Fuel'] || 0), 0);
  const hedges = (g.negotiation && g.negotiation.fuelHedge) || [];
  root.appendChild(table(['项目', '数值'], [
    ['燃油成本', money(fuel)], ['碳成本', money(carbon)], ['SAF 成本', money(saf)],
    ['燃油单价', num(h.fuel_price_next || g.fuelPrice, 2) + ' $/gal'],
    ['碳价', money(h.carbon_price || g.carbonPrice) + ' /吨'],
    ['套保状态', hedges.length ? hedges.map(x => `${x.id || x.product} 锁价 ${x.strike} × ${(x.share * 100).toFixed(0)}% / 剩 ${x.quarters} 季`).join('；') : '无'],
  ]));
  const rows = Object.entries(d).map(([c, x]) => [MARKETS[c] ? MARKETS[c].name_c : c, money(x.cost['Fuel']), money(x.cost['Carbon'])]);
  root.appendChild(table(['航线', '燃油', '碳'], rows));
}

function investments(root, h, g) {
  const invs = g.investments || [];
  const rows = invs.map(i => [
    i.name, i.kind || '—', money(i.amount), money(i.annual), num(i.costPerPax, 2), num(i.revenuePerPax, 2),
    num(i.qsi, 1), 'T' + (i.openedTurn ?? '—'),
  ]);
  root.appendChild(table(['投资项', '类别', '一次性', '年费', '每客成本', '每客收益', 'QSI 效果', '开季'], rows));
  if (!rows.length) root.appendChild(el('div', 'small', '尚无投资。'));
}

/** 对标基线：与已知原版基线（若有）逐项对比 */
function baseline(root, h, g) {
  const B = (window.__BASELINE__ || {});       // 由页面注入的原版基线
  const keys = Object.keys(B);
  if (!keys.length) { root.appendChild(el('div', 'small', '本席位暂无原版基线数据（基线仅覆盖原版 CA / VA 部分季度）。')); return; }
  const rows = [];
  for (const [k, v] of Object.entries(B)) {
    const sim = { revenue: h.revenue, cost: h.cost, operating_profit: h.operating_profit, load_factor: h.load_factor }[k];
    rows.push([k, money(v), sim == null ? '—' : money(sim),
      sim == null || !v ? '—' : (((sim - v) / Math.abs(v)) * 100).toFixed(1) + '%']);
  }
  root.appendChild(table(['指标', '原版', '沙盘', '偏差'], rows));
}

/* ─────────────── U9：Fare Matrix / Live Schedules / Fleet Plans ─────────────── */
export function renderOpsViews(root, g) {
  root.innerHTML = '';
  const tabs = el('div', 'tabs');
  const body = el('div', 'scroll');
  root.appendChild(tabs); root.appendChild(body);
  const VIEWS = [['Fare Matrix', '票价矩阵'], ['Live Schedules', '实时航班表'], ['Fleet Plans', '机队计划'], ['Scheduler', '日程甘特图']];
  let active = UI.opsTab;
  const draw = () => {
    UI.opsTab = active;
    tabs.innerHTML = '';
    VIEWS.forEach(([en, cn], i) => {
      const b = el('button', i === active ? 'on' : '', en + ' · ' + cn);
      b.onclick = () => { active = i; draw(); };
      tabs.appendChild(b);
    });
    body.innerHTML = '';
    const c = el('div'); body.appendChild(c);
    [fareMatrix, liveSchedules, fleetPlans, schedulerView][active](c, g);
  };
  draw();
  return { refresh: draw };
}

/** 票价矩阵：航线 × 班次时刻 → 该航线运价 */
function schedulerView(root, g) { renderGantt(root, { [g.seat || 'seat']: g }); }
function fareMatrix(root, g) {
  const routes = (g.routes || []);
  const byCode = {};
  for (const s of (g.schedules || [])) (byCode[s.code] = byCode[s.code] || []).push(s);
  const hours = [...new Set((g.schedules || []).map(s => s.departure))].sort();
  const head = ['时刻'].concat(routes.map(r => (MARKETS[r.code] ? MARKETS[r.code].name_c : r.code) + ` $${r.fare}`));
  const rows = hours.map(hh => [hh].concat(routes.map(r => {
    const hit = (byCode[r.code] || []).filter(s => s.departure === hh);
    return hit.length ? `${hit.length}班 × ${hit[0].seats}座` : '—';
  })));
  root.appendChild(table(head, rows));
  root.appendChild(el('div', 'small', '分时定价：高峰 ×1.20 / 低谷 ×0.85（可在「分时定价」处按航线设定）。'));
}

/** 实时航班表：按飞机分组 */
function liveSchedules(root, g) {
  const rows = (g.schedules || []).map(s => {
    const ac = (g.aircraft || []).find(a => a.id === s.acId) || {};
    const m = MARKETS[s.code] || {};
    const cells = [ac.nickname || ac.type || ('#' + s.acId), ac.type || '—', m.name_c || s.code, s.departure,
      num(s.seats), num(s.bh, 2), s.flightNo || '—', ac.owned ? '自有' : '租赁'];
    /* ★ 原版 FLIGHTS 报表的 Data 按钮 → 打开 FLIGHT INFORMATION（航班详情） */
    cells.push({ text: '≡ 详情', cls: 'small', onclick: () => flightPopup(g, s) });
    return cells;
  });
  const tb = table(['飞机', '机型', '航线', '起飞', '座位', 'BH', '航班号', '产权', '详情'], rows);
  root.appendChild(tb);
  if (!rows.length) root.appendChild(el('div', 'small', '尚未排班。'));
  else {
    root.appendChild(el('div', 'small', '提示：点击任意一行查看 FLIGHT INFORMATION（航班详情）。'));
    [...tb.querySelectorAll('tr')].slice(1).forEach((tr, i) => {
      tr.style.cursor = 'pointer';
      tr.onclick = () => flightPopup(g, (g.schedules || [])[i]);
    });
  }
}

/** 机队计划 */
function fleetPlans(root, g) {
  const leaseOf = (id) => (g.leases || []).find(l => l.acId === id);
  const rows = (g.aircraft || []).map(a => {
    const l = leaseOf(a.id);
    const daily = (g.schedules || []).filter(s => s.acId === a.id).length;
    return [
      a.type + (a.nickname ? ' (' + a.nickname + ')' : ''), num(a.seats), a.owned ? '自有' : '租赁',
      (a.age != null ? a.age + ' 年' : '—'),
      daily, l ? (l.leaseType === 'dry' ? '干租' : '湿租') : '—',
      l ? money(l.quarterlyRent) : money(Math.round(a.price / 16.28 / 4)),
      a.owned ? '折旧' : '租金', 'T' + (a.acquiredTurn ?? '—'),
    ];
  });
  root.appendChild(table(['机型', '座位', '产权', '机龄', '日班次', '租赁类型', '季成本', '成本性质', '取得季'], rows));
  if (!rows.length) root.appendChild(el('div', 'small', '无机队。'));
}


/* ─────────────── U7/U8：趋势图（纯 SVG，无外部依赖） ─────────────── */
function lineChart(root, title, series, labels, opt = {}) {
  const W = 620, H = 170, P = 34;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%'); svg.setAttribute('max-width', '640');
  svg.style.background = '#1b1e22'; svg.style.border = '1px solid #2b3036'; svg.style.borderRadius = '6px';
  const all = series.flatMap(s => s.values.filter(v => v != null));
  if (!all.length) { root.appendChild(el('div', 'small', '暂无数据。')); return; }
  let mn = Math.min(...all), mx = Math.max(...all);
  if (opt.zero) mn = Math.min(0, mn);
  if (mx === mn) { mx = mn + 1; }
  const pad = (mx - mn) * 0.12; mx += pad; mn -= pad;
  const X = i => P + (labels.length > 1 ? i * (W - P * 2) / (labels.length - 1) : (W - P * 2) / 2);
  const Y = v => H - P - (v - mn) / (mx - mn) * (H - P * 2);
  const mk = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  // 网格与刻度
  for (let i = 0; i <= 4; i++) {
    const v = mn + (mx - mn) * i / 4, y = Y(v);
    svg.appendChild(mk('line', { x1: P, y1: y, x2: W - P, y2: y, stroke: '#24282e' }));
    const tx = mk('text', { x: 4, y: y + 4, 'font-size': 10, fill: '#8a929c' });
    tx.textContent = opt.pct ? (v * 100).toFixed(0) + '%' : (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v.toFixed(0));
    svg.appendChild(tx);
  }
  if (mn < 0 && mx > 0) svg.appendChild(mk('line', { x1: P, y1: Y(0), x2: W - P, y2: Y(0), stroke: '#d0d7de', 'stroke-dasharray': '3 3' }));
  labels.forEach((lb, i) => {
    const tx = mk('text', { x: X(i), y: H - 12, 'font-size': 10, fill: '#8a929c', 'text-anchor': 'middle' });
    tx.textContent = lb; svg.appendChild(tx);
  });
  for (const s of series) {
    const pts = s.values.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean);
    if (pts.length) svg.appendChild(mk('polyline', { points: pts.join(' '), fill: 'none', stroke: s.color || '#1f6feb', 'stroke-width': 2 }));
    s.values.forEach((v, i) => { if (v != null) svg.appendChild(mk('circle', { cx: X(i), cy: Y(v), r: 2.6, fill: s.color || '#1f6feb' })); });
  }
  root.appendChild(el('div', 'small', title));
  root.appendChild(svg);
  const lg = el('div', 'small');
  series.forEach(s => { const sp = el('span', null, '■ ' + s.name + '  '); sp.style.color = s.color || '#1f6feb'; lg.appendChild(sp); });
  root.appendChild(lg);
}

function charts(root, h, g) {
  const hist = g.history || [];
  const labels = hist.map(x => x.period || ('T' + x.turn));
  lineChart(root, '经营利润趋势（$）', [{ name: '经营利润', color: '#1f6feb', values: hist.map(x => x.operating_profit) }], labels, {});
  lineChart(root, '客座率 LF 趋势', [{ name: 'LF', color: '#2da44e', values: hist.map(x => x.load_factor) }], labels, { pct: true });
  lineChart(root, '收入与营业成本趋势（$）', [
    { name: '收入', color: '#1f6feb', values: hist.map(x => x.revenue) },
    { name: '营业成本', color: '#cf222e', values: hist.map(x => x.cost) },
  ], labels, {});
  const sh = hist.map(x => x.market_share);
  lineChart(root, '市场份额趋势', [{ name: '我方份额', color: '#8957e5', values: sh }], labels, { pct: true, zero: true });
}

/* ─────────────── U5：FLIGHT INFORMATION 弹窗 ─────────────── */

/** 单航班损益分摊：航线该季科目金额 ÷ 该航线该季班次数（等分）
 *  口径说明：结算明细 detail[code] 的科目混合了「单班次值」(Fuel/维护/机组) 与「航线级值」
 *  (Landing/Navigation/地面/货运/G&A)，为避免与结算口径冲突，本表统一按**班次数等分**，
 *  保证「单班次 × 班次数 = 航线级」恒等闭合；收入同理。
 *  ★ 科目金额为当季实绩（A 类），随每季结算变化 */
function flightSplit(g, s) {
  const det = (g.lastDetail || {})[s.code];
  if (!det) return null;
  const freq = Math.max(1, det.freq || 1);
  const k = 1 / freq;
  const cost = {};
  for (const [kk, v] of Object.entries(det.cost || {})) cost[kk] = v * k;
  const rev = {};
  for (const [kk, v] of Object.entries(det.rev || {})) rev[kk] = v * k;
  return { freq, cost, rev, det };
}

function flightPopup(g, s, d) {
  const old = document.getElementById('flightPop'); if (old) old.remove();
  const ac = (g.aircraft || []).find(a => a.id === s.acId) || {};
  const m = MARKETS[s.code] || {};
  const bh = s.bh || m.bh || 0;
  const seats = s.seats || 0;
  const fare = (g.routes || []).find(r => r.code === s.code)?.fare ?? 0;
  const fuelPrice = g.fuelPrice || 2.4;
  const carbonPrice = g.carbonPrice || 0;
  /* 沙盘计量口径：燃油加仑 → 碳当量吨（口径已与原版 ROUTE ECONOMICS 对账一致） */
  const gal = E.F08_GAL(bh);
  const fuelCost = E.F08_VAR(bh, fuelPrice);
  const carbonCost = E.carbonCost(gal, carbonPrice);
  const carbonT = carbonPrice ? carbonCost / carbonPrice : 0;          // 碳当量(吨)
  const carbonKg = carbonT * 1000;
  const galKg = gal * (GM.fuel_kg_per_gal || 3.04);                    // 密度取自 GM（物理常数，非该季参数）
  /* 利用率：已用 BH ÷ 机型 BH 容量 */
  let utilPct = null;
  try {
    const cap = G.acCapacity(g, s.acId), used = G.acUsedBH(g, s.acId);
    if (cap) utilPct = used / cap;
  } catch { /* 无机队数据时留空 */ }
  /* 旅客数：结算后才有实绩，未结算按满座上限（明确标注） */
  const det = (g.lastDetail || {})[s.code];
  const lf = det && det.lf != null ? det.lf : null;
  const pax = lf != null ? Math.round(seats * lf) : seats;
  const paxRevenue = seats * fare * (lf != null ? lf : 1);
  const unitFare = seats ? fare / seats : 0;

  const pop = el('div'); pop.id = 'flightPop';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:60';
  const box = el('div');
  box.style.cssText = 'background:#1b1e22;color:#e8eaed;border:1px solid #2b3036;border-radius:12px;max-width:920px;width:94%;padding:20px;box-shadow:0 8px 30px rgba(0,0,0,.5)';
  const h = el('h3', null, `FLIGHT INFORMATION · ${g.seat || ''} ${s.flightNo || (ac.type || '')}`);
  h.style.cssText = 'margin:0 0 4px;font-size:14px;font-weight:600';
  box.appendChild(h);
  const sub = el('div', 'small', `${m.name_c || s.code}（${s.code}）· 起飞 ${s.departure} · 机型 ${ac.type || '—'} · 座位 ${seats} · BH ${bh}${lf != null ? '' : ' · 旅客与客座率为满座上限（结算后更新）'}`);
  sub.style.marginBottom = '12px';
  box.appendChild(sub);

  /* 三栏（原版结构）：OPERATING COSTS STATEMENT / UTILISATION, FUEL & CARBON / FARE & PASSENGERS */
  const cols = el('div');
  cols.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px';
  const sect = (title) => {
    const d = el('div');
    d.innerHTML = '<div style="border-bottom:2px solid var(--acc);padding-bottom:4px;margin-bottom:8px;font-size:11px;color:var(--tx2);font-weight:600">' + title + '</div>';
    cols.appendChild(d);
    return d;
  };
  const kv = (parent, k, v) => {
    const r = el('div');
    r.style.cssText = 'display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px';
    const a = el('span', null, k); a.style.color = 'var(--dim)';
    const b = el('span', null, v); b.style.cssText = 'font-variant-numeric:tabular-nums;color:var(--tx)';
    r.appendChild(a); r.appendChild(b); parent.appendChild(r);
  };
  const c1 = sect('OPERATING COSTS STATEMENT');
  const sp = flightSplit(g, s);
  if (sp) {
    const r = sp.rev || {}, c = sp.cost || {};
    const revTotal = (r['Passenger Revenue'] || 0) + (r['Cargo Revenue'] || 0) + (r['Ancillary Revenue'] || 0);
    kv(c1, 'Passenger Revenue', money(r['Passenger Revenue'] || 0));
    kv(c1, 'Cargo Revenue', money(r['Cargo Revenue'] || 0));
    kv(c1, 'Ancillary Revenue', money(r['Ancillary Revenue'] || 0));
    kv(c1, 'TOTAL REVENUE', money(r['Total Revenue'] || revTotal));
    for (const k of ['Fuel', 'Sustainable Aviation Fuel', 'Carbon', 'Maintenance', 'Flight Crew', 'Cabin Crew',
                     'Landing', 'Navigation', 'Aircraft Handling', 'Traffic Handling',
                     'Cargo Handling', 'Cargo Overheads', 'General & Administration',
                     'Passenger Services', 'Ticketing, Sales and Promotion']) {
      if (c[k] == null) continue;
      kv(c1, k, money(c[k]));
    }
    const costSum = Object.values(c).reduce((a, v) => a + (v || 0), 0);
    kv(c1, 'TOTAL OPERATING COST', money(costSum));
    kv(c1, 'OPERATING PROFIT (单班次)', money((r['Total Revenue'] || revTotal) - costSum));
  } else {
    kv(c1, 'Passenger Revenue', money(paxRevenue) + (lf != null ? '' : '（满座上限）'));
    kv(c1, 'Cargo Revenue', '结算后可见');
    kv(c1, 'TOTAL REVENUE', money(paxRevenue) + (lf != null ? '' : '（满座上限）'));
    kv(c1, 'Fuel', money(fuelCost));
    kv(c1, 'Carbon', money(carbonCost));
    kv(c1, '其余科目', '结算后可见（航线级科目按班次数平均分摊）');
  }
  const c2 = sect('UTILISATION, FUEL & CARBON');
  kv(c2, 'Utilisation (Flight Time + Taxi Time)', num(bh, 2));
  kv(c2, '% of Aircraft Daily Utilisation', utilPct != null ? pct(utilPct, 2) : '—');
  kv(c2, 'Strike Price (Market Price)', '$' + fuelPrice.toFixed(2));
  kv(c2, 'Fuel Used', num(gal) + ' gal / ' + num(galKg) + ' kg');
  kv(c2, 'Carbon Price (per tonne)', money(carbonPrice));
  kv(c2, 'Carbon Emissions (Flight)', num(carbonKg) + ' kg（沙盘当量口径）');
  kv(c2, 'Carbon Costs (Flight)', money(carbonCost));
  kv(c2, 'Carbon Price Per Passenger', pax ? '$' + (carbonCost / pax).toFixed(2) : '—');
  kv(c2, 'Carbon Take Up', '100%');
  const c3 = sect('FARE & PASSENGERS');
  kv(c3, 'Fare', money(fare));
  kv(c3, 'Weighted Fare', money(fare));
  kv(c3, 'Unit Fare', '$' + unitFare.toFixed(3));
  kv(c3, 'Weighted Unit Fare', '$' + unitFare.toFixed(3));
  kv(c3, 'Passengers', pax + (lf != null ? '（实绩）' : '（满座上限）'));
  kv(c3, 'Load Factor', lf != null ? pct(lf, 1) : '—（未结算）');
  kv(c3, 'Sector', num(m.sector_km) + ' km');
  kv(c3, 'Route Demand / Share', '见 Route Metrics');
  box.appendChild(cols);
  const note = el('div', 'small', '注：原版 FLIGHT INFORMATION 为单航班完整损益表。沙盘的航线级科目在此按**该航线当季班次数平均分摊**到单班次（保证「单班次 × 班次数 = 航线级」恒等闭合，不与结算口径冲突）；旅客与客座率为季度结算实绩，未结算时显示满座上限。');
  note.style.marginTop = '12px';
  box.appendChild(note);
  const btn = el('button', null, '关闭');
  btn.style.marginTop = '12px';
  btn.onclick = () => pop.remove();
  box.appendChild(btn);
  pop.appendChild(box);
  pop.onclick = (e) => { if (e.target === pop) pop.remove(); };
  document.body.appendChild(pop);
}


/* ─────────────── U17：CSV 导出（浏览器原生 Blob，无依赖） ─────────────── */
export function exportCsv(filename, rows) {
  const csv = rows.map(r => r.map(c => {
    const s = c == null ? '' : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });   // BOM：Excel 中文不乱码
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

/** 汇总导出：各季关键指标 */
export function exportSummaryCsv(g, prefix) {
  const rows = [['期间', '收入', '营业成本', '经营利润', '一次性支出', '融资项', '期末现金', '旅客', 'ASK', 'RPK', '客座率LF', '市场份额', 'QSI']];
  for (const h of (g.history || [])) {
    const ask = Object.values(h.detail || {}).reduce((a, d) => a + d.ask, 0);
    const rpk = Object.values(h.detail || {}).reduce((a, d) => a + d.rpk, 0);
    rows.push([h.period, Math.round(h.revenue || 0), Math.round(h.cost || 0), Math.round(h.operating_profit || 0),
      Math.round(h.oneoff || 0), Math.round(h.financing || 0), Math.round(h.cash_end || 0),
      Math.round(h.paxTotal || 0), Math.round(ask), Math.round(rpk),
      (h.load_factor != null ? (h.load_factor * 100).toFixed(2) + '%' : ''),
      (h.market_share != null ? (h.market_share * 100).toFixed(2) + '%' : ''), g.qsi]);
  }
  exportCsv(`${prefix || 'seat'}_summary.csv`, rows);
}

/** 分航线导出（选中季度） */
export function exportRouteCsv(g, h, prefix) {
  const rows = [['期间', '航线', '频次', 'ASK', 'RPK', '旅客', '客座率LF', '运价', '客运收入', '货邮收入', '辅营收入', '收入合计', '燃油', '维修', '机组', '经营利润', '我方份额', '市场总需求']];
  for (const [c, d] of Object.entries((h && h.detail) || {})) {
    const m = MARKETS[c] || {};
    rows.push([(h && h.period) || '', m.name_c || c, d.freq, Math.round(d.ask), Math.round(d.rpk), Math.round(d.pax),
      (d.lf * 100).toFixed(2) + '%', d.fare, Math.round(d.rev['Passenger Revenue']), Math.round(d.rev['Cargo Revenue']),
      Math.round(d.rev['Ancillary Revenue']), Math.round(d.rev['Total Revenue']),
      Math.round(d.cost['Fuel'] || 0), Math.round(d.cost['Maintenance'] || 0), Math.round(d.cost['Flight Crew'] || 0),
      Math.round(d.operating_profit), (d.share != null ? (d.share * 100).toFixed(2) + '%' : ''), Math.round(d.marketDemand || 0)]);
  }
  exportCsv(`${prefix || 'seat'}_routes.csv`, rows);
}

/** 班次表导出 */
export function exportSchedulesCsv(g, prefix) {
  const rows = [['飞机', '机型', '产权', '航线', '起飞时刻', '航班号', '座位', 'BH']];
  for (const s of (g.schedules || [])) {
    const ac = (g.aircraft || []).find(a => a.id === s.acId) || {};
    const m = MARKETS[s.code] || {};
    rows.push([ac.nickname || ('#' + s.acId), ac.type || '', ac.owned ? '自有' : '租赁', m.name_c || s.code,
      s.departure, s.flightNo || '', s.seats, s.bh]);
  }
  exportCsv(`${prefix || 'seat'}_schedules.csv`, rows);
}

/** 投资明细导出 */
export function exportInvestmentsCsv(g, prefix) {
  const rows = [['投资项', '类别', '一次性', '年费', '每客成本', '每客收益', 'QSI效果', '开通季']];
  for (const i of (g.investments || []))
    rows.push([i.name, i.kind || '', i.amount || 0, i.annual || 0, i.costPerPax || 0, i.revenuePerPax || 0, i.qsi || 0, 'T' + (i.openedTurn ?? '')]);
  exportCsv(`${prefix || 'seat'}_investments.csv`, rows);
}

/* ─────────────── ROUTE DEMAND 复刻（原版 Reports-VIEW REPORTS-ROUTE DEMAND）
   每市场一张：彩色竖柱 = 各航司运力（座位/时刻）；红/绿双折线 = 该时段市场需求高低
   悬停（原生 <title>）显示数值。数据源：各席位 game.schedules + 需求模型 ─────────────── */
/* ★ 席位配色对齐原版 DAILY SCHEDULE：CA 黄 / AB 橄榄绿 / VA 蓝（跨组同屏一眼分组） */
const SEAT_COLOR = { CA: '#e6a700', AB: '#6b8e23', VA: '#2f6fa8' };
export function renderRouteDemand(container, games, opts = {}) {
  container.innerHTML = '';
  const list = games && Object.keys(games).length ? games : { '—': null };
  const seatsOf = games || {};
  // 汇总所有市场
  const codes = new Set();
  for (const g of Object.values(seatsOf)) {
    if (!g) continue;
    for (const r of (g.routes || [])) codes.add(r.code);
    for (const s of (g.schedules || [])) codes.add(s.code);
  }
  if (!codes.size) { container.appendChild(el('div', 'small', '暂无航线数据。')); return; }
  const shape = (opts.shape || []);
  const seatColor = opts.seatColor || SEAT_COLOR;
  for (const code of codes) {
    const m = MARKETS[code] || {};
    // 各时刻的运力柱：{seat: {seats, acLabel}}
    const bars = {};   // hour → seat → seats
    let fare = 0, freq = 0;
    for (const [seat, g] of Object.entries(seatsOf)) {
      if (!g) continue;
      const r = (g.routes || []).find(x => x.code === code);
      if (r) { fare = r.fare; freq += (g.schedules || []).filter(s => s.code === code).length * 90; }
      for (const s of (g.schedules || [])) {
        if (s.code !== code) continue;
        const h = parseInt(String(s.departure || '00:00').slice(0, 2), 10) || 0;
        (bars[h] = bars[h] || {})[seat] = (bars[h][seat] || 0) + (s.seats || 0);
      }
    }
    // 需求曲线（红=高需求情景，绿=低需求情景）
    /* 需求用**市场总量**（不依赖本组是否开通该航线/是否已定价）→ 图始终有意义 */
    const FALLBACK_SHAPE = [0.35,0.3,0.28,0.28,0.35,0.55,0.8,0.95,1.0,0.95,0.85,0.7,
                            0.6,0.65,0.75,0.85,0.9,1.0,0.95,0.9,0.8,0.7,0.55,0.4];
    let daily = 0;
    if (E && m.name) {
      try { daily = E.demand(m.name, m.guide_fare || 200, Math.max(freq, 180), 1) / 90; } catch { daily = 0; }
    }
    if (!daily && m.cargo_demand) daily = 40;   // 兜底，保证图形不空白
    /* ★ 15 分钟粒度（原版：一天按每 15 分钟一个时刻划分）→ 68 个刻度点 6:00–23:00
       曲线值按**日形状线性插值**（日形状为 24 个整点） */
    const HOURS = [];
    for (let h = 6; h <= 23; h++) for (let q = 0; q < 4; q++) HOURS.push(h + q / 4);
    const shapeAt = (hf) => {
      const i0 = Math.floor(hf), i1 = Math.min(23, i0 + 1), f = hf - i0;
      const s0 = (shape && shape.length === 24 && shape[i0] != null) ? shape[i0] : FALLBACK_SHAPE[i0];
      const s1 = (shape && shape.length === 24 && shape[i1] != null) ? shape[i1] : FALLBACK_SHAPE[i1];
      return s0 + (s1 - s0) * f;
    };
    const hhmm = (hf) => String(Math.floor(hf)).padStart(2, '0') + ':' + String(Math.round((hf % 1) * 60)).padStart(2, '0');
    /* ★ 需求是**一条固定曲线**（原版：具体需求基本是固定值，不随排班/定价变化）
       着色按**趋势分段**：上升与高峰段 = 红，下降与低峰段 = 绿 */
    const curve = HOURS.map(h => daily * shapeAt(h));
    /* ★ 原版结构（一手截图核对）：**绿色 = 需求曲线**（全天固定值）、**红色 = 实际载量曲线**
       旧实现为「一条线按趋势分段着色」，与原版不一致 → 已改为两线 */
    const loadByHour = {};
    for (const [, gg] of Object.entries(seatsOf)) {
      const dd = gg && gg.lastDetail && gg.lastDetail[code];
      for (const f of ((dd && dd.flights) || [])) {
        const h2 = Math.floor((f.departureMin || 0) / 60);
        loadByHour[h2] = (loadByHour[h2] || 0) + (f.served || 0);
      }
    }
    /* ★ 裁定（2026-11-03）：需求线**双色显示** —— 红色 = 需求上涨段，绿色 = 需求下降段 */
    const segColor = (i) => {                       // 第 i 段（i → i+1）
      if (i <= 0) return '#cf222e';
      const d = curve[i] - curve[i - 1];
      if (d > 0.0001) return '#cf222e';             // 需求上涨 → 红
      if (d < -0.0001) return '#2da44e';            // 需求下降 → 绿
      return null;                                 // 持平 → 并入上一段
    };
    // 把同色连续段合成一条 polyline
    const segs = [];
    let cur = null;
    for (let i = 0; i < curve.length - 1; i++) {
      const c = segColor(i);
      if (!cur || cur.color !== c) { cur = { color: c, pts: [i] }; segs.push(cur); }
      cur.pts.push(i + 1);
    }
    const lo = null;   // 不再有第二条线
    const maxBar = Math.max(1, ...HOURS.map(h => Object.values(bars[h] || {}).reduce((a, b) => a + b, 0)));
    const maxLine = Math.max(1, ...curve);
    const W = 620, H = 190, PL = 46, PB = 34, PT = 12;
    const X = h => PL + (h - 6 + 0.125) * (W - PL - 10) / 17;   // 6:00–23:00 共 17 小时
    const Y = v => H - PB - (v / Math.max(maxBar, maxLine)) * (H - PB - PT);
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    const box = el('div'); box.style.marginBottom = '14px';
    box.appendChild(el('div', null, m.name_c || code));
    box.appendChild(el('div', 'small', `Flight Capacity and Actual Loads - (${m.name_c || code})　· 需求线：红=上涨段 / 绿=下降段　灰=实际载量`));
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', 'max-width': '640' });
    svg.style.background = '#1b1e22'; svg.style.border = '1px solid #2b3036'; svg.style.borderRadius = '6px';
    // 网格与 Y 轴刻度
    const yMax = Math.max(maxBar, maxLine);
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4, y = Y(v);
      svg.appendChild(mk('line', { x1: PL, y1: y, x2: W - 8, y2: y, stroke: '#24282e' }));
      const tx = mk('text', { x: PL - 6, y: y + 4, 'font-size': 10, fill: '#8a929c', 'text-anchor': 'end' });
      tx.textContent = String(Math.round(v)); svg.appendChild(tx);
    }
    /* 需求曲线：按趋势**双色分段**（红=上涨段，绿=下降段） */
    for (const sgm of segs) {
      if (!sgm.color) continue;
      const pts = sgm.pts.map(i => `${X(HOURS[i])},${Y(curve[i])}`);
      svg.appendChild(mk('polyline', { points: pts.join(' '), fill: 'none', stroke: sgm.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
    }
    // 实际载量曲线：中性灰单线（避免与需求双色混淆）
    svg.appendChild(mk('polyline', { points: HOURS.map(h => `${X(h)},${Y(loadByHour[h] || 0)}`).join(' '), fill: 'none', stroke: '#8a929c', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
    // 折线点（悬停显示该时刻需求值、实际载量与趋势）
    HOURS.forEach((h, i) => {
      const d = i > 0 ? curve[i] - curve[i - 1] : 0;
      const tag = i === 0 ? '起点' : (d > 0.0001 ? '上升' : d < -0.0001 ? '下降' : '持平');
      const c = mk('circle', { cx: X(h), cy: Y(curve[i]), r: 2.6, fill: d > 0.0001 ? '#cf222e' : (d < -0.0001 ? '#2da44e' : '#8a929c') });
      const ti = mk('title', {});
      ti.textContent = `${hhmm(h)}　需求 ${Math.round(curve[i])} 人/日　实际载量 ${Math.round(loadByHour[h] || 0)} 人　趋势：${tag}`;
      c.appendChild(ti);
      svg.appendChild(c);
    });
    // 运力柱（按航司着色，悬停显示座位数）
    for (const h of HOURS) {
      for (const [seat, seats] of Object.entries(bars[h] || {})) {
        const bx = X(h) - 6 + (Object.keys(bars[h] || {}).indexOf(seat) * 3);
        const r = mk('rect', { x: bx, y: Y(seats), width: 3, height: Math.max(1, H - PB - Y(seats)), fill: seatColor[seat] || '#888', opacity: 0.85 });
        const ti = mk('title', {}); ti.textContent = `${String(h).padStart(2, '0')}:00　${seat}　运力 ${seats} 座`; r.appendChild(ti);
        svg.appendChild(r);
      }
    }
    // X 轴标签
    for (let h = 4; h <= 22; h += 2) {
      const tx = mk('text', { x: X(h), y: H - 14, 'font-size': 9, fill: '#8a929c', 'text-anchor': 'middle' });
      tx.textContent = String(h).padStart(2, '0') + ':00'; svg.appendChild(tx);
    }
    const xl = mk('text', { x: W / 2, y: H - 2, 'font-size': 10, fill: '#8a929c', 'text-anchor': 'middle' });
    xl.textContent = 'Departure Time'; svg.appendChild(xl);
    const yl = mk('text', { x: 12, y: H / 2, 'font-size': 10, fill: '#8a929c', 'text-anchor': 'middle', transform: `rotate(-90 12 ${H / 2})` });
    yl.textContent = 'Capacity per aircraft seats'; svg.appendChild(yl);
    box.appendChild(svg);
    if (!Object.keys(bars).length || !daily) {
      const tip = el('div', 'small');
      tip.textContent = !daily
        ? '暂无需求数据（需先开通航线并设定运价；完成一个回合后可见需求高低曲线）'
        : '暂无运力柱（尚未排班）';
      box.appendChild(tip);
    }
    // 图例
    const lg = el('div', 'small');
    for (const [seat, col] of Object.entries(seatColor)) { const sp = el('span', null, '■ ' + seat + ' 运力　'); sp.style.color = col; lg.appendChild(sp); }
    const r1 = el('span', null, '— 需求上升/高峰段　'); r1.style.color = '#cf222e'; lg.appendChild(r1);
    const r2 = el('span', null, '— 需求下降/低峰段'); r2.style.color = '#2da44e'; lg.appendChild(r2);
    box.appendChild(lg);
    container.appendChild(box);
  }
}

/* ─────────────── DAILY SCHEDULE 甘特图（复刻原版 Flight Scheduler）
   行 = 飞机（按席位分组）；列 = 时刻 06:00–24:00；块 = 航班（标航线名）
   **块宽 = 占用时长**（起飞 → 到达 → 过站结束 = blockUntil）→ 直观看出该机何时可再排班
   悬停：航班号 / 机型 / 航线 / 起飞-到达 / 过站 / 货量 ─────────────── */
const ROUTE_COLOR = {
  SIM: '#e3b341', ETN: '#79c0ff', PKR: '#7ee787', FTZ: '#d2a8ff', JOP: '#ffa657',
  LEW: '#76e3ea', ARM: '#ff7b72', GEE: '#a5a5a5', BZY: '#f2cc60', CHA: '#aff5b4',
};
export function renderGantt(container, games, opts = {}) {
  container.innerHTML = '';
  const list = games && Object.keys(games).length ? games : {};
  const seatName = opts.seatName || { CA: 'CA', AB: 'AB', VA: 'VA' };
  const rows = [];   // {seat, ac, label, flights:[{s, dep, blk}]}
  for (const [seat, g] of Object.entries(list)) {
    if (!g) continue;
    for (const ac of (g.aircraft || [])) {
      const fl = (g.schedules || []).filter(s => s.acId === ac.id);
      if (!fl.length) continue;
      /* ★ 行标签对齐原版 DAILY SCHEDULE：`APT100 (CA:Starter)` / `G160XLR P3 (CA:005)` */
      const acTag = (ac.nickname && /starter/i.test(ac.nickname)) ? 'Starter' : String(ac.id);
      rows.push({ seat, ac, label: `${ac.type || ''} (${seat}:${acTag})`, flights: fl });
    }
  }
  if (!rows.length) { container.appendChild(el('div', 'small', '暂无排班（完成一个回合并排班后显示）。')); return; }
  const T0 = 6 * 60, T1 = 24 * 60, TOTAL = T1 - T0;
  const W = 1000, LEFT = 150, ROWH = 34, TOP = 26;
  const H = TOP + rows.length * ROWH + 26;
  const cellW = (W - LEFT - 10) / (TOTAL / 60);
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const toMin = (s) => { const [h2, m2] = String(s || '00:00').split(':').map(Number); return (h2 || 0) * 60 + (m2 || 0); };
  const fmtMin = (v) => String(Math.floor((((v % 1440) + 1440) % 1440) / 60)).padStart(2, '0') + ':' + String(Math.round(v % 60)).padStart(2, '0');
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', 'max-width': '1020' });
  svg.style.background = '#1b1e22'; svg.style.border = '1px solid #2b3036'; svg.style.borderRadius = '6px';
  // 时间刻度
  for (let h = 6; h <= 23; h++) {
    const x = LEFT + (h * 60 - T0) / 60 * cellW;
    svg.appendChild(mk('line', { x1: x, y1: TOP - 6, x2: x, y2: H - 20, stroke: '#24282e' }));
    const tx = mk('text', { x, y: TOP - 10, 'font-size': 10, fill: '#8a929c', 'text-anchor': 'middle' });
    tx.textContent = String(h).padStart(2, '0') + ':00'; svg.appendChild(tx);
  }
  rows.forEach((r, i) => {
    const y = TOP + i * ROWH;
    // 行标签
    const lb = mk('text', { x: 8, y: y + ROWH / 2 + 4, 'font-size': 11, fill: '#d8dde3' });
    lb.textContent = r.label; svg.appendChild(lb);
    svg.appendChild(mk('rect', { x: LEFT, y: y + 3, width: W - LEFT - 10, height: ROWH - 8, fill: i % 2 ? '#191c20' : '#16181c', stroke: '#24282e' }));
    // 航班块
    for (const s of r.flights) {
      const dep = toMin(s.departure);
      const mkt = MARKETS[s.code] || {};
      const bhM = s.bh || mkt.bh || 1.5;
      const base = (GM.style_turnaround || {})[(games[r.seat] && games[r.seat].style) || 'Hybrid'] || 45;
      const turnM = s.turnaround != null ? s.turnaround : base;
      /* ★ 块宽覆盖**推出 → 撤轮档完成**（含地滑与撤轮档），回程块同理 */
      const tOut = s.taxiOut != null ? s.taxiOut : ((GM.taxi_out_min) || 0);
      const tIn = s.taxiIn != null ? s.taxiIn : ((GM.taxi_in_min) || 0);
      const offMin = s.offBlocks ? toMin(s.offBlocks) : dep + tOut;           // 轮挡起飞
      const onMin = s.onBlocks ? toMin(s.onBlocks) : offMin + Math.round(bhM * 60);   // 轮挡落地
      const arrMin = s.arrival ? toMin(s.arrival) : onMin + tIn;             // 到达（廊桥）
      const retDepMin = s.returnDeparture ? toMin(s.returnDeparture) : arrMin + turnM;   // 回程起点
      const retArrMin = s.returnArrival ? toMin(s.returnArrival) : retDepMin + tOut + Math.round(bhM * 60) + tIn;  // 回程到达

      const col = ROUTE_COLOR[s.code] || '#8b949e';
      const seatFill = SEAT_COLOR[r.seat] || null;
      const mkBlk = (x0, x1, y0, h, fill0, op) => { const fill = seatFill || fill0; const rc = mk('rect', { x: x0, y: y0, width: Math.max(6, (x1 - x0) / 60 * cellW), height: h, fill: fill, opacity: op, stroke: '#6b7480', 'stroke-width': 0.6, rx: 2 }); svg.appendChild(rc); return rc; };
      const xOut = LEFT + (dep - T0) / 60 * cellW;          // 起点（学员填写）
      const xArr = LEFT + (arrMin - T0) / 60 * cellW;        // 到达（廊桥）
      const xRetDep = LEFT + (retDepMin - T0) / 60 * cellW;      // 回程起飞
      const xRetArr = LEFT + (retArrMin - T0) / 60 * cellW;    // 回程到达
      const rect = mkBlk(xOut, xArr, y + 7, ROWH - 16, col, 0.95);            // 去程占用
      mkBlk(xRetDep, xRetArr, y + 7, ROWH - 16, col, 0.55);                    // 回程占用（浅色）
      const ti = mk('title', {});
      ti.textContent = `${s.flightNo || ''}　${r.ac.type || ''}　${s.code}　去程 起点${fmtMin(dep)} → 轮挡起飞${fmtMin(offMin)} → 轮挡落地${fmtMin(onMin)} → 到达${fmtMin(arrMin)}`
        + `　回程 起点${fmtMin(retDepMin)} → 到达${fmtMin(retArrMin)}　过站(清洁保障) ${turnM} 分　下一班可开始 ${fmtMin(retArrMin)}`
        + `　座位 ${s.seats || '—'}　货量 ${(s.cargoCap != null ? s.cargoCap : '—')}`;
      rect.appendChild(ti);
      svg.appendChild(rect);
      if (xArr - xOut > 46) {
        /* ★ 块内标航线名（原版显示市场英文名 Simone/Fitzgerald/Joplin…，非代码） */
        const tx = mk('text', { x: xOut + 4, y: y + ROWH / 2 + 3, 'font-size': 10, fill: '#1f2328' });
        const mkInfo = (MARKETS || {})[s.code];
        tx.textContent = (mkInfo && (mkInfo.name || mkInfo.name_c)) || s.code;
        svg.appendChild(tx);
      }
    }
  });
  const xl = mk('text', { x: (W) / 2, y: H - 4, 'font-size': 11, fill: '#8a929c', 'text-anchor': 'middle' });
  xl.textContent = 'Departure Time（深色=去程，浅色=回程；占位 = 去程 → 往返到达 → 过站结束）'; svg.appendChild(xl);
  container.appendChild(svg);
  const lg = el('div', 'small');
  lg.textContent = '图例：各航线一色；悬停块可看航班号、机型、航线、起飞-到达、过站时间、可再排时刻、座位与货量';
  container.appendChild(lg);
}
