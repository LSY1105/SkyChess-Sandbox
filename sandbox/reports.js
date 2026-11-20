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
import { MARKETS, AIRCRAFT, GM, INVESTMENTS } from './data.js';
import * as G from './game.js';
import * as E from './engine.js';

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls;
  /* ★ 全局 NaN 防护：数值型文本若为 NaN/Infinity → 显示 '—'，杜绝界面出现 "NaN" */
  if (txt != null) e.textContent = (typeof txt === 'number' && !Number.isFinite(txt)) ? '—' : txt;
  return e; };
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
/** 报表页签表（第三位 = 高频标记，默认露出）
 *  ★ 导出供标题自动取数 —— 标题写死「七页签」而实际 10 个是会骗人的事实性错误（11-17 critique）
 *  ★ 高频 4 个：Summary / 航线经济 / 航班与利用 / 航线需求 —— 每季决策与复盘真正要看的 */
export const REPORT_TABS = [
  ['Summary', '总览', 1],
  ['Network Economics', '网络经济', 0],
  ['Route Economics', '航线经济', 1],
  ['Route Metrics', '航线指标', 0],
  ['Fuel', '燃油', 0],
  ['Investments', '投资', 0],
  ['Flights', '航班与利用', 1],
  ['Route Demand', '航线需求', 1],
  ['Baseline', '对标基线', 0],
  ['Charts', '趋势图', 0],
];
const UI = { repTab: 0, repSeason: null, repMore: false, opsTab: 0 };
/** 小组端「查看投资报表」：切到指定页签并展开「更多报表」（UI 状态由 renderReports 消费） */
export function setReportTab(i) { UI.repTab = i; UI.repMore = true; }

