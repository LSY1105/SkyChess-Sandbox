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
import * as E from './engine.js';

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const money = (v) => (v == null ? '—' : (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString());
const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 1) => (v == null ? '—' : (v * 100).toFixed(d) + '%');

function table(head, rows) {
  const t = el('table');
  const tr = el('tr');
  head.forEach(h => tr.appendChild(el('th', null, h)));
  t.appendChild(tr);
  for (const r of rows) {
    const rr = el('tr');
    (r.cells || r).forEach(c => {
      const td = el('td', c && c.cls, c && c.text != null ? c.text : c);
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
    [summary, network, routeEcon, routeMetrics, fuel, investments, baseline, charts]
      [active](content, h, g);
  };
  draw();
  return { refresh: draw };
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
    return [ac.nickname || ac.type || ('#' + s.acId), ac.type || '—', m.name_c || s.code, s.departure,
      num(s.seats), num(s.bh, 2), s.flightNo || '—', ac.owned ? '自有' : '租赁'];
  });
  const tb = table(['飞机', '机型', '航线', '起飞', '座位', 'BH', '航班号', '产权'], rows);
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
function flightPopup(g, s, d) {
  const old = document.getElementById('flightPop'); if (old) old.remove();
  const ac = (g.aircraft || []).find(a => a.id === s.acId) || {};
  const m = MARKETS[s.code] || {};
  const gal = Math.round(624.6 * (s.bh || 0) * 90);
  const fuel = gal * (g.fuelPrice || 2.4);
  const rows = [
    ['航班号', s.flightNo || '—'], ['机型', ac.type || '—'], ['飞机', ac.nickname || ('#' + s.acId)],
    ['航线', (m.name_c || s.code) + '（' + s.code + '）'], ['航段', num(m.sector_km) + ' km'],
    ['起飞时刻', s.departure], ['座位', num(s.seats)], ['BH', num(s.bh, 2)],
    ['季度班次', num(90)], ['季加仑', num(gal)], ['季燃油成本', money(fuel)],
    ['当日返航', ac.long ? '长程允许过夜' : '须当日返航（22:00 前）'],
  ];
  const pop = el('div'); pop.id = 'flightPop';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:200';
  const box = el('div');
  box.style.cssText = 'background:#fff;border-radius:8px;max-width:460px;width:92%;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.3)';
  box.appendChild(el('h3', null, 'FLIGHT INFORMATION · 航班详情'));
  box.appendChild(table(['项目', '数值'], rows.map(([k, v]) => [k, { text: String(v) }])));
  const btn = el('button', null, '关闭');
  btn.style.cssText = 'margin-top:12px';
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