export function renderReports(root, g, opts = {}) {
  /* ★ 增量更新：轮询（6s）会再次调用本函数，若每次 root.innerHTML='' 整块重建，
     用户正在点的页签会被替换掉 → 「点标签无反应」+ 闪动 + 点失效标签时崩溃。
     改为：页签容器复用（仅首次创建），只更新内容区，并保留内容区滚动位置。 */
  const hist = g.history || [];
  let tabs = root.querySelector(':scope > .tabs');
  let body = root.querySelector(':scope > .scroll');
  if (!tabs || !body) {
    root.innerHTML = '';
    tabs = el('div', 'tabs');
    /* ★ 报表内容区**不设高度上限**（此前 .scroll 320px 把需求图 461px 吃掉，学员要在框内再滚一次） */
    body = el('div', 'scroll report-open');
    root.appendChild(tabs); root.appendChild(body);
  }

  let sel = opts.seasonIdx != null ? opts.seasonIdx
    : (UI.repSeason != null ? Math.min(UI.repSeason, Math.max(0, hist.length - 1)) : hist.length - 1);
  const TABS = REPORT_TABS;
  let active = UI.repTab;

  const draw = () => {
    UI.repTab = active;
    /* ★ 页签两级化（11-17 critique）：默认只露 4 个高频页签，其余收进「更多报表 ▾」
       —— 原版 10 页签平铺 3 行 + 4 个导出按钮 = 同屏 15 个可点目标，学员找不到要看的那张图
       ★ 按钮集合变化时才重建（轮询不改变集合 → 不重建 → 点击不落空） */
    const more = !!UI.repMore;
    const shown = TABS.map((t, i) => ({ en: t[0], cn: t[1], i })).filter(x => more || TABS[x.i][2]);
    if (tabs.children.length !== shown.length + 1) {
      tabs.innerHTML = '';
      for (const x of shown) {
        const b = el('button', '', x.en + ' · ' + x.cn);
        b.dataset.i = String(x.i);
        b.onclick = () => { active = x.i; draw(); };
        tabs.appendChild(b);
      }
      const mb = el('button', more ? 'on' : '', more ? '▴ 收起更多' : '▾ 更多报表（' + (TABS.length - shown.length) + '）');
      mb.onclick = () => {
        UI.repMore = !UI.repMore;
        if (!UI.repMore && !TABS[active][2]) active = 0;   // 收起时若当前页签被藏 → 回到总览
        draw();
      };
      tabs.appendChild(mb);
    }
    [...tabs.children].forEach((b, k) => b.classList.toggle('on', k < shown.length ? shown[k].i === active : more));
    const keepScroll = body.scrollTop;
    body.innerHTML = '';
    const h0 = pickReport(g, sel);
    if (!h0) {
      const nb = el('div', 'warn', '⚠ 本季尚未结算 · 盈利与历史报告将在裁判结算本组后生成。下表为当前已取得的即时数据；「投资」页签始终显示已投放的投资。');
      nb.style.cssText = 'background:#241f14;border:1px solid #5a4a22;border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:13px;line-height:1.6';
      body.appendChild(nb);
    }
    /* ★ 无历史报告时仍渲染页签骨架（否则点页签只是重复同一句提示 → 用户觉为「按钮无反应」） */
    const h = h0 || { period: (g.period && g.period.label) || '—', detail: {}, revenue: null, cost: null, operating_profit: null,
      oneoff: null, financing: null, cash_end: g.cash, load_factor: null, gross_margin: null,
      askTotal: 0, rpkTotal: 0, paxTotal: 0, market_share: null };
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
    [summary, network, routeEcon, routeMetrics, fuel, investments, flights, routeDemandTab, baseline, charts]
      [active](content, h, g);
    body.scrollTop = keepScroll;          // 保留滚动位置（报表区可下滑浏览）
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
  own.appendChild(el('div', 'small', '点右侧「≡ 详情」打开 FLIGHT INFORMATION（单航班损益表）；弹窗顶部可切换历史季度（需已结算 ≥2 季才有多项可选）。'));

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

/* ★ KPI 卡内联图标（原版 Summary 六卡的图形：人群 / 点赞 / 饼图 / 天平 / 百分号 / 银行）
   —— 纯装饰，path 坐标取自 24×24 画布；金色描边随主题变量 */
const KPI_ICONS = {
  people: ['M9 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5', 'M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5',
    'M16.8 6.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4', 'M16.5 14c2.6 0 4.5 1.3 4.5 4'],
  thumb: ['M8 11h3l2-6a1.6 1.6 0 0 1 2 1.4l-.8 4.6H18a1.6 1.6 0 0 1 1.6 2l-1 6a1.6 1.6 0 0 1-1.6 1.4H8z',
    'M5 11.5h3v7.9H5z'],
  pie: ['M12 3a9 9 0 1 0 9 9h-9z', 'M12 3v9h9'],
  scale: ['M12 4.5v15', 'M4.5 8h15', 'M4.5 8 2 13.5a3 3 0 0 0 5 0z', 'M19.5 8 22 13.5a3 3 0 0 1-5 0z'],
  pct: ['M8.6 6.6a2 2 0 1 1 0 4 2 2 0 0 1 0-4', 'M15.4 13.4a2 2 0 1 1 0 4 2 2 0 0 1 0-4', 'M6 18 18 6'],
  bank: ['M3 9.5 12 4l9 5.5', 'M5.5 10.5v6.5', 'M9.6 10.5v6.5', 'M14.4 10.5v6.5', 'M18.5 10.5v6.5', 'M3 20h18'],
};
function kpiIcon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '26'); svg.setAttribute('height', '26');
  svg.setAttribute('fill', 'none');
  svg.style.stroke = 'var(--acc,#d8a33f)';
  svg.style.strokeWidth = '1.5';
  svg.style.strokeLinecap = 'round'; svg.style.strokeLinejoin = 'round';
  for (const d of (KPI_ICONS[name] || [])) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/** 官方 Summary 六项 KPI 卡片：3 列网格 + 金色描边 + 深色底（原版：图标 → 标签 → 数值，居中） */
function kpiCards(root, items) {
  const grid = el('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 6px';
  for (const it of items) {
    const c = el('div');
    c.style.cssText = 'border:1px solid var(--acc,#d8a33f);background:var(--raised,#212529);border-radius:6px;padding:8px 10px;text-align:center';
    if (it.icon) { const ic = kpiIcon(it.icon); ic.style.margin = '0 auto 2px'; c.appendChild(ic); }
    c.appendChild(el('div', 'small', it.label));
    const v = el('div', null, it.value);
    v.style.cssText = 'font-size:20px;font-weight:600;margin-top:2px';
    c.appendChild(v);
    /* ★ 口径注（11-17 critique）：同一术语多个数时，把口径写在数字旁边，而不是散落在别处 */
    if (it.note) c.appendChild(el('div', 'small', it.note));
    grid.appendChild(c);
  }
  root.appendChild(grid);
}

function summary(root, h, g) {
  /* ★ 六卡按**原版顺序**：ALF / QSI / Market Share ‖ Break-even LF / Margin / Closing Cash
     （原版第 3 张是 Market Share；Total Operating Cost 只出现在成本分解图里，不是 KPI） */
  kpiCards(root, [
    { label: 'Average Load Factor', value: pct(h.load_factor, 1), icon: 'people' },
    { label: 'Quality Service Indicator', value: num(g.qsi, 2), icon: 'thumb' },
    { label: 'Market Share', value: pct(h.market_share, 2), icon: 'pie' },
    { label: 'Break-even Load Factor', value: h.breakEvenLF != null ? pct(h.breakEvenLF, 1) : '—', icon: 'scale',
      note: '单班次现金成本 ÷ 满座收入（全网 ASK 加权）；与「运力指引」固定成本口径不同' },
    { label: 'Margin', value: pct(h.gross_margin, 2), icon: 'pct',
      note: '按已结算季度收入计；亏损季固定成本照常计提 → 结构性为负' },
    { label: 'Closing Cash', value: money(h.cash_end), icon: 'bank' },
  ]);
  costSummaryChart(root, h, g);
  root.appendChild(el('div', 'small', '盈亏平衡客座率按「基础票价 + 全局油价」口径估算，未反映分时有效票价与套保油价；盈利类指标需裁判结算本季后生成。'));
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

/** Reports 页签「航线需求」：复用 U9 需求图（口径与玩家端同一渲染器） */
function routeDemandTab(root, h, g) {
  try { renderRouteDemand(root, { [g.seat || 'seat']: g }, {}); }
  catch { root.appendChild(el('div', 'small', '航线需求图暂不可用（数据不足）。')); }
}


/* ─────────────── COSTS SUMMARY：成本分解图（原版 Reports-Summary 页签下方，原沙盘完全缺失）───────────────
   结构：左列收入三分支（客运/货运/辅营）→ 中列 Quarter 聚合条 → 右列 7 个成本科目 + Profit
   高度 ∝ 金额，连接带为梯形多边形；科目归并与引擎科目一一对应（见 COSTS_GROUPS）
   ★ 闭合等式：Σ收入 = Σ七项成本 + Profit（与 report.revenue / report.cost 对账，容差 $1） */
const COST_REVS = [['Passenger Revenue', '客运收入'], ['Cargo Revenue', '货运收入'], ['Ancillary Revenue', '辅营收入']];
const COSTS_GROUPS = [
  { label: 'Fuel Costs', cn: '燃油', keys: ['Fuel', 'Carbon', 'Sustainable Aviation Fuel'], fixed: 'F08_FIXED' },
  { label: 'Maintenance Costs', cn: '维修', keys: ['Maintenance'], fixed: 'F07_FIXED' },
  { label: 'Crew Costs', cn: '机组', keys: ['Flight Crew', 'Cabin Crew'], fixed: 'F06_FIXED' },
  { label: 'Handling Costs', cn: '地面', keys: ['Aircraft Handling', 'Traffic Handling', 'Cargo Handling'] },
  { label: 'Nav and Landing Costs', cn: '起降', keys: ['Navigation', 'Landing'] },
  { label: 'Total Indirect Operating Costs', cn: '间接运营成本', keys: ['Cargo Overheads', 'General & Administration', 'Passenger Services', 'Ticketing, Sales and Promotion'] },
  { label: 'Total Ownership Costs', cn: '所有权成本', own: true },   // 折旧+保险（own）+ 湿租付款（leasePayments）
];
const shortMoney = (v) => {
  const s = v < 0 ? '-' : '', a = Math.abs(v);
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'k';
  return s + '$' + Math.round(a);
};
/** 成本分解数据：收入三分支 + 七项成本科目 + 利润（全部取自 report/detail，不新建数据模型） */
function costSummaryData(h) {
  const list = Object.values(h.detail || {});
  const csum = (k) => list.reduce((a, x) => a + ((x.cost && x.cost[k]) || 0), 0);
  const rsum = (k) => list.reduce((a, x) => a + ((x.rev && x.rev[k]) || 0), 0);
  const revs = COST_REVS.map(([k, cn]) => ({ label: k, cn, v: rsum(k) }));
  const other = (h.revenue || 0) - revs.reduce((a, r) => a + r.v, 0);
  if (other > 0.5) revs[2].v += other;   // 补贴/投资/资产收益差额并入辅营 → 左列合计＝总收入
  const first = list[0] || {};
  const groups = COSTS_GROUPS.map(gp => ({
    label: gp.label, cn: gp.cn,
    v: gp.own ? (first.own || 0) + (first.leasePayments || 0)
      : gp.keys.reduce((a, k) => a + csum(k), 0) + (gp.fixed ? (E[gp.fixed] || 0) : 0),
  }));
  const ind = groups.find(x => x.label === 'Total Indirect Operating Costs');
  if (ind) ind.v += h.invCost || 0;      // 投资项 per-pax 成本计入间接运营成本
  return { revs, groups, profit: h.operating_profit || 0 };
}
function costSummaryChart(root, h, g) {
  root.appendChild(el('div', 'small', 'COSTS SUMMARY · 成本分解'));
  if (!Object.keys(h.detail || {}).length) {
    root.appendChild(el('div', 'small', '本季尚未结算 —— 成本分解需裁判结算本季后生成。'));
    return;
  }
  const { revs, groups, profit } = costSummaryData(h);
  const revTotal = revs.reduce((a, r) => a + r.v, 0);
  const costTotal = groups.reduce((a, x) => a + x.v, 0);
  const W = 1000, H = 300, padT = 6, contentH = H - padT - 12;
  const leftX = 0, leftW = 150, midX = 420, midW = 34, rightX = 660, rightW = 100, labelX = rightX + rightW + 10;
  const gapL = 8, gapR = 5, NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%'); svg.setAttribute('max-width', '1000');
  svg.style.background = '#1b1e22'; svg.style.border = '1px solid #2b3036'; svg.style.borderRadius = '6px';
  const mk = (tag, attrs, txt) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (txt != null) e.textContent = txt;
    svg.appendChild(e); return e;
  };
  const band = (x1, ya, yb, x2, yc, yd) => mk('polygon', {
    points: `${x1},${ya} ${x2},${yc} ${x2},${yd} ${x1},${yb}`, fill: 'rgba(216,163,63,0.22)' });
  /* 高度分配：按金额比例，但每块有**最小高度**且总量归一化（避免小科目被压成一条线、
     也避免亏损季（利润为负）把成本块顶出画布） */
  const MINH = 14;
  const layout = (items, gap) => {
    const avail = contentH - gap * (items.length - 1);
    const total = items.reduce((a, x) => a + Math.max(0, x.v), 0);
    let hs = items.map(it => Math.max(MINH, total > 0 ? avail * Math.max(0, it.v) / total : avail / items.length));
    const sum = hs.reduce((a, b) => a + b, 0);
    if (sum > avail && sum > 0) { const k = avail / sum; hs = hs.map(h => h * k); }
    let y = padT; const pos = [];
    items.forEach((it, i) => { pos.push({ ...it, y, h: hs[i] }); y += hs[i] + gap; });
    return pos;
  };
  const rightRows = groups.concat([{ label: 'Profit', cn: '经营利润', v: profit }]);
  const leftPos = layout(revs, gapL);
  const rightPos = layout(rightRows, gapR);
  /* 连接带（先画，被块覆盖边缘）：左块 → Quarter 条；Quarter 条 → 右块 */
  for (const p of leftPos) band(leftW, p.y, p.y + p.h, midX, padT, padT + contentH);
  for (const p of rightPos) band(midX + midW, padT, padT + contentH, rightX, p.y, p.y + p.h);
  /* 块 */
  for (const p of leftPos) {
    mk('rect', { x: leftX, y: p.y, width: leftW, height: p.h, fill: '#d8a33f' });
    if (p.h >= 10) mk('text', { x: leftX + 6, y: p.y + 11, 'font-size': 11, fill: '#12151a' }, p.label);
    if (p.h >= 30) mk('text', { x: leftX + 6, y: p.y + 25, 'font-size': 11, fill: '#12151a' }, shortMoney(p.v));
  }
  for (const p of rightPos) {
    mk('rect', { x: rightX, y: p.y, width: rightW, height: p.h, fill: '#d8a33f' });
    const t = mk('text', { x: labelX, y: p.y + Math.min(p.h, 12) + 2, 'font-size': 11, fill: p.v < 0 ? '#f85149' : '#8a929c' },
      p.label + '  ' + shortMoney(p.v));
    const ti = mk('title', {}, p.cn + ' · ' + p.label);
    t.appendChild(ti);
  }
  /* 中间聚合条 */
  mk('rect', { x: midX, y: padT, width: midW, height: contentH, fill: '#e6edf3' });
  mk('text', { x: midX + midW + 6, y: padT + 14, 'font-size': 11, fill: '#e6edf3' }, 'Quarter');
  root.appendChild(svg);
  const closed = Math.abs(revTotal - (costTotal + profit)) <= 1;
  root.appendChild(el('div', 'small', closed
    ? `收入 ${money(revTotal)} ＝ 成本科目合计 ${money(costTotal)} ＋ 经营利润 ${money(profit)}`
    : `⚠ 成本分解未闭合：收入 ${money(revTotal)} ≠ 成本 ${money(costTotal)} ＋ 利润 ${money(profit)}`));
}
function network(root, h, g) {
  const d = h.detail || {};
  const ask = Object.values(d).reduce((a, x) => a + x.ask, 0);
  const rpk = Object.values(d).reduce((a, x) => a + x.rpk, 0);
  const pax = Object.values(d).reduce((a, x) => a + x.pax, 0);
  /* ★ 非有限值防护：ask/rpk 为 NaN 时 (NaN).toFixed() 会直接输出 "NaN" 文本 */
  const askMM = Number.isFinite(ask) ? (ask / 1e6).toFixed(1) : '—';
  const rpkMM = Number.isFinite(rpk) ? (rpk / 1e6).toFixed(1) : '—';
  const lfTxt = (Number.isFinite(ask) && ask > 0 && Number.isFinite(rpk)) ? (rpk / ask * 100).toFixed(1) + '%' : '—';
  root.appendChild(el('div', 'small', `网络 ASK ${askMM}MM ｜ RPK ${rpkMM}MM ｜ LF ${lfTxt}`));
  const rows = Object.entries(d).map(([c, x]) => [
    MARKETS[c] ? MARKETS[c].name_cn : c, num(x.freq), (x.ask / 1e6).toFixed(1), (x.rpk / 1e6).toFixed(1),
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

/* ★ 本季尚未结算时的「当前状态」数据（不依赖历史明细）
   口径：频次/座位/ASK 按当前排班现算（与结算口径同：每班座位 × 航段 × 季度班次）；盈利/成本类列需结算才有 → — */
function currentRouteRows(g) {
  const out = [];
  for (const r of (g.routes || [])) {
    const m = MARKETS[r.code] || {};
    const fl = (g.schedules || []).filter(s => s.code === r.code);
    const seatsSum = fl.reduce((a, s) => a + (s.seats || (s.ac && s.ac.seats) || 0), 0);
    const seats = fl.length ? seatsSum / fl.length : 0;   // 每班座位（同结算口径 seatsPerFlight）
    const freq = fl.length * G.DAYS_PER_QUARTER;                       // 频次/季
    const ask = seatsSum * G.DAYS_PER_QUARTER * (m.sector_km || 0);    // ASK = Σ座位×90×航段km
    out.push({ code: r.code, m, fare: r.fare, seats, freq, ask });
  }
  return out;
}
function routeEcon(root, h, g) {
  const rows = [];
  for (const [c, x] of Object.entries(h.detail || {})) {
    const m = MARKETS[c] || {};
    const yieldPerKm = m.sector_km ? x.fare / m.sector_km : 0;
    rows.push([
      m.name_cn || c, num(x.fare, 2), num(m.sector_km), yieldPerKm.toFixed(4),
      money(x.rev['Passenger Revenue']), money(x.rev['Cargo Revenue']), money(x.rev['Ancillary Revenue']),
      money(x.cost['Fuel']), money(x.cost['Maintenance']), money(x.cost['Flight Crew']),
      cabinCell(x.cabin),
      { text: money(x.operating_profit), cls: x.operating_profit >= 0 ? 'ok' : 'bad' },
    ]);
  }
  if (!rows.length) {   /* 本季未结算 → 用当前排班与运价填可算的列 */
    for (const c of currentRouteRows(g)) {
      const yieldPerKm = c.m.sector_km ? c.fare / c.m.sector_km : 0;
      rows.push([c.m.name_cn || c.code, num(c.fare, 2), num(c.m.sector_km), yieldPerKm.toFixed(4),
        '—', '—', '—', '—', '—', '—', '—', '—']);
    }
  }
  root.appendChild(table(['航线', '运价', '航段km', 'YIELD', '客运', '货邮', '辅营', '燃油', '维修', '机组', '舱位收入(经/超/公)', '经营利润'], rows));
  if (!rows.length) root.appendChild(el('div', 'small', '尚无已开通航线。'));
}

function routeMetrics(root, h, g) {
  const rows = [];
  for (const [c, x] of Object.entries(h.detail || {})) {
    const m = MARKETS[c] || {};
    const rivals = (x.rivals || []).map(r => `${r.key} ${(r.share * 100).toFixed(1)}%`).join('\r\n');
    rows.push([
      m.name_cn || c, num(x.freq), num(Math.round(x.seats || 0)),
      (x.ask / 1e6).toFixed(1), (x.rpk / 1e6).toFixed(1), pct(x.lf),
      num(Math.round(x.marketDemand || 0)), pct(x.share, 1), rivals || '—', num(x.connected_pax || 0),
    ]);
  }
  if (!rows.length) {   /* 本季未结算 → 当前排班快照（盈利类需结算） */
    for (const c of currentRouteRows(g)) {
      rows.push([c.m.name_cn || c.code, num(c.freq), num(c.seats),
        (c.ask / 1e6).toFixed(1), '—', '—', '—', '—', '—', '—']);
    }
  }
  root.appendChild(table(['航线', '频次/季', '座位', 'ASK(MM)', 'RPK(MM)', 'LF', '市场总需求', '我方份额', '对手份额', '中转'], rows));
  if (!rows.length) root.appendChild(el('div', 'small', '尚无已开通航线。'));
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
  const rows = Object.entries(d).map(([c, x]) => [MARKETS[c] ? MARKETS[c].name_cn : c, money(x.cost['Fuel']), money(x.cost['Carbon'])]);
  root.appendChild(table(['航线', '燃油', '碳'], rows));
}

const INV_CAT_CN = { airline: '航空公司', fleet: '机队', route: '航线', asset: '资产' };
function investments(root, h, g) {
  const invs = g.investments || [];
  /* ★ 11-18：① 投资项名改用目录中文名（此前显示英文 name，用户认不出自己投了什么）
     ② 每客成本 / 收益显示**议定后的生效值**（裁判议价 → 报表可审计），空值才是目录默认值 */
  const terms = (g.negotiation && g.negotiation.investTerms) || {};
  const rows = invs.map(i => {
    const def = INVESTMENTS.find(x => x.id === i.id);
    const t = terms[i.id] || {};
    const cPax = t.costPerPax != null ? t.costPerPax : (def ? (def.costPerPax || 0) : 0);
    const rPax = t.revenuePerPax != null ? t.revenuePerPax : (def ? (def.revenuePerPax || 0) : 0);
    const nm = def ? (def.name_cn || def.name) : (i.name || i.id);
    const cat = INV_CAT_CN[i.kind] || i.kind || '—';
    /* ⚠ reports.js 的 el() 用 textContent → 单元格只能是纯文本（不能塞 HTML） */
    return [nm, def ? def.name : '—', cat, money(i.amount), money(i.annual),
      cPax ? num(cPax, 2) : '—', rPax ? num(rPax, 2) : '—',
      num(i.qsi, 1), 'T' + (i.openedTurn ?? '—')];
  });
  root.appendChild(table(['投资项', '目录名（英文）', '类别', '一次性', '年费', '每客成本', '每客收益', 'QSI 效果', '开季'], rows));
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
  /* ★ 同 renderReports：页签容器复用 + 保留滚动位置（避免轮询把页签换掉导致点不动） */
  let tabs = root.querySelector(':scope > .tabs');
  let body = root.querySelector(':scope > .scroll');
  if (!tabs || !body) {
    root.innerHTML = '';
    tabs = el('div', 'tabs'); body = el('div', 'scroll');
    root.appendChild(tabs); root.appendChild(body);
  }
  const VIEWS = [['Fare Matrix', '票价矩阵'], ['Live Schedules', '实时航班表'], ['Fleet Plans', '机队计划'], ['Scheduler', '日程甘特图']];
  let active = UI.opsTab;
  const draw = () => {
    UI.opsTab = active;
    /* ★ 同上：按钮只创建一次，之后仅切换 .on 类 */
    if (tabs.children.length !== VIEWS.length) {
      tabs.innerHTML = '';
      VIEWS.forEach(([en, cn], i) => {
        const b = el('button', '', en + ' · ' + cn);
        b.onclick = () => { active = i; draw(); };
        tabs.appendChild(b);
      });
    }
    [...tabs.children].forEach((b, i) => b.classList.toggle('on', i === active));
    const keepScroll = body.scrollTop;
    body.innerHTML = '';
    const c = el('div'); body.appendChild(c);
    [fareMatrix, liveSchedules, fleetPlans, schedulerView][active](c, g);
    body.scrollTop = keepScroll;
  };
  draw();
  return { refresh: draw };
}

/* U5：席位显示名（沙盘席位名） */
const SEAT_NAME_CN = { CA: '首都航空', AB: '弹道航空', VA: '愿景航空' };   /* ★ 与 server.mjs 的席位名同口径 */
function schedulerView(root, g) { renderGantt(root, { [g.seat || 'seat']: g }); }
/**
 * 票价矩阵改「网格」形态（官方界面-3 / Role Guide p11）：行=市场、列=各航司，格内=该航司报价
 *  ★ P-12：官方票价管理会针对「枢纽机场高峰时段的航班」调整（Role Guide p.242-245）
 *    → 网格列出**分时档价**（峰/谷）。仅我方有 fareBands 配置可知，竞对仅公开基准运价（与原版信息边界一致） */
function fareMatrix(root, g) {
  const own = g.seat || 'CA';
  const pf = g.peerFares || {};
  const seats = [...new Set([own, ...Object.keys(pf)])];
  /* ★ peerFares[我方] 与 g.routes 同源同值 → 统一按公开报价取；缺我方条目时回退本组航线定价 */
  const fareOf = (seat, code) => {
    const hit = (pf[seat] || []).find(r => r.code === code);
    if (hit) return hit.fare;
    if (seat !== own) return null;
    const r = (g.routes || []).find(x => x.code === code);
    return r ? r.fare : null;
  };
  const bandOf = (code) => {
    const cfg = (g.fareBands && g.fareBands[code]) || {};
    return {
      peak: cfg.peak != null ? cfg.peak : GM.fareBandPeak,
      off: cfg.offPeak != null ? cfg.offPeak : GM.fareBandOffPeak,
    };
  };
  const head = ['市场'].concat(seats.map(s => `${s} ${SEAT_NAME_CN[s] || s}` + (s === own ? '（我方）' : '')));
  const rows = Object.keys(MARKETS).map(code => {
    const m = MARKETS[code] || {};
    const b = bandOf(code);
    const cells = seats.map(s => {
      const f = fareOf(s, code);
      if (f == null) return { text: '—', title: '该市场未开通或未报价' };
      if (s !== own) return { text: money(f), title: '竞对公开基准运价（其分时调整不公开）' };
      return {
        text: `${money(f)}　峰 ${money(f * b.peak)}　谷 ${money(f * b.off)}`,
        title: `基准 ${money(f)}；峰时 ×${b.peak}；谷时 ×${b.off}（其余时段 ×1）`,
      };
    });
    return [m.name_cn || m.name || code, ...cells];
  });
  root.appendChild(table(head, rows));
  root.appendChild(el('div', 'small',
    `口径：列为我方与各竞对航司在该市场的公开报价；「峰/谷」为我方分时运价档（默认峰 ×${GM.fareBandPeak} / 谷 ×${GM.fareBandOffPeak}，`
    + `可在「分时定价」按航线覆盖）；竞对仅公开基准运价；该市场未开通（或未报价）显示 —。`));
}

/** 实时航班表：按飞机分组 */
function liveSchedules(root, g) {
  const rows = (g.schedules || []).map(s => {
    const ac = (g.aircraft || []).find(a => a.id === s.acId) || {};
    const m = MARKETS[s.code] || {};
    const cells = [ac.nickname || ac.type || ('#' + s.acId), ac.type || '—', m.name_cn || s.code, s.departure,
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


/** 吸顶锚点条（11-17 critique P2）：页面 5000px、27 个同级标题、零导航 → 把卡片目录化
 *  集合变化才重建按钮（否则轮询会替换掉用户刚点的锚点 → 点击落空） */
export function mountJumpBar(main) {
  if (!main) return;
  let bar = main.querySelector(':scope > #jumpBar');
  if (!bar) {
    bar = el('div'); bar.id = 'jumpBar';
    /* ★ 必须显式 flex-direction:row —— main>div 的 column 规则会把锚点条竖排成一列 */
    bar.style.cssText = 'grid-column:1 / -1;position:sticky;top:58px;z-index:9;display:flex;flex-direction:row;'
      + 'flex-wrap:nowrap;align-items:center;gap:6px;overflow-x:auto;padding:8px 0;'
      + 'background:var(--bg);border-bottom:1px solid var(--hair)';
    main.insertBefore(bar, main.firstChild);
  }
  const items = [], seen = {};
  main.querySelectorAll('.card > h2').forEach(h => {
    const card = h.parentElement;
    if (!card || card.contains(bar)) return;
    const name = ((h.childNodes[0] && h.childNodes[0].nodeValue) || '').trim() || (h.textContent || '').trim();
    if (!name || seen[name]) return;
    seen[name] = 1; items.push({ name, card });
  });
  const sig = items.map(x => x.name).join('|');
  if (bar.__sig === sig) return;
  bar.__sig = sig;
  bar.innerHTML = '';
  for (const it of items) {
    const b = el('button', '', it.name);
    b.style.cssText = 'white-space:nowrap;font-size:12px;height:26px;padding:0 10px';
    b.onclick = () => it.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    bar.appendChild(b);
  }
}

/** 取某航线在指定季度的结算明细（当期 = lastDetail，历史季 = history[i].detail）
 *  ★ 明细已随 report 存入 history（game.js: g.history.push(report)）→ 无需改动引擎 */
function detailFor(g, s, seasonIdx) {
  const hist = g.history || [];
  if (seasonIdx != null && hist[seasonIdx]) {
    const d = (hist[seasonIdx].detail || {})[s.code];
    if (d) return d;
  }
  return (g.lastDetail || {})[s.code] || null;
}

/** 单航班损益分摊：航线该季科目金额 ÷ 该航线该季班次数（等分）
 *  口径说明：结算明细 detail[code] 的科目混合了「单班次值」(Fuel/维护/机组) 与「航线级值」
 *  (Landing/Navigation/地面/货运/G&A)，为避免与结算口径冲突，本表统一按**班次数等分**，
 *  保证「单班次 × 班次数 = 航线级」恒等闭合；收入同理。
 *  ★ 科目金额为当季实绩（A 类），随每季结算变化 */
function flightSplit(det) {
  if (!det) return null;
  const freq = Math.max(1, det.freq || 1);
  const k = 1 / freq;
  const cost = {};
  for (const [kk, v] of Object.entries(det.cost || {})) cost[kk] = v * k;
  const rev = {};
  for (const [kk, v] of Object.entries(det.rev || {})) rev[kk] = v * k;
  return { freq, cost, rev, det };
}

function flightPopup(g, s, d, seasonIdx) {
  const old = document.getElementById('flightPop'); if (old) old.remove();
  const ac = (g.aircraft || []).find(a => a.id === s.acId) || {};
  const m = MARKETS[s.code] || {};
  const bh = s.bh || m.bh || 0;
  const seats = s.seats || 0;
  const fare = (g.routes || []).find(r => r.code === s.code)?.fare ?? 0;
  const fuelPrice = g.fuelPrice || 2.4;
  const carbonPrice = g.carbonPrice || 0;
  const gal = E.F08_GAL(bh);
  const fuelCost = E.F08_VAR(bh, fuelPrice);
  const carbonCost = E.carbonCost(gal, carbonPrice);
  const carbonT = carbonPrice ? carbonCost / carbonPrice : 0;
  const carbonKg = carbonT * 1000;
  const galKg = gal * (GM.fuel_kg_per_gal || 3.04);
  /* ★ 季度：当期 = 最后一条历史；历史季 = 所选那一季（明细随 report 存入 history） */
  const hist = g.history || [];
  const qIdx = seasonIdx != null ? seasonIdx : hist.length - 1;
  const curH = hist[qIdx] || null;
  const det = detailFor(g, s, seasonIdx);
  let utilPct = null;
  try { const cap = G.acCapacity(g, s.acId), used = G.acUsedBH(g, s.acId); if (cap) utilPct = used / cap; } catch { /* 无机队数据 */ }
  const pax = det && det.pax != null ? Math.round(det.pax / 90) : seats;
  const lf = det && det.pax != null ? (seats ? pax / seats : null) : null;
  const unitFare = seats ? fare / seats : 0;

  const pop = el('div'); pop.id = 'flightPop';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:60';
  const box = el('div');
  box.style.cssText = 'background:#1b1e22;color:#e8eaed;border:1px solid #2b3036;border-radius:12px;max-width:920px;width:94%;padding:20px;box-shadow:0 8px 30px rgba(0,0,0,.5)';
  /* ★ 标题对齐原版：<航司名> Flight <航班号> */
  const seatName = { CA: 'Capital Airways', AB: 'Air Ballistic', VA: 'VisionAir' }[g.seat] || (g.seat || '');
  const h = el('h3', null, `FLIGHT INFORMATION · ${seatName} Flight ${s.flightNo || (ac.type || '')}`);
  h.style.cssText = 'margin:0 0 4px;font-size:14px;font-weight:600';
  box.appendChild(h);
  const sub = el('div', 'small', `${m.name_cn || s.code}（${s.code}）· 起飞 ${s.departure} · 机型 ${ac.type || '—'} · 座位 ${seats} · BH ${bh}${lf != null ? '' : ' · 未结算：旅客与客座率显示满座上限'}`);
  sub.style.marginBottom = '10px';
  box.appendChild(sub);
  /* ★ 季度切换页签（原版弹窗顶部有 Q4 2027 … Q2 2029） */
  if (hist.length) {
    const qtabs = el('div', 'tabs');
    hist.forEach((hh, i) => {
      const b = el('button', i === qIdx ? 'on' : '', hh.period || ('T' + hh.turn));
      b.style.marginRight = '6px';
      b.onclick = () => { pop.remove(); flightPopup(g, s, d, i); };
      qtabs.appendChild(b);
    });
    qtabs.style.marginBottom = '10px';
    box.appendChild(qtabs);
    if (curH) {
      const q = el('div', 'small', `本表为 ${curH.period || ('T' + curH.turn)} 结算实绩（航线科目按该季班次数平均分摊到单班次）`);
      q.style.cssText = 'margin:-4px 0 12px;color:var(--dim)';
      box.appendChild(q);
    }
  }
  const cols = el('div');
  cols.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px';
  const sect = (title) => {
    const dd = el('div');
    dd.innerHTML = '<div style="border-bottom:2px solid var(--acc);padding-bottom:4px;margin-bottom:8px;font-size:11px;color:var(--tx2);font-weight:600">' + title + '</div>';
    cols.appendChild(dd); return dd;
  };
  const kv = (parent, k, v) => {
    const r = el('div');
    r.style.cssText = 'display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px';
    const a = el('span', null, k); a.style.color = 'var(--dim)';
    const b = el('span', null, v); b.style.cssText = 'font-variant-numeric:tabular-nums;color:var(--tx)';
    r.appendChild(a); r.appendChild(b); parent.appendChild(r);
  };
  const c1 = sect('OPERATING COSTS STATEMENT');
  const sp = flightSplit(det);
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
    kv(c1, 'Passenger Revenue', money(seats * fare) + '（满座上限）');
    kv(c1, 'Cargo Revenue', '结算后可见');
    kv(c1, 'TOTAL REVENUE', money(seats * fare) + '（满座上限）');
    kv(c1, 'Fuel', money(fuelCost));
    kv(c1, 'Carbon', money(carbonCost));
    kv(c1, '其余科目', '结算后可见（航线级科目按班次数平均分摊）');
  }
  const c2 = sect('UTILISATION, FUEL & CARBON');
  kv(c2, 'Utilisation (Flight Time + Taxi Time)', num(bh, 2));
  kv(c2, '% of Aircraft Daily Utilisation', utilPct != null ? pct(utilPct, 2) : '—');
  /* ★ Strike Price 双值（原版 $2.56 ($2.73)）：括号内为**对比期油价**（该季期初 = 上季末油价）
     → 直观呈现油价波动；口径为推断，原版括号值语义未有一手说明 →【推断·待验证】 */
  const prevH = (hist[qIdx - 1] || null);
  const prevFuel = prevH ? (prevH.fuel_price_next != null ? prevH.fuel_price_next : prevH.fuel_price) : null;
  kv(c2, 'Strike Price (Market Price)', '$' + fuelPrice.toFixed(2)
     + (prevFuel != null && Math.abs(prevFuel - fuelPrice) > 0.001 ? ' ($' + prevFuel.toFixed(2) + ')' : ''));
  kv(c2, 'Fuel Used', num(gal) + ' gal / ' + num(galKg) + ' kg');
  kv(c2, 'Carbon Price (per tonne)', money(carbonPrice));
  kv(c2, 'Carbon Emissions (Flight)', num(carbonKg) + ' kg（沙盘当量口径）');
  kv(c2, 'Carbon Costs (Flight)', money(carbonCost));
  kv(c2, 'Carbon Emissions Per Passenger', pax ? num(carbonKg / pax) + ' kg' : '—');
  kv(c2, 'Carbon Price Per Passenger', pax ? '$' + (carbonCost / pax).toFixed(2) : '—');
  kv(c2, 'Carbon Take Up', '100%');
  const c3 = sect('FARE & PASSENGERS');
  kv(c3, 'Fare', money(fare));
  kv(c3, 'Weighted Fare', money(fare) + (g.routes && g.routes.some(r => r.cabinFare && (r.cabinFare.prem != null || r.cabinFare.biz != null)) ? '' : '（未设分舱位票价 → 与基准同）'));
  kv(c3, 'Unit Fare', '$' + unitFare.toFixed(3));
  kv(c3, 'Weighted Unit Fare', '$' + unitFare.toFixed(3));
  kv(c3, 'Passengers', pax + (det ? '（实绩）' : '（满座上限）'));
  kv(c3, 'Load Factor', lf != null ? pct(lf, 1) : '—（未结算）');
  kv(c3, 'Sector', num(m.sector_km) + ' km');
  box.appendChild(cols);
  const note = el('div', 'small', '注：原版 FLIGHT INFORMATION 为单航班完整损益表。沙盘的航线级科目在此按**该航线当季班次数平均分摊**到单班次（保证「单班次 × 班次数 = 航线级」恒等闭合）；顶部页签可切换历史季度。');
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
    rows.push([(h && h.period) || '', m.name_cn || c, d.freq, Math.round(d.ask), Math.round(d.rpk), Math.round(d.pax),
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
    rows.push([ac.nickname || ('#' + s.acId), ac.type || '', ac.owned ? '自有' : '租赁', m.name_cn || s.code,
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
  /* ★ 官方界面-19（V4 第 19 项）：曲线**红色部分=一天中需求如何变化**，
     **绿色部分=枢纽机场的高峰时刻**；Role Guide v3 p4：绿色时段=高峰从枢纽起飞。
     → 绿段 = 是否落在**全局**枢纽高峰时段（GM.fareBandPeakHours）：
       学员按航线覆盖的 peakHours 只影响定价、不影响画图（官方是「全枢纽一个高峰」） */
  const peakBands = (Array.isArray(opts.peakHours) ? opts.peakHours : (GM.fareBandPeakHours || []))
    .filter(b => Array.isArray(b) && b.length >= 2);
  const isPeakHour = (h) => peakBands.some(([a, b]) => h >= a && h < b);
  container.dataset.peakHours = peakBands.map(([a, b]) => a + '-' + b).join(',');
  // 汇总所有市场
  const codes = new Set();
  for (const g of Object.values(seatsOf)) {
    if (!g) continue;
    for (const r of (g.routes || [])) codes.add(r.code);
    for (const s of (g.schedules || [])) codes.add(s.code);
  }
  if (!codes.size) { container.appendChild(el('div', 'small', '暂无航线数据。')); return; }
  /* ★ 官方《界面指南 V4》界面-19 页内标题：大写标题 + 其下金色横线，市场名排在标题之下
     金色 = 页面 --acc（#d8a33f）；官方用橄榄金，暗色石墨主题下沿用同一金色 */
  const head = el('div', null, 'FLIGHTS & DEMAND CHARTS');
  head.style.cssText = 'font-family:Georgia,"Times New Roman",serif;letter-spacing:.08em;font-weight:600;margin:2px 0 3px';
  container.appendChild(head);
  const headRule = el('div');
  headRule.style.cssText = 'height:2px;width:180px;background:#d8a33f;margin:0 0 10px';
  container.appendChild(headRule);
  /* 每市场自己的日内形状 → 不同市场的红线形状不同（官方：目的地峰值 ≠ 枢纽高峰）
     回落链：opts.shapes[code] → opts.shape（旧的单形状参数，保留优先级免得静默失效）
              → MARKETS[code].dayShape → GM.dayShape → FALLBACK_SHAPE
     每级都要求「数组 + 长度 24 + 每项有限数」，不合格则跳过继续回落 */
  const shapeOf = (code) => {
    const mk = MARKETS[code] || {};
    const cands = [opts.shapes && opts.shapes[code], opts.shape, mk.dayShape, GM.dayShape];
    for (const s of cands)
      if (Array.isArray(s) && s.length === 24 && s.every(v => Number.isFinite(v))) return s;
    return null;
  };
  const seatColor = opts.seatColor || SEAT_COLOR;
  const depMinOf = (s) => { const p = String(s || '00:00').split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); };
  for (const code of codes) {
    const m = MARKETS[code] || {};
    /* ★ 官方界面-19：柱＝**每家航司每条航线的日航班数**（每条排班＝每日 1 班）
       柱高＝该班次**单日承运旅客数**（季度承运量 ÷ 90）；X 位＝该班次起飞时刻 */
    const bars = [];   // 每根柱 = 一个每日班次 {seat, depMin, seats, carried}
    let fare = 0, freq = 0;
    for (const [seat, g] of Object.entries(seatsOf)) {
      if (!g) continue;
      const r = (g.routes || []).find(x => x.code === code);
      if (r) { fare = r.fare; freq += (g.schedules || []).filter(s => s.code === code).length * 90; }
      /* 明细 flights 按起飞时刻与排班一一配对；served 是**整季**承运量 → 单日 = served ÷ 90 */
      const fl = ((((g.lastDetail || {})[code] || {}).flights) || []).slice();
      for (const s of (g.schedules || [])) {
        if (s.code !== code) continue;
        const depMin = depMinOf(s.departure);
        const i = fl.findIndex(f => f.departureMin === depMin);
        const f = i >= 0 ? fl.splice(i, 1)[0] : null;
        bars.push({ seat, depMin, seats: s.seats || 0,
                    carried: f && f.served != null ? f.served / G.DAYS_PER_QUARTER : null });
      }
    }
    // 需求曲线（红=非枢纽高峰时段，绿=枢纽高峰时段）
    /* 需求用**市场总量**（不依赖本组是否开通该航线/是否已定价）→ 图始终有意义 */
    const FALLBACK_SHAPE = [0.35,0.3,0.28,0.28,0.35,0.55,0.8,0.95,1.0,0.95,0.85,0.7,
                            0.6,0.65,0.75,0.85,0.9,1.0,0.95,0.9,0.8,0.7,0.55,0.4];
    let daily = 0;
    if (E && m.name) {
      try { daily = E.demand(m.name, m.guide_fare || 200, Math.max(freq, 180), 1) / 90; } catch { daily = 0; }
    }
    if (!daily && m.cargo_demand) daily = 40;   // 兜底，保证图形不空白
    /* ★ 15 分钟粒度（原版：一天按每 15 分钟一个时刻划分）→ 72 个刻度点 6:00–23:45
       曲线值按**日形状线性插值**（日形状为 24 个整点） */
    const HOURS = [];
    for (let h = 6; h <= 23; h++) for (let q = 0; q < 4; q++) HOURS.push(h + q / 4);
    const sh = shapeOf(code);
    const shapeAt = (hf) => {
      const i0 = Math.floor(hf), i1 = Math.min(23, i0 + 1), f = hf - i0;
      const s0 = (sh && sh[i0] != null) ? sh[i0] : FALLBACK_SHAPE[i0];
      const s1 = (sh && sh[i1] != null) ? sh[i1] : FALLBACK_SHAPE[i1];
      return s0 + (s1 - s0) * f;
    };
    const hhmm = (hf) => String(Math.floor(hf)).padStart(2, '0') + ':' + String(Math.round((hf % 1) * 60)).padStart(2, '0');
    /* ★ 需求是**一条固定曲线**（原版：具体需求基本是固定值，不随排班/定价变化）
       着色按**枢纽高峰时段**分段：峰时段内 = 绿，其余 = 红（官方界面-19） */
    const curve = HOURS.map(h => daily * shapeAt(h));
    /* ★ 官方界面-19：需求曲线**按枢纽高峰时段双色分段**（峰时段内的点 = 绿，其余 = 红），
       绿段严格只含峰时段点；实际载量另画一条中性灰单线，与双色需求线区分开 */
    /* ★ 实际载量统一为**单日**口径（季度承运 ÷ 90），与柱/标题/需求线同量纲；
       按 15 分钟槽位归集（与曲线网格同源），起飞时刻即落点 */
    const loadByQ = {};
    for (const [, gg] of Object.entries(seatsOf)) {
      const dd = gg && gg.lastDetail && gg.lastDetail[code];
      for (const f of ((dd && dd.flights) || [])) {
        const q = Math.round(((f.departureMin || 0) - 360) / 15);
        if (q < 0 || q >= 72) continue;
        loadByQ[q] = (loadByQ[q] || 0) + (f.served || 0) / G.DAYS_PER_QUARTER;
      }
    }
    /* ★ 官方界面-19：分段依据 = 是否落在**枢纽高峰时段**（绿），其余（红）——不再是涨跌 */
    const colorOf = (i) => (isPeakHour(Math.floor(HOURS[i])) ? '#2da44e' : '#cf222e');
    // 把同色连续点合成一段
    const runs = [];
    for (let i = 0; i < curve.length; i++) {
      const c = colorOf(i), last = runs[runs.length - 1];
      if (last && last.color === c) last.pts.push(i);
      else runs.push({ color: c, pts: [i] });
    }
    /* 红段向相邻绿段借一个端点 → 曲线不断线；绿段因此**只含峰时段点** */
    const segs = runs.map((r, k) => {
      const prev = runs[k - 1], next = runs[k + 1];
      const pts = r.pts.slice();
      if (r.color === '#cf222e') {
        if (prev && prev.color === '#2da44e') pts.unshift(prev.pts[prev.pts.length - 1]);
        if (next && next.color === '#2da44e') pts.push(next.pts[0]);
      }
      return { color: r.color, pts };
    });
    const lo = null;   // 不再有第二条线
    const maxBar = Math.max(1, ...bars.map(b => b.carried || 0));
    const maxLine = Math.max(1, ...curve);
    /* ★ 官方界面-19：Y 轴主刻度步长 20，值域向上取整到 20 的倍数（刻度与曲线峰值一致） */
    const Y_STEP = 20;
    const yMax = Math.max(Y_STEP, Math.ceil(Math.max(maxBar, maxLine) / Y_STEP) * Y_STEP);
    const W = 620, H = 200, PL = 46, PR = 10, PB = 52, PT = 12;
    /* X 映射：h∈[6,24) 铺满绘图区 → 23:45 落在右边界内（旧实现 X(23.75)≈639 越界被裁） */
    const X = h => PL + 6 + (h - 6) * (W - PL - PR - 12) / 18;
    const Y = v => H - PB - (Number.isFinite(v) ? v : 0) / yMax * (H - PB - PT);
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    const box = el('div'); box.style.marginBottom = '14px';
    /* 标题：官方格式（每日承运总量） */
    const carried = Math.round(bars.reduce((a, b) => a + (b.carried || 0), 0));
    box.appendChild(el('div', null, m.name_cn || m.name || code));
    box.appendChild(el('div', 'small', `Flight Capacity and Actual Loads - (${carried} passengers carried)`));
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', 'max-width': '640' });
    svg.style.background = '#1b1e22'; svg.style.border = '1px solid #2b3036'; svg.style.borderRadius = '6px';
    // 网格与 Y 轴刻度：主网格每 20（较亮）+ 次网格每 10（较暗），刻度文字取整
    const majors = [];
    for (let v = 0; v <= yMax; v += Y_STEP) majors.push(v);
    /* 刻度过密时隔一个标数字（网格仍每 20 一条），顶部刻度必标 → 高需求市场也不糊成一团 */
    const labelStep = Math.max(1, Math.ceil(majors.length * 11 / (H - PB - PT)));
    const labeled = majors.filter((v, i) => i % labelStep === 0);
    if (labeled[labeled.length - 1] !== majors[majors.length - 1]) labeled[labeled.length - 1] = majors[majors.length - 1];
    for (let v = 0; v <= yMax; v += 10) {
      const main = v % Y_STEP === 0, y = Y(v);
      svg.appendChild(mk('line', { x1: PL, y1: y, x2: W - PR, y2: y, stroke: main ? '#333a42' : '#24282e' }));
    }
    for (const v of labeled) {
      const tx = mk('text', { x: PL - 6, y: Y(v) + 4, 'font-size': 10, fill: '#8a929c', 'text-anchor': 'end' });
      tx.textContent = String(v); svg.appendChild(tx);
    }
    /* 峰时段底纹：让「枢纽高峰窗口」一眼可见（画在网格之上、曲线之下） */
    for (const [a, b] of peakBands) {
      const x0 = Math.max(PL, X(a)), x1 = X(Math.min(b, 23.75));
      svg.appendChild(mk('rect', { x: x0, y: PT, width: Math.max(1, x1 - x0), height: H - PB - PT,
        fill: '#8a929c', opacity: 0.10 }));
    }
    /* 需求曲线：**按枢纽高峰时段双色分段**（红=非峰时段，绿=峰时段） */
    for (const sgm of segs) {
      const pts = sgm.pts.map(i => `${X(HOURS[i])},${Y(curve[i])}`);
      svg.appendChild(mk('polyline', { points: pts.join(' '), fill: 'none', stroke: sgm.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
    }
    // 实际载量曲线：中性灰单线（避免与需求双色混淆）
    svg.appendChild(mk('polyline', { points: HOURS.map((h, i) => `${X(h)},${Y(loadByQ[i] || 0)}`).join(' '), fill: 'none', stroke: '#8a929c', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
    // 折线点（悬停显示该时刻需求值、实际载量与趋势）
    HOURS.forEach((h, i) => {
      const d = i > 0 ? curve[i] - curve[i - 1] : 0;
      const tag = i === 0 ? '起点' : (d > 0.0001 ? '上升' : d < -0.0001 ? '下降' : '持平');
      const c = mk('circle', { cx: X(h), cy: Y(curve[i]), r: 2.6, fill: colorOf(i) });
      const ti = mk('title', {});
      ti.textContent = `${hhmm(h)}　需求 ${Math.round(curve[i])} 人/日　实际载量 ${Math.round(loadByQ[i] || 0)} 人/日　趋势：${tag}`;
      c.appendChild(ti);
      svg.appendChild(c);
    });
    // 班次柱：每根柱 = 一个每日班次（柱高＝单日承运，X 位＝起飞时刻，颜色＝航司）
    const colIdx = {};
    for (const b of bars) {
      const k = colIdx[b.depMin] = (colIdx[b.depMin] || 0);   /* 同时刻多班横向错开 */
      colIdx[b.depMin] = k + 1;
      const bx = X(b.depMin / 60) - 1.5 + k * 3;   // 柱心对齐起飞时刻刻度
      const has = b.carried != null;
      const r = mk('rect', { x: bx, y: Y(b.carried || 0), width: 3,
        height: has ? Math.max(1, H - PB - Y(b.carried)) : 2,
        fill: has ? (seatColor[b.seat] || '#888') : '#4a5058', opacity: has ? 0.85 : 0.7 });
      const ti = mk('title', {});
      ti.textContent = has
        ? `${hhmm(b.depMin / 60)}　${b.seat}　座位 ${b.seats}　单日承运 ${b.carried.toFixed(1)} 人　LF ${(b.carried / (b.seats || 1) * 100).toFixed(1)}%`
        : `${hhmm(b.depMin / 60)}　${b.seat}　座位 ${b.seats}　暂无承运数据`;
      r.appendChild(ti);
      svg.appendChild(r);
    }
    // X 轴标签：06:00–23:00 逐时（官方），旋转 -40° 避让
    for (let h = 6; h <= 23; h++) {
      const x = X(h), ty = H - 30;
      const tx = mk('text', { x, y: ty, 'font-size': 9, fill: '#8a929c', 'text-anchor': 'middle',
                              transform: `rotate(-40 ${x} ${ty})` });
      tx.textContent = String(h).padStart(2, '0') + ':00'; svg.appendChild(tx);
    }
    const xl = mk('text', { x: (PL + W - PR) / 2, y: H - 6, 'font-size': 10, fill: '#8a929c', 'text-anchor': 'middle' });
    xl.textContent = 'Departure Time'; svg.appendChild(xl);
    const yl = mk('text', { x: 12, y: (PT + H - PB) / 2, 'font-size': 10, fill: '#8a929c', 'text-anchor': 'middle',
                             transform: `rotate(-90 12 ${(PT + H - PB) / 2})` });
    yl.textContent = 'Capacity and actual loads'; svg.appendChild(yl);
    box.appendChild(svg);
    if (!bars.length || !daily) {
      const tip = el('div', 'small');
      tip.textContent = !daily
        ? '暂无需求数据（需先开通航线并设定运价；完成一个回合后可见需求高低曲线）'
        : '暂无班次柱（尚未排班）';
      box.appendChild(tip);
    }
    // 图例
    const lg = el('div', 'small');
    for (const [seat, col] of Object.entries(seatColor)) { const sp = el('span', null, '■ ' + seat + ' 班次　'); sp.style.color = col; lg.appendChild(sp); }
    const r1 = el('span', null, '— 需求曲线：红=非枢纽高峰时段，绿=枢纽高峰时段　'); r1.style.color = '#cf222e'; lg.appendChild(r1);
    const r2 = el('span', null, '— 底纹＝枢纽高峰时段（峰时运价默认 ×' + (GM.fareBandPeak != null ? GM.fareBandPeak : 1) + '，可按航线调整）　'); r2.style.color = '#8a929c'; lg.appendChild(r2);
    const r3 = el('span', null, '— 柱＝各航司日班次（柱高=单日承运）　灰线＝实际载量（单日）'); r3.style.color = '#8a929c'; lg.appendChild(r3);
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
/* ★ 甘特图选中态：**模块级字符串键**（跨重绘存活；用 DOM 引用会在 innerHTML='' 后失效） */
let _ganttSel = null;
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
  const T0 = 7 * 60, T1 = 24 * 60, TOTAL = T1 - T0;
  const W = 1000, LEFT = 150, ROWH = 34, TOP = 26;
  const H = TOP + rows.length * ROWH + 26;
  const cellW = (W - LEFT - 10) / (TOTAL / 60);
  /* ★ 起点前移到 07:00 → 早于 T0 起飞的航班不得画到坐标轴左侧，夹取到窗口内 */
  const X = (min) => LEFT + (Math.max(T0, Math.min(T1 - 1, min)) - T0) / 60 * cellW;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const toMin = (s) => { const [h2, m2] = String(s || '00:00').split(':').map(Number); return (h2 || 0) * 60 + (m2 || 0); };
  const fmtMin = (v) => String(Math.floor((((v % 1440) + 1440) % 1440) / 60)).padStart(2, '0') + ':' + String(Math.round(v % 60)).padStart(2, '0');
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', 'max-width': '1020' });
  svg.style.background = '#1b1e22'; svg.style.border = '1px solid #2b3036'; svg.style.borderRadius = '6px';
  // 时间刻度
  for (let h = 7; h <= 23; h++) {
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
      /* 同一航班的去程/回程块共用一个键 → 选中时两块一起描黑 */
      const key = `${r.seat}|${s.acId}|${s.code}|${s.departure}`;
      const mkBlk = (x0, x1, y0, h, fill0, op) => {
        const fill = seatFill || fill0;
        const on = _ganttSel === key;
        const rc = mk('rect', { x: x0, y: y0, width: Math.max(6, (x1 - x0) / 60 * cellW), height: h, fill: fill, opacity: op,
          stroke: on ? '#111111' : '#6b7480', 'stroke-width': on ? 2 : 0.6, rx: 2 });
        svg.appendChild(rc);
        rc.style.cursor = 'pointer';
        rc.addEventListener('click', () => { _ganttSel = (_ganttSel === key ? null : key); renderGantt(container, games, opts); });
        return rc;
      };
      const xOut = X(dep);          // 起点（学员填写）
      const xArr = X(arrMin);        // 到达（廊桥）
      const xRetDep = X(retDepMin);      // 回程起飞
      const xRetArr = X(retArrMin);    // 回程到达
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
        tx.textContent = (mkInfo && (mkInfo.name || mkInfo.name_cn)) || s.code;
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
