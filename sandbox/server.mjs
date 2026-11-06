/* ============================================================
   SkyChess 沙盘 —— 服务端（多席位独立状态 + 教师/裁判面板）
   ------------------------------------------------------------
   席位: CA / AB / VA 各自独立游戏状态，互不干扰
   裁判: 统一设定油价/碳价/利率、触发事件、开放市场、推进回合
   ============================================================ */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './game.js';
import * as E from './engine.js';
import * as D from './data.js';
import { SCENARIOS, getScenario } from './scenarios.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8765);

const BASE_SEATS = ['CA', 'AB', 'VA'];
/* ── 席位授权 ──────────────────────────────────────────────────
   课堂多组共用同一服务端时必须保证：
     · 小组只能操作自己的席位
     · 裁判面板需要教师密钥
   密钥首次启动生成并持久化到 .sandbox-keys.json，重启不变；
   可用环境变量 SANDBOX_TEACHER_KEY 覆盖教师密钥。
   ───────────────────────────────────────────────────────────── */
const KEY_FILE = process.env.SANDBOX_KEY_FILE || join(HERE, '.sandbox-keys.json');

function loadKeys() {
  try {
    const raw = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
    if (raw && raw.seats && raw.teacher) return raw;
  } catch { /* 首次运行 */ }
  const rnd = () => Math.random().toString(36).slice(2, 10);
  const keys = { seats: {}, teacher: process.env.SANDBOX_TEACHER_KEY || rnd() + rnd() };
  for (const s of ['CA', 'AB', 'VA']) keys.seats[s] = rnd() + rnd();
  try { writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2)); } catch { /* 只读目录则仅内存保存 */ }
  return keys;
}
const KEYS = loadKeys();

const SEATS = {
  CA: { code: 'CA', name: 'Capital Airways', name_cn: '首都航空', color: '#dfbf0c' },
  AB: { code: 'AB', name: 'Air Ballistic', name_cn: '弹道航空', color: '#0270b6' },
  VA: { code: 'VA', name: 'VisionAir', name_cn: '愿景航空', color: '#3d0f7b' },
};

/* ── 状态 ── */
const sessions = new Map();          // seat -> game
const gm = {
  turn: 0,
  // 碳价语义：$ / 吨（对齐原版 CARBON 块：Q4/2027 = $2,577/t）
  fuelPrice: 2.40, carbonPrice: D.CARBON.base_price_per_tonne, interestRate: 5.0,
  connectingDemand: 2,
  /* ── 分季规则开启表：裁判可覆盖开启回合（教学节奏可调）── */
  ruleOverrides: {},                // { ruleKey: turn }
  /* ── 燃油套保窗口：裁判有单方决定权 ──
     真实机制（执行过程报告 §5.1）：Q3 末裁判以「当季油价极高」为由**不提供套保**，
     建议下一窗口为 Q5 为 Q6 锁价。
     本开关只影响**新签**；已签套保按原约定继续到期。 */
  hedgeWindowOpen: true,

  openMarkets: ['SIM', 'LEW', 'ETN', 'FTZ', 'ARM', 'GEE', 'PKR', 'JOP', 'CHA', 'BZY'],
  events: [],                       // 事件历史
  log: [],
  /* ── 裁判谈判工作台 ── */
  negotiationLog: [],                // 谈判记录 {seq, turn, seat, item, value, note, at}
  intelPrice: {},                   // 各组的情报报价 {seat: {code: price}}
  seq: 0,
};

/** 记录一条谈判条款 */
function negLog(gm, seat, item, value, note) {
  gm.seq = (gm.seq || 0) + 1;
  const rec = {
    seq: gm.seq, turn: gm.turn, seat: seat || '*', item,
    value: typeof value === 'object' ? JSON.stringify(value) : value,
    note: note || '', at: new Date().toISOString(),
  };
  gm.negotiationLog.push(rec);
  gm.log.push(`【谈判 #${rec.seq}】${rec.seat} · ${item} = ${rec.value}${note ? ' · ' + note : ''}`);
  return rec;
}

/** 可谈判条款清单（裁判端工作台的目录） */
const NEGOTIABLE = {
  fuelPrice:      { label: '燃油价（定向）',        type: 'num',  min: 0.5, max: 8,  step: 0.05 },
  carbonPrice:    { label: '碳价（定向）',          type: 'num',  min: 0,   max: 200, step: 1 },
  interestRate:   { label: '利率（定向）',          type: 'num',  min: 0,   max: 20,  step: 0.25 },
  connectingDemand:{label: '中转强度 L（定向）',    type: 'int',  min: 0,   max: 3,   step: 1 },
  insuranceRate:  { label: '保险费率 %（定向）',    type: 'num',  min: 0,   max: 3,   step: 0.05 },
  subsidy:        { label: '航线补贴（每回合）',    type: 'perMarket' },
  fareDiscount:   { label: '费用/运价折扣',        type: 'perMarket' },
  marketFuel:     { label: '市场级油价',           type: 'perMarket' },
  marketDemand:   { label: '市场级需求倍数',       type: 'perMarket' },
  fuelHedge:      { label: '燃油套保（两档固定方案）', type: 'hedge' },
  buyback:        { label: '飞机回购报价',         type: 'perAc' },
  turnaroundMin:  { label: '短程过站时间（分钟，15 的倍数）', type: 'num', min: 30, max: 60, step: 15 },
  leaseType:      { label: '租赁方式（dry/wet）', type: 'leaseType' },
  leaseDiscount:  { label: '租赁折扣（0~1，如 0.20）', type: 'num', min: 0, max: 0.6, step: 0.05 },
  heavyCheck:     { label: '飞机大修（半 BH 限制 + 出售溢价）', type: 'heavyCheck' },
  investTerms:    { label: '投资项议价（成本/收益 每旅客）', type: 'invest' },
};

/* ─────────── U2 谈判申报单状态机 ───────────
   draft → submitted → under_review → countered → agreed/effective
                                        └→ rejected
   withdrawn：小组在 submitted / countered 阶段可撤回 */
const NEG_STATES = ['draft', 'submitted', 'under_review', 'countered', 'agreed', 'effective', 'rejected', 'withdrawn'];
const NEG_LABEL = { draft: '草稿', submitted: '已提交', under_review: '裁判受理', countered: '待小组确认还价',
                    agreed: '已达成', effective: '已生效', rejected: '已驳回', withdrawn: '已撤回' };

/** 把一组条款写入某席位的生效谈判（复用 negotiate 的写入语义） */
function applyNegItems(seat, items, note) {
  let n = 0;
  for (const [item, payload] of Object.entries(items || {})) {
    if (!NEGOTIABLE[item]) continue;
    const a = (payload && typeof payload === 'object') ? { ...payload } : { value: payload };
    a.type = 'negotiate'; a.seat = seat; a.item = item;
    if (note) a.note = note;
    const r = applyGMAction(a);
    if (r !== 'unknown action') n++;
  }
  return n;
}

function newSession(seat) {
  const g = G.newGame(20261021 + seat.charCodeAt(0));
  g.seat = seat;
  // 各席位起始差异（模拟真实三家的商业模式）
  /* ★ 三家经营定位（课程裁定）：CA=LCC 低成本型 · AB=FSC 全服务型 · VA=Hybrid 混合型
     初始 QSI 与定位匹配：全服务靠服务与品牌溢价、低成本靠高效率与密度 */
  g.style = D.GM.styles?.[seat] || 'Hybrid';
  if (seat === 'AB') { g.qsi = 6.2; g.cash = 3200000; }     // FSC：品牌与舱位溢价
  if (seat === 'VA') { g.qsi = 5.0; g.cash = 3600000; }     // Hybrid：居中
  /* 原版 Q4/2027（首季）格局：**3 条独飞航线 + 1 条三家共享**
       · Simone     独飞 → Capital Airways（Route Share 100%）
       · Fitzgerald 独飞 → VisionAir（VA 复盘：ETN + FTZ 各 4 班/日）
       · Parker     独飞 → Air Ballistic
       · Ellington  三家共享（CA 360 班/季、份额 48.40%）
     → 初始航线：CA{SIM,ETN}、AB{PKR,ETN}、VA{FTZ,ETN} */
  const swapRoute = (from, to) => {
    g.routes = g.routes.filter(r => r.code !== from);
    g.routes.push({ code: to, fare: D.MARKETS[to].guide_fare || 200, openedTurn: 0, etopsPaid: false });
  };
  if (seat === 'AB') swapRoute('SIM', 'PKR');
  if (seat === 'VA') swapRoute('SIM', 'FTZ');
  return g;
}
for (const s of Object.keys(SEATS)) sessions.set(s, newSession(s));

function applyGM(g) {
  g.fuelPrice = gm.fuelPrice;
  g.carbonPrice = gm.carbonPrice;
  g.carbon_price = gm.carbonPrice;
  g.interestRate = gm.interestRate;
  g.connectingDemand = gm.connectingDemand;
  g.ruleOverrides = { ...gm.ruleOverrides };   // 裁判覆盖的规则开启回合
  g.hedgeWindowOpen = gm.hedgeWindowOpen;      // 套保窗口
  return g;
}

/* ── HTTP ── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

/* ── 赛季到点自动结算（每 5 秒检查一次） ── */
setInterval(() => {
  const now = Date.now();
  for (const [code, g] of sessions) {
    if (!g.turnDeadline || now < g.turnDeadline) continue;
    if (g.submittedTurn === g.turn) { g.turnDeadline = null; continue; }
    const r = applyAction(g, { type: 'advance' });
    g.turnDeadline = null; g.turnStartedAt = null;
    gm.log.push(`${code} 本季到时自动结算（${r}）`);
    if (r !== 'ok' && r !== 'no flights scheduled')
      gm.log.push(`★ ${code} 自动结算未完成：${r}（需裁判用「提前结算」兜底）`);
  }
}, 5000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    /* ---------- API ---------- */
    if (p.startsWith('/api/')) {
      const seg = p.split('/').filter(Boolean);   // api, ...
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      if (seg[1] === 'seat' && seg[2]) {
        // ★ 席位授权：只允许持本席位密钥的客户端读写
        if (seg[2] !== 'keys' && KEYS.seats[seg[2]]) {
          // 已存在的席位：必须持本席位密钥
          const want = KEYS.seats[seg[2]];
          const got = seatKeyOf(req, url);
          // 席位密钥 或 教师密钥（教师需能查看各组状态）
          if (got !== want && got !== KEYS.teacher) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ error: 'invalid seat key', seat: seg[2] }));
          }
        }
        let g = sessions.get(seg[2]);
        if (!g) {
          const code = seg[2].toUpperCase().slice(0, 3);
          if (!/^[A-Z][A-Z0-9]{1,2}$/.test(code)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad seat code' })); }
          // ★ 席位必须由**裁判端显式创建**（GM 动作 createSeat）并登记密钥；
          //   任何未登记的代码一律拒绝 → 防止任意访问者凭空造组、抢占组号
          if (!KEYS.seats[code]) {
            res.statusCode = 403;
            return res.end(JSON.stringify({ error: 'seat not registered', seat: code }));
          }
          if (!SEATS[code]) {   // 重启后从持久化元数据恢复
            const meta = (KEYS.seatMeta || {})[code];
            SEATS[code] = meta || { code, name: 'Team ' + code, name_cn: '小组 ' + code, color: '#666' };
          }
          g = newSession(code);
          sessions.set(code, g);
          gm.log.push(`席位 ${code} 会话重建`);
        }
        if (req.method === 'GET') {
          return res.end(JSON.stringify({
            seat: seg[2], meta: SEATS[seg[2]], gm, game: serialize(g),
          }));
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          const r = applyAction(g, body);
          return res.end(JSON.stringify({ ok: true, result: r, game: serialize(g) }));
        }
      }

      if (seg[1] === 'gm') {
        // ★ 教师授权：裁判面板操作必须持教师密钥
        if (!isTeacher(req, url)) {
          res.statusCode = 401;
          return res.end(JSON.stringify({ error: 'teacher key required' }));
        }
        if (req.method === 'GET') {
          // 各组当前生效的谈判条款摘要（裁判端一览）
          const terms = {};
          for (const [code, g] of sessions) {
            const n = g.negotiation || {};
            const parts = [];
            if (n.fuelPrice != null) parts.push(`油${n.fuelPrice}`);
            if (n.carbonPrice != null) parts.push(`碳${n.carbonPrice}`);
            if (n.interestRate != null) parts.push(`息${n.interestRate}%`);
            if (n.connectingDemand != null) parts.push(`中转L${n.connectingDemand}`);
            if (n.insuranceRate != null) parts.push(`保险${n.insuranceRate}%`);
            for (const h of (n.fuelHedge || [])) parts.push(`套保${h.price}×${h.share}(${h.quarters}季)`);
            for (const [k, v] of Object.entries(n.subsidies || {})) if (v) parts.push(`${k}补贴${v}`);
            for (const [k, v] of Object.entries(n.fareDiscount || {})) if (v && v !== 1) parts.push(`${k}折扣${v}`);
            for (const [k, v] of Object.entries(n.marketParams || {})) parts.push(`${k}:${JSON.stringify(v)}`);
            for (const [k, v] of Object.entries(n.buyback || {})) if (v) parts.push(`机${k}回购${v}`);
            const intel = Object.keys(n.intel || {});
            if (intel.length) parts.push(`情报[${intel.join(',')}]`);
            if (parts.length) terms[code] = parts.join(' · ');
          }
          const timer = Object.fromEntries([...sessions.entries()].map(([c, g]) => [c, {
            submitted: g.submittedTurn === g.turn,
            deadline: g.turnDeadline || null,
            remaining: g.turnDeadline ? Math.max(0, Math.round((g.turnDeadline - Date.now()) / 1000)) : null,
          }]));
          return res.end(JSON.stringify({ gm, terms, seats: Object.keys(SEATS), roster: Object.values(SEATS),
            timer, roundSeconds: gm.roundSeconds || D.GM.round_seconds || 3600 }));
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          const r = applyGMAction(body);
          return res.end(JSON.stringify({ ok: true, result: r, gm }));
        }
      }

      if (seg[1] === 'keys' && req.method === 'GET') {
        // 教师用：凭教师密钥取各席位密钥
        if (!isTeacher(req, url)) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'teacher key required' })); }
        return res.end(JSON.stringify({ teacher: KEYS.teacher, seats: KEYS.seats }));
      }
      if (seg[1] === 'reset' && req.method === 'POST') {
        // 仅保留基础席位（CA/AB/VA），清空动态新建的席位
        // ⚠ sessions 是 Map —— Object.keys(map) 返回 []，删除循环永远不会执行
        for (const s of [...sessions.keys()]) if (!BASE_SEATS.includes(s)) { sessions.delete(s); delete SEATS[s]; }
        for (const s of BASE_SEATS) sessions.set(s, newSession(s));
        gm.turn = 0; gm.fuelPrice = 2.40; gm.carbonPrice = 22; gm.interestRate = 5;
        gm.events = []; gm.log = [];
        return res.end(JSON.stringify({ ok: true }));
      }
      res.statusCode = 404; return res.end(JSON.stringify({ error: 'not found' }));
    }

    /* ---------- 静态 ---------- */
    let file = p === '/' ? '/index.html' : p;
    if (file === '/player.html') file = '/player.html';
    if (file === '/teacher.html') file = '/teacher.html';
    const buf = await readFile(join(HERE, file));
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.end(buf);
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e && e.message));
  }
});

/** 从请求取密钥：优先 header，其次 query */
function seatKeyOf(req, url) {
  return req.headers['x-sandbox-key'] || url.searchParams.get('key') || '';
}
/** 教师密钥校验 */
function isTeacher(req, url) {
  return seatKeyOf(req, url) === KEYS.teacher;
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

function serialize(g) {
  return {
    turn: g.turn, maxTurns: g.maxTurns, cash: g.cash, qsi: g.qsi,
    fuelPrice: g.fuelPrice, carbonPrice: g.carbonPrice, interestRate: g.interestRate,
    connectingDemand: g.connectingDemand,
    period: G.currentPeriod(g),
    aircraft: g.aircraft, routes: g.routes, schedules: g.schedules,
    investments: g.investments, investmentsAnnual: g.investmentsAnnual,
    assets: g.assets, demandMult: g.demandMult, utilCap: g.utilCap,
    log: g.log, history: g.history, lastDetail: g.lastDetail || {},
    negotiation: g.negotiation || {},
    proposals: g.proposals || [],
    proposalKinds: Object.fromEntries(Object.entries(G.PROPOSAL_KINDS).map(([k, v]) => [k, v.label])),
    marketParams: g.marketParams || {},
    intelPrices: gm.intelPrice?.[g.seat] || {},
    intel: Object.fromEntries(Object.entries(g.negotiation?.intel || {})),
    effParams: G.effParams(g),
    effFuelPrice: G.effFuelPrice(g),
    subsidy: G.effSubsidy(g),
    lastConnByRoute: g.lastConnByRoute || {},
    /* ── 分季规则：当前开启状态 + 计划（教学节奏）── */
    rules: G.ruleStatus(g),
    /* 航线释放与开线申请（洽谈流程）*/
    routeRequests: g.routeRequests || [],
    rejects: g.rejects || [],            // ★ 最近被拒操作及原因（教学反馈闭环）
    seat: g.seat,                    // ★ 席位标识（前端/测试读取）
    routeFlags: g.routeFlags || {},   // ★ 联程设置（可作中转点 / 提供联程）
    bankrupt: !!g.bankrupt,           // ★ 破产状态
    bankruptTurn: g.bankruptTurn != null ? g.bankruptTurn : null,
    cargoPolicy: (gm && gm.cargoPolicy) || {},   // ★ 裁判载货开关（开放/关闭载货）
    negRequests: g.negRequests || [], // ★ 谈判申报单（含状态机与流转历史）
    negStates: NEG_STATES, negLabels: NEG_LABEL,
    messages: gm.messages || [],        // ★ U18 消息板（裁判发布 → 小组可见）
    targets: gm.targets || {},          // ★ 考核目标（裁判第 3 季起设定）
    seatStyles: Object.fromEntries([...sessions.entries()].map(([c, g2]) => [c, g2.style || 'Hybrid'])),
    hacked: g.hacked || null,           // ★ 被网络攻击状态（面板遮罩 → 无法操作）
    targetTurn: 2,                     // 考核目标开放回合（Q3）
    roundSeconds: gm.roundSeconds || D.GM.round_seconds || 3600,   // ★ 本季限时（秒）
    roundStartedAt: gm.roundStartedAt || null,
    seatTimer: { [g.seat]: { submitted: g.submittedTurn === g.turn, deadline: g.turnDeadline || null,
      remaining: g.turnDeadline ? Math.max(0, Math.round((g.turnDeadline - Date.now()) / 1000)) : null } },
    seats: Object.fromEntries([...sessions.entries()].map(([c, g]) => [c, {
      submitted: g.submittedTurn === g.turn,
      deadline: g.turnDeadline || null,
      startedAt: g.turnStartedAt || null,
      remaining: g.turnDeadline ? Math.max(0, Math.round((g.turnDeadline - Date.now()) / 1000)) : null,
    }])),
    negCatalog: Object.fromEntries(Object.entries(NEGOTIABLE).map(([k, v]) => [k, { label: v.label, type: v.type }])),
    style: g.style,                  // ★ 经营定位（LCC / FSC / Hybrid）
    hedgeQuotes: gm.hedgeQuotes || D.HEDGE_QUOTES,   // ★ 三方套保报价（裁判设定）
    hedgeScenarios: D.HEDGE_SCENARIOS,               // ★ 比价情景（统一可比口径）
    competitors: g.competitors || [],        // ★ 前端 allocateMarkets 依赖（缺失会抛错中断渲染）
    groundUntil: g.groundUntil || {},        // ★ 同上
    demandMult: g.demandMult || {},
    qsi: g.qsi,
    fareBands: g.fareBands || {},          // 分时定价（峰加价 / 谷折扣，按航线）
    fareBandDefaults: { peak: D.GM.fareBandPeak, offPeak: D.GM.fareBandOffPeak,
                        peakHours: D.GM.fareBandPeakHours, offPeakHours: D.GM.fareBandOffPeakHours },
    releasedRoutes: G.releasedRoutes(g),
    newlyReleasedRoutes: G.newlyReleasedRoutes(g),
    /* ── 贷款台账（12 年等额本金 + 季息）── */
    loans: (g.loans || []).map(l => ({
      id: l.id, principal: l.principal, balance: l.balance, rate: l.rate,
      quartersLeft: l.quartersLeft, quarterlyPrincipal: l.quarterlyPrincipal,
      quarterlyInterest: l.quarterlyInterest, quarterlyRepay: l.quarterlyRepay,
    })),
    cashFloor: D.LOAN.cash_floor,
  };
}

/* ── 玩家动作 ── */
/* ★ 操作被拒留痕：小组排班/投资被拒时记录原因，供小组端显示与 Agent 下一轮自我修正 */
function applyAction(g, a) {
  const r = applyActionRaw(g, a);
  if (typeof r === 'string' && r !== 'ok' && !r.startsWith('ok') && r !== 'unknown action') {
    g.rejects = g.rejects || [];
    g.rejects.unshift({ type: a.type, why: r, turn: g.turn, at: Date.now() });
    g.rejects = g.rejects.slice(0, 12);
    g.log.push(`操作被拒：${a.type} → ${r}`);
  }
  return r;
}
function applyActionRaw(g, a) {
  switch (a.type) {
    case 'setFareBands': {
      const code = String(a.code || '');
      if (!g.routes.some(r => r.code === code)) return 'route not opened';
      g.fareBands = g.fareBands || {};
      g.fareBands[code] = { peak: Number(a.peak) || D.GM.fareBandPeak,
                            offPeak: Number(a.offPeak) || D.GM.fareBandOffPeak };
      g.log.push(`设定 ${code} 分时定价：高峰 ×${g.fareBands[code].peak} / 低谷 ×${g.fareBands[code].offPeak}`);
      return 'ok';
    }
    case 'setFare': {
      const r = g.routes.find(x => x.code === a.code); if (r) {
        const maxK = D.GM.max_fare_multiple || 0;
        const mk = D.MARKETS[a.code];
        const guide = mk && mk.guide_fare;
        if (maxK > 0 && guide && +a.fare > guide * maxK)
          return '票价超出上限（指导价 $' + guide + ' × ' + maxK + ' = $' + Math.round(guide * maxK) + '）';
        r.fare = +a.fare;
      }
      return 'ok';
    }
    /* 开线**申请**（原版机制：航线由裁判逐季释放，各团队须与裁判洽谈后
       支付固定开线费 $200,000 才能开通并执行飞行；见谈判纪要 §5.2 与演练规则）
       → 小组提交申请 → 裁判批准（GM 动作 approveRoute）→ 才真正开通
       → 开线费在**开通当季**计入（game.js oneoff），此处不重复扣款 */
    case 'openRoute': {
      const m = D.MARKETS[a.code]; if (!m) return 'bad market';
      if (g.routes.some(r => r.code === a.code)) return '已开通';
      if (!G.isRouteReleased(g, a.code)) return '裁判尚未开放该航线';
      if (m.esg_required && !g.investments.some(i => ['cab_galaxy', 'cab_new', 'cab_refresh'].includes(i.id)))
        return '需先投资环保项目';
      g.routeRequests = g.routeRequests || [];
      if (g.routeRequests.some(r => r.code === a.code && r.status === 'pending')) return '已申请，等待裁判';
      g.routeRequests.push({ code: a.code, seat: g.seat, requestedTurn: g.turn,
                             note: a.note || '', status: 'pending', at: new Date().toISOString() });
      g.log.push(`申请开通航线 ${m.name_cn}（待裁判洽谈批准，开线费 $${D.GM.new_route_fee.toLocaleString()}）`);
      return 'pending';
    }
    case 'payEtops': {
      const r = g.routes.find(x => x.code === a.code); if (!r) return 'no route';
      if (g.cash < D.GM.etops_fee) return '现金不足';
      g.cash -= D.GM.etops_fee; r.etopsPaid = true;
      g.log.push(`${D.MARKETS[a.code].name_cn} 取得 ETOPS 许可`);
      return 'ok';
    }
    case 'addFlight': {
      const ac = g.aircraft.find(x => x.id === +a.acId); if (!ac) return 'no ac';
      const dep0 = a.departure || '09:00';
      /* ★ 时刻抢占：同一航线的同一时刻若已被其他航司占用 → 该时刻成为其独飞，我方排不进去 */
      for (const [code2, g2] of sessions) {
        if (code2 === g.seat) continue;
        const hit = (g2.schedules || []).find(s => s.code === a.code && s.departure === dep0);
        if (hit) return `该时刻已被 ${code2} 抢占（${a.code} ${dep0} 已成为其独飞航班）`;
      }
      const chk = G.canAddFlight(g, ac, a.code, dep0);
      if (!chk.ok) return chk.why;
      const m = D.MARKETS[a.code];
      /* 班次占用时段：起飞 → 到达（单程 BH）→ 过站结束（过站时间按经营定位基线） */
      const bhMin = Math.round((m.bh || 1.5) * 60);
      const toMin = (s) => { const [h2, m2] = String(s || '00:00').split(':').map(Number); return (h2 || 0) * 60 + (m2 || 0); };
      const hhmm = (v) => String(Math.floor((v % 1440) / 60)).padStart(2, '0') + ':' + String(Math.round(v % 60)).padStart(2, '0');
      const depMin = toMin(dep0);
      const turnMin = G.turnaroundFor(ac, a.code, g);
      const taxiOut = D.GM.taxi_out_min || 0, taxiIn = D.GM.taxi_in_min || 0;
      /* ★ bh 是**往返** Block Hours → 去程单程 = bh/2
         去程到达 = 起飞 + bh/2；回程起飞 = 去程到达 + 过站；回程到达 = 起飞 + bh + 过站（= 可再排时刻） */
      /* ★ 学员填的是**起点**（撤轮档完成、开始滑行）：
         轮挡起飞 = 起点 + 滑行；轮挡落地 = +飞行；到达(廊桥) = +滑行到廊桥；
         回程起点 = 到达 + 清洁保障；下一班可开始 = 回程到达 */
      const offMin = depMin + taxiOut;
      const onMin = offMin + bhMin;
      const arrMin = onMin + taxiIn;
      const retDepMin = arrMin + turnMin;
      const retOffMin = retDepMin + taxiOut;
      const retOnMin = retOffMin + bhMin;
      const retArrMin = retOnMin + taxiIn;
      const blkMin = retDepMin;   // ★ 下一班可开始 = 到达 + 清洁保障（即回程起飞）
      g.schedules.push({
        acId: ac.id, code: a.code, ac, seats: ac.seats, bh: chk.bh, cargoCap: (ac.cargo ?? 0),
        departure: dep0,
        arrival: hhmm(arrMin),                    // 去程到达
        taxiOut: taxiOut, taxiIn: taxiIn,
        returnOffBlocks: hhmm(retOffMin),
        returnOnBlocks: hhmm(retOnMin),
        offBlocks: hhmm(offMin),                  // 轮挡起飞
        onBlocks: hhmm(onMin),                    // 轮挡落地
        returnDeparture: hhmm(retDepMin),          // 回程起点
        returnArrival: hhmm(retArrMin),            // 回程到达
        turnaround: turnMin,                       // 过站时间（分钟）
        blockUntil: hhmm(blkMin),                  // 该机可再次排班的时刻
        flightNo: `${g.seat}-${1000 + g.schedules.length}`,
      });
      return 'ok';
    }
    case 'removeFlight': g.schedules.splice(+a.index, 1); return 'ok';
    case 'invest': {
      const i = D.INVESTMENTS.find(x => x.id === a.id); if (!i) return 'no item';
      // F2 fix: route investment is bought per market (route by route basis)
      const invCode = i.cat === 'route' ? (a.code || null) : null;
      if (i.cat === 'route' && !invCode) return 'need market code';
      if (g.investments.some(x => x.id === i.id && x.code === invCode)) return 'already invested';
      if (g.cash < i.upfront) return 'no cash';
      g.cash -= i.upfront;
      g.investments.push({ id: i.id, name: i.name, kind: i.cat, code: invCode, amount: i.upfront, annual: i.annual, qsi: i.effect.qsi || 0, openedTurn: g.turn });
      if (i.annual) g.investmentsAnnual.push({ id: i.id, name: i.name, annual: i.annual });
      g.log.push(`投资 ${i.name}`);
      return 'ok';
    }
    case 'fleetEconomics': {
      // 航线经济性速览：开局即可用（不依赖历史结算）
      return G.fleetEconomicsBrief(g);
    }
    case 'estimateScaleJoint': {
      // 定价 × 运力 联合测算：候选机队规模 × 运价倍率 → 净收益最大组合
      return G.estimateScaleJoint(g, 4);
    }
    case 'estimateScale': {
      // 扩张测算（组合式）：供小组端「扩张测算器」使用
      const n = Math.max(0, Math.min(20, Number(a.n) || 0));
      return G.estimateScale(g, n);
    }
    case 'setReturnFlight': {
      // ★ 回程由**学员自行设定**：回程起飞时刻须 ≥ 过站时间结束（到达 + 下客/清洁/上客）
      const idx = Number(a.index);
      const sc = (g.schedules || [])[idx];
      if (!sc) return 'no flight';
      const dep0 = a.departure || '';
      if (!dep0) return '缺少回程起飞时刻';
      const toMin = (s2) => { const p = String(s2 || '00:00').split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); };
      const m = D.MARKETS[sc.code];
      const turn = G.turnaroundFor(sc.ac || { long: false }, sc.code, g);
      const arrMin = toMin(sc.arrival) || (toMin(sc.departure) + Math.round((m ? m.bh : 1.5) * 60) + (D.GM.taxi_out_min || 0) + (D.GM.taxi_in_min || 0));
      const readyMin = arrMin + turn;
      const retDep = toMin(dep0);
      if (retDep < readyMin) return '回程起飞不能早于过站时间结束（' + String(Math.floor(readyMin / 60)).padStart(2, '0') + ':' + String(readyMin % 60).padStart(2, '0') + '）';
      if (retDep + (D.GM.taxi_out_min || 0) + Math.round((m ? m.bh : 1.5) * 60) + (D.GM.taxi_in_min || 0) > 22 * 60)
        return '回程到达过晚（须在 22:00 前回到廊桥）';
      const hhmm = (v) => String(Math.floor((v % 1440) / 60)).padStart(2, '0') + ':' + String(Math.round(v % 60)).padStart(2, '0');
      sc.returnDeparture = hhmm(retDep);
      sc.returnOffBlocks = hhmm(retDep + (D.GM.taxi_out_min || 0));
      sc.returnArrival = hhmm(retDep + (D.GM.taxi_out_min || 0) + Math.round((m ? m.bh : 1.5) * 60) + (D.GM.taxi_in_min || 0));
      g.log.push('设定回程：' + sc.code + ' 回程起飞 ' + dep0 + ' → 到达 ' + sc.returnArrival);
      return 'ok';
    }
    case 'setRouteFlags': {
      // 联程设置：该航线是否可作中转点 / 是否提供联程（学员自决）
      const code = String(a.code || '');
      if (!g.routes.some(r => r.code === code)) return '航线未开通';
      g.routeFlags = g.routeFlags || {};
      const cur = g.routeFlags[code] || {};
      g.routeFlags[code] = { ...cur, hub: a.hub != null ? !!a.hub : cur.hub !== false,
                             feed: a.feed != null ? !!a.feed : cur.feed !== false };
      g.log.push(`联程设置 ${code}：${g.routeFlags[code].hub ? '可作中转点' : '不作中转点'} / ${g.routeFlags[code].feed ? '提供联程' : '不提供联程'}`);
      return 'ok';
    }
    case 'borrow': {
      // ★ 机队融资通道（Q2 起）：借款注入现金，利息计入运营成本
      const r = G.borrowFleet(g, a.amount);
      if (!r.ok) return r.why;
      gm.log.push(`${g.seat} 融资借款 $${Math.round(r.amount).toLocaleString()}`);
      return 'ok';
    }
    case 'buyAircraft': {
      // ★ 参数名冲突修复：a.type 既是动作名又是机型名 → 机型改用 acType（与 lease 一致）
      const acName = a.acType || a.acTypeName || (a.acModel) || null;
      const a2 = D.AIRCRAFT.find(x => x.name === acName) || D.AIRCRAFT.find(x => x.name === a.acModel);
      if (!a2) return 'no type（请用 acType 指定机型）';
      const price = a2.price * 1e6;
      if (g.cash < price) {
        if (!a.financed) return '现金不足';
        const gap = price - g.cash;
        const br = G.borrowFleet(g, gap);
        if (!br.ok) return '现金不足，且融资失败：' + br.why;
      }
      g.cash -= price;
      g.aircraft.push({
        id: (g.__acSeq = (g.__acSeq || g.aircraft.length) + 1), type: a2.name, owned: true, price,
        acquiredTurn: g.turn, age: 0, seats: a2.seats, eco: a2.eco, prem: a2.prem, biz: a2.biz,
        mtow: a2.mtow, fuel: a2.fuel, dmc_c: a2.dmc_c, dmc_fh: a2.dmc_fh, long: a2.long, nickname: 'Owned',
        cargo: a2.cargo ?? 0, cab_min: a2.cab_min ?? 1,
      });
      g.log.push(`购买 ${a2.name} ${price.toLocaleString()}`);
      return 'ok';
    }
    case 'lease': {
      // ★ 方案 A：签约现金门槛 = 0（免押金 + 租金后付）→ 无需预借
      const r = G.leaseAircraft(g, a.acType || a.aircraft);
      if (!r.ok) return r.why;
      return { ok: true, type: a.type, deposit: r.deposit, rentQ: r.rentQ };
    }
    case 'buyout': {
      const r = G.buyOutLease(g, +a.acId);
      if (!r.ok) return r.why;
      return { ok: true, buyout: r.buyout };
    }
    case 'buyAsset': {
      const a2 = D.ASSETS.find(x => x.id === a.id); if (!a2) return 'no asset';
      if (g.cash < a2.price) return '现金不足';
      g.cash -= a2.price;
      g.assets.push({ ...a2, openedTurn: g.turn });
      g.log.push(`购置 ${a2.name}`);
      return 'ok';
    }
    /* ── 发起提案（小组只能发起，最终生效须裁判在裁判端确认/修改）── */
    case 'propose': {
      const r = G.propose(g, a.kind, a.payload || {}, a.note || '');
      if (!r.ok) return r.why;
      return 'ok';
    }
    /* ── 情报购买（付费解锁市场参数 + 风险预警）── */
    case 'buyIntel': {
      const code = a.code;
      if (!D.MARKETS[code]) return '未知市场';
      // ★ 价格必须取**服务器端谈定的报价**，不接受客户端自带（否则可白嫖）
      const quote = gm.intelPrice?.[g.seat]?.[code];
      if (quote == null) return '裁判尚未就该市场情报报价';
      const price = Number(quote);
      if (g.negotiation.intel[code]) return '已购买该市场情报';
      if (g.cash < price) return `现金不足（情报报价 $${price.toLocaleString()}）`;
      g.cash -= price;
      g.negotiation.intel[code] = { price, turn: g.turn };
      g.log.push(`购买情报 ${D.MARKETS[code].name_c}：$${price.toLocaleString()}`);
      gm.negotiationLog.push({
        seq: ++gm.seq, turn: gm.turn, seat: g.seat, item: '情报成交',
        value: `${code}=$${price}`, note: '玩家购买', at: new Date().toISOString(),
      });
      return 'ok';
    }
    /* ── 卖飞机给裁判（回购报价谈判的落地）── */
    case 'sellBack': {
      const acId = Number(a.acId);
      const offer = (g.negotiation.buyback || {})[acId];
      if (!offer) return '裁判未对该飞机报价';
      const r4 = G.sellAircraft(g, acId, offer);
      if (!r4.ok) return r4.why;
      g.negotiation.buyback[acId] = 0;    // 成交后清除该机报价
      return 'ok';
    }
    /* ── U2 谈判申报单（小组发起） ── */
    case 'submitNegRequest': {
      const items = a.items || {};
      const keys = Object.keys(items).filter(k => NEGOTIABLE[k]);
      if (!keys.length) return '申报单至少需一项条款';
      g.negRequests = g.negRequests || [];
      const id = 'NR' + (g.negRequests.length + 1) + '-' + g.turn;
      g.negRequests.push({
        id, seat: g.seat, turn: g.turn, title: String(a.title || '谈判申报单').slice(0, 60),
        note: String(a.note || ''), items, status: 'submitted', round: 1,
        createdTurn: g.turn, updatedTurn: g.turn,
        history: [{ turn: g.turn, by: g.seat, action: '提交申报单', note: String(a.note || '') }],
      });
      g.log.push(`提交谈判申报单 ${id}：${keys.map(k => NEGOTIABLE[k].label).join('、')}`);
      return id;
    }
    case 'withdrawNegRequest': {
      const req = (g.negRequests || []).find(r => r.id === a.id);
      if (!req) return 'no request';
      if (!['submitted', 'countered'].includes(req.status)) return `当前状态（${NEG_LABEL[req.status]}）不可撤回`;
      req.status = 'withdrawn'; req.updatedTurn = g.turn;
      req.history.push({ turn: g.turn, by: g.seat, action: '撤回申报单', note: String(a.note || '') });
      g.log.push(`撤回谈判申报单 ${req.id}`);
      return 'ok';
    }
    case 'acceptCounter': {
      const req = (g.negRequests || []).find(r => r.id === a.id);
      if (!req) return 'no request';
      if (req.status !== 'countered') return '当前状态不可接受还价';
      const n = applyNegItems(g.seat, req.counterItems || req.items, `接受还价 ${req.id}`);
      req.status = 'effective'; req.agreedItems = req.counterItems || req.items; req.updatedTurn = g.turn;
      req.history.push({ turn: g.turn, by: g.seat, action: '接受还价并生效', note: `写入条款 ${n} 项` });
      g.log.push(`接受还价 ${req.id}，已生效 ${n} 项条款`);
      return 'ok';
    }
    case 'rejectCounter': {
      const req = (g.negRequests || []).find(r => r.id === a.id);
      if (!req) return 'no request';
      if (req.status !== 'countered') return '当前状态不可拒绝还价';
      req.status = 'rejected'; req.updatedTurn = g.turn;
      req.history.push({ turn: g.turn, by: g.seat, action: '拒绝还价', note: String(a.note || '') });
      return 'ok';
    }
    case 'buyCyberService': {
      // ★ 被攻击时的第二个解法：购买网络安全服务（cyberService 规则，$250,000/季）
      if (!g.hacked || g.hacked.resolved) return '当前未处于被攻击状态';
      const price = D.GM.cyber_service_price || 250000;
      if (g.cash < price) return `现金不足（需 $${price.toLocaleString()}）`;
      g.cash -= price;
      g.hacked.resolved = true;
      g.cyberProtected = (g.cyberProtected || 0) + 1;
      g.log.push(`购买网络安全服务 $${price.toLocaleString()}，系统恢复`);
      return 'ok';
    }
    case 'payRansom': {
      if (!g.hacked || g.hacked.resolved) return '当前未处于被攻击状态';
      const amt = g.hacked.ransom || 0;
      if (amt <= 0) return '裁判尚未报价赎金';
      if (g.cash < amt) return `现金不足（需 $${amt.toLocaleString()}）`;
      g.cash -= amt;
      g.hacked.resolved = true;
      g.log.push(`支付赎金 $${amt.toLocaleString()}，系统恢复`);
      return 'ok';
    }
    case 'advance': {
      if (!g.schedules.length) return 'no flights scheduled';   // ★ 空排班提交 → 拒绝，避免必然破产的巨额亏损
      g.submittedTurn = g.turn; g.submittedAt = Date.now(); g.turnDeadline = null;
      const rep = G.advanceTurn(g);
      /* 经营失败收口已下沉到 game.advanceTurn（引擎层）→ 此处只读取结果用于日志 */
      const health = g.financialHealth || { reduced: [], bankrupt: false };
      if (health.reduced.length) g.log.push('现金为负 → 强制削减：' + health.reduced.join('、'));
      if (health.bankrupt) {
        g.log.push('★ 资不抵债（现金 $' + Math.round(g.cash).toLocaleString() + '）→ 破产清算，本届退出');
        gm.log.push(`${g.seat} 破产清算（现金 $${Math.round(g.cash).toLocaleString()}）`);
      }
      g.lastDetail = rep.detail;
      g.lastConnByRoute = {};
      for (const [k, d] of Object.entries(rep.detail)) g.lastConnByRoute[k] = d.connected_pax;
      gm.turn = Math.max(gm.turn, g.turn);
      gm.log.push(`${g.seat} 提交 ${rep.period}: 利润 ${Math.round(rep.operating_profit).toLocaleString()}`);
      return rep;
    }
    default: return 'unknown action';
  }
}

/* ── 裁判动作 ── */
function applyGMAction(a) {
  switch (a.type) {
    case 'createSeat': {
      const code = String(a.code || '').trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,2}$/.test(code)) return 'bad seat code';
      if (KEYS.seats[code]) return 'seat exists';
      const r2 = () => Math.random().toString(36).slice(2, 10);
      KEYS.seats[code] = r2() + r2();
      SEATS[code] = { code, name: a.name || ('Team ' + code), name_cn: a.name_cn || ('小组 ' + code), color: '#666' };
      KEYS.seatMeta = KEYS.seatMeta || {};
      KEYS.seatMeta[code] = SEATS[code];      // ★ 持久化席位元数据（重启后仍可访问）
      sessions.set(code, newSession(code));
      try { writeFileSync(KEY_FILE, JSON.stringify(KEYS, null, 2)); }
      catch (e) { gm.log.push(`★ 席位 ${code} 密钥落盘失败：${e.message}`); }
      gm.log.push(`新建席位 ${code}`);
      return KEYS.seats[code];            // 返回密钥 → 裁判端展示给授课教师
    }
    case 'reviewNegRequest': {
      // U3 谈判流转台：受理 / 还价 / 驳回
      const g = sessions.get(String(a.seat || ''));
      if (!g) return 'no seat';
      const req = (g.negRequests || []).find(r => r.id === a.id);
      if (!req) return 'no request';
      const act = a.action || 'accept';
      if (!['submitted', 'under_review', 'countered'].includes(req.status)) return `当前状态（${NEG_LABEL[req.status]}）不可再处理`;
      if (act === 'reject') {
        req.status = 'rejected'; req.updatedTurn = gm.turn;
        req.history.push({ turn: gm.turn, by: 'GM', action: '驳回申报单', note: String(a.note || '') });
        gm.log.push(`驳回 ${g.seat} 的谈判申报单 ${req.id}${a.note ? '（' + a.note + '）' : ''}`);
        return 'ok';
      }
      if (act === 'counter') {
        req.counterItems = a.items || req.items;
        req.status = 'countered'; req.round = (req.round || 1) + 1; req.updatedTurn = gm.turn;
        req.history.push({ turn: gm.turn, by: 'GM', action: '还价', note: String(a.note || '') });
        gm.log.push(`就 ${g.seat} 的申报单 ${req.id} 还价（第 ${req.round} 轮）`);
        return 'ok';
      }
      // accept：直接达成并生效
      const items = a.items || req.items;
      const n = applyNegItems(g.seat, items, `达成 ${req.id}`);
      req.status = 'effective'; req.agreedItems = items; req.updatedTurn = gm.turn;
      req.history.push({ turn: gm.turn, by: 'GM', action: '受理并达成', note: `写入条款 ${n} 项` });
      gm.log.push(`达成 ${g.seat} 的谈判申报单 ${req.id}（生效 ${n} 项）`);
      return 'ok';
    }
    /* ── 赛季计时：开始本季（1 小时）/ 提前结算兜底 ── */
    case 'startRound': {
      const secs = Math.max(30, Number(a.seconds || D.GM.round_seconds || 3600));
      gm.roundSeconds = secs;
      const now = Date.now();
      for (const g of sessions.values()) {
        if (g.submittedTurn === g.turn) continue;      // 已提交不再计时
        g.turnStartedAt = now;
        g.turnDeadline = now + secs * 1000;
      }
      gm.roundStartedAt = now;
      gm.log.push(`开始本季：各席位限时 ${Math.round(secs / 60)} 分钟，到时自动结算`);
      return 'ok';
    }
    case 'settleNow': {
      // 裁判兜底：立即结算所有未提交席位（可指定席位）
      const only = a.seat ? [String(a.seat)] : [...sessions.keys()];
      const done = [];
      for (const code of only) {
        const g = sessions.get(code);
        if (!g) continue;
        if (g.submittedTurn === g.turn) { done.push(code + '(已提交)'); continue; }
        const r = applyAction(g, { type: 'advance' });
        g.turnDeadline = null; g.turnStartedAt = null;
        done.push(code + '(' + r + ')');
      }
      gm.log.push(`裁判提前结算：${done.join('、')}`);
      return 'ok';
    }
    /* ── U18 消息板：裁判发布公告 / 规则更新，小组端可见 ── */
    case 'postMessage': {
      const title = String(a.title || '').slice(0, 80);
      if (!title) return '缺少标题';
      gm.messages = gm.messages || [];
      const m = { id: 'MSG' + (gm.messages.length + 1) + '-' + gm.turn, turn: gm.turn,
                   title, body: String(a.body || ''), kind: a.kind || 'notice',
                   seat: a.seat || null,          // ★ 定向：仅指定席位可见（裁判邮件式情报）
                   code: a.code || null,          // 关联市场（情报类）
                   by: '裁判', at: gm.turn, pinned: !!a.pinned, read: {} };
      gm.messages.push(m);
      gm.log.push(`发布消息 ${m.id}：${title}`);
      return m.id;
    }
    case 'removeMessage': {
      const before = (gm.messages || []).length;
      gm.messages = (gm.messages || []).filter(m => m.id !== a.id);
      return gm.messages.length < before ? 'ok' : 'no such message';
    }
    case 'setHedgeQuotes': {
      // ★ 裁判设定套保报价表（3 家供给方：成本结构/条件各异）→ 小组按统一可比字段比价选型
      const q = (a.quotes || []).filter(x => x && x.id && x.product);
      if (!q.length) return 'no quotes';
      gm.hedgeQuotes = q.map(x => ({
        id: String(x.id), supplier: x.supplier || ('供给方 ' + x.id),
        product: x.product, strike: Number(x.strike), floor: x.floor == null ? null : Number(x.floor),
        share: Number(x.share ?? 1), quarters: Number(x.quarters ?? 2),
        upfront: Number(x.upfront ?? 0), fixedFeePerQuarter: Number(x.fixedFeePerQuarter ?? 0),
        varPerGal: Number(x.varPerGal ?? 0), creditSupport: !!x.creditSupport,
        prepayRate: Number(x.prepayRate ?? 0), minGallons: Number(x.minGallons ?? 0),
        leverage: Number(x.leverage ?? 0), terms: x.terms || '',
      }));
      gm.log.push(`更新套保报价表（${gm.hedgeQuotes.length} 家：${gm.hedgeQuotes.map(x => x.id + ' ' + x.supplier).join('、')}）`);
      return 'ok';
    }
    case 'acceptHedgeQuote': {
      // ★ 小组按比价结果选定一家供给方（upfront 即时支付，锁定 strike/share/quarters）
      const g = sessions.get(String(a.seat || ''));
      if (!g) return 'no seat';
      if (!G.hedgeWindowOpen(g)) return '裁判本季不提供燃油套保';
      const q = (gm.hedgeQuotes || D.HEDGE_QUOTES).find(x => x.id === String(a.quoteId));
      if (!q) return 'no such quote';
      if (g.cash < (q.upfront || 0)) return '现金不足以支付套保费用';
      g.cash -= (q.upfront || 0);                       // ★ 套保费用此前从未计入成本 —— 现即时支付
      g.negotiation.fuelHedge = (g.negotiation.fuelHedge || []).filter(x => (x.quarters ?? 0) <= 0);
      g.negotiation.fuelHedge.push({
        id: q.id, supplier: q.supplier, product: q.product, strike: q.strike, floor: q.floor,
        share: q.share, quarters: q.quarters, premium: q.upfront,
        fixedFeePerQuarter: q.fixedFeePerQuarter, varPerGal: q.varPerGal, cap: q.product === 'call',
      });
      g.log.push(`选定套保方案 ${q.id}（${q.supplier}）：${q.product} 锁价 ${q.strike} × 覆盖 ${(q.share * 100).toFixed(0)}% / ${q.quarters} 季，费用 $${(q.upfront || 0).toLocaleString()}`);
      gm.log.push(`${g.seat} 选定套保方案 ${q.id}（${q.supplier}）`);
      return 'ok';
    }
    /* ── 考核目标（targetSubmit 规则：第 3 季起由裁判询问并设定；前两季不可设定也不可见） ── */
    case 'setTarget': {
      if (!G.isRuleOn(gm.__probe || { rules: {} }, 'targetSubmit')) { /* 规则以回合表为准 */ }
      if (gm.turn < 2) return '考核目标自第 3 季起设定';
      const seat = String(a.seat || '');
      if (!sessions.has(seat)) return 'no seat';
      gm.targets = gm.targets || {};
      const cur = gm.targets[seat] || {};
      gm.targets[seat] = {
        ...cur,
        lf: a.lf != null ? Number(a.lf) : cur.lf,
        profit: a.profit != null ? Number(a.profit) : cur.profit,
        share: a.share != null ? Number(a.share) : cur.share,
        note: a.note != null ? String(a.note) : cur.note,
        setTurn: gm.turn, setBy: '裁判',
      };
      gm.log.push(`设定 ${seat} 考核目标${gm.targets[seat].lf != null ? `（LF ${(gm.targets[seat].lf * 100).toFixed(0)}%）` : ''}`);
      return 'ok';
    }
    /* ── 经营模式由裁判在开局与三家协商确定（首季；之后锁定） ── */
    /* ── 大修由裁判触发（具体季由裁判决定；是否卖出由团队自决） ── */
    case 'triggerHeavyCheck': {
      const g2 = sessions.get(String(a.seat || ''));
      if (!g2) return 'no seat';
      const r = G.startHeavyCheck(g2, Number(a.acId));
      if (!r.ok) return r.why;
      gm.log.push(`裁判触发 ${a.seat} 的 ${(g2.aircraft.find(x => x.id === Number(a.acId)) || {}).type} 大修（第 ${gm.turn + 1} 季）→ 运力减半至 ${r.bhAllowed} BH`);
      return 'ok';
    }
    case 'setSeatStyle': {
      const g2 = sessions.get(String(a.seat || ''));
      if (!g2) return 'no seat';
      const st = String(a.style || '');
      if (!['LCC', 'FSC', 'Hybrid'].includes(st)) return '未知经营模式';
      if (gm.turn > 0 && g2.styleLocked) return '经营模式已在开局确定，不可再改';
      g2.style = st;
      g2.styleLocked = true;
      gm.log.push(`${a.seat} 经营模式确定为 ${st}（过站基线 ${(D.GM.style_turnaround || {})[st]} 分钟）`);
      return 'ok';
    }
    case 'removeSeat': {
      // 解散席位（清理测试残留 / 课堂分组调整）
      const code = String(a.seat || '');
      if (!sessions.has(code)) return 'no seat';
      sessions.delete(code);
      delete SEATS[code];
      if (KEYS.seats) delete KEYS.seats[code];
      if (KEYS.seatMeta) delete KEYS.seatMeta[code];
      try { writeFileSync(KEY_FILE, JSON.stringify(KEYS, null, 2)); } catch { }
      gm.log.push('解散席位 ' + code);
      return 'ok';
    }
    case 'setCargoPolicy': {
      // 裁判设定某航线是否开放载货（或全局 '*'）
      const code = String(a.code || '*').toUpperCase();
      gm.cargoPolicy = gm.cargoPolicy || {};
      gm.cargoPolicy[code] = { open: a.open !== false, maxTons: a.maxTons != null ? Number(a.maxTons) : null };
      gm.log.push();
      return 'ok';
    }
    case 'setRansom': {
      const g2 = sessions.get(String(a.seat || ''));
      if (!g2) return 'no seat';
      if (!g2.hacked) return '该席位未处于被攻击状态';
      g2.hacked.ransom = Math.max(0, Number(a.amount) || 0);
      gm.log.push(`为 ${a.seat} 报价赎金 $${g2.hacked.ransom.toLocaleString()}`);
      return 'ok';
    }
    case 'resolveHack': {
      const g2 = sessions.get(String(a.seat || ''));
      if (!g2) return 'no seat';
      if (!g2.hacked) return '该席位未处于被攻击状态';
      g2.hacked.resolved = true;
      gm.log.push(`${a.seat} 的网络攻击已处理，系统恢复`);
      return 'ok';
    }
    case 'setFuel': gm.fuelPrice = +a.value; for (const g of sessions.values()) applyGM(g); return 'ok';
    case 'setCarbon': gm.carbonPrice = +a.value; for (const g of sessions.values()) applyGM(g); return 'ok';
    case 'setInterest': gm.interestRate = +a.value; for (const g of sessions.values()) applyGM(g); return 'ok';
    case 'setConnecting': gm.connectingDemand = +a.value; for (const g of sessions.values()) applyGM(g); return 'ok';
    /* ── 开线审批：裁判与小组洽谈后批准（开线费固定不可议价 $200,000）── */
    case 'approveRoute': {
      const seat = String(a.seat || '');
      const g = sessions.get(seat);
      if (!g) return 'no seat';
      const req = (g.routeRequests || []).find(r => r.code === a.code && r.status === 'pending');
      if (!req) return 'no pending request';
      const m = D.MARKETS[a.code]; if (!m) return 'bad market';
      if (a.approve === false || a.approve === 'false') {
        req.status = 'rejected'; req.resolvedTurn = gm.turn;
        req.resolvedNote = a.note || '';
        gm.log.push(`驳回 ${seat} 的 ${m.name_cn} 开线申请${a.note ? '（' + a.note + '）' : ''}`);
        return 'ok';
      }
      if (g.routes.some(r => r.code === a.code)) { req.status = 'approved'; return 'ok'; }
      /* 开线费**批准时即支付**（原版：支付航线费用开通后才能使用；固定不可议价）
         → 结算期不再重复扣（route.feePaid 标记） */
      /* ★ 解除规则死锁：开线费**可赊**（负现金也能开通航线）
         —— 课程裁定：经营失误导致负现金是正常经营反馈，但「规则导致无论如何经营都为负」不可接受
         —— 赊账代价真实存在：计入应付开线费 routeFeeDue，并按季息计入运营成本 */
      g.cash -= D.GM.new_route_fee;
      g.routeFeeDue = (g.routeFeeDue || 0) + D.GM.new_route_fee;
      g.routes.push({ code: a.code, fare: m.guide_fare || 200, openedTurn: g.turn,
                      etopsPaid: false, feePaid: true });
      req.status = 'approved'; req.resolvedTurn = gm.turn; req.resolvedNote = a.note || '';
      gm.log.push(`批准 ${seat} 开通 ${m.name_cn}（开线费 $${D.GM.new_route_fee.toLocaleString()} 于当季计入）`);
      return 'ok';
    }
    /* ── 裁判本回合批量释放航线（教学：放哪几条由裁判按教学目的决定）── */
    case 'releaseRoutes': {
      const codes = String(a.codes || '').split(/[,，\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
      if (!codes.length) return 'no codes';
      const bad = codes.filter(c => !(c in D.GM.routeReleaseTurn));
      if (bad.length) return 'unknown route: ' + bad.join(',');
      // 把这些航线的释放回合设为当前回合（其余保持原计划）
      for (const c of codes) D.GM.routeReleaseTurn[c] = gm.turn;
      gm.log.push(`本回合释放航线：${codes.join('、')}`);
      return 'ok';
    }
    /* ── 航线释放回合可调（裁判可提前/延后释放某条航线）── */
    case 'setRouteRelease': {
      const code = String(a.code || '');
      if (!(code in D.GM.routeReleaseTurn)) return 'unknown route';
      D.GM.routeReleaseTurn[code] = Math.max(0, Math.min(D.GM.max_turns, +a.turn));
      gm.log.push(`航线 ${code} 释放回合 → ${D.GM.routeReleaseTurn[code]}`);
      return 'ok';
    }
    /* ── 裁判注资（用于测试/课堂补给：让小组能承担开线费等固定支出）── */
    case 'grantCash': {
      const g = sessions.get(String(a.seat || ''));
      if (!g) return 'no seat';
      g.cash += Number(a.amount) || 0;
      gm.log.push(`裁判向 ${a.seat} 注资 $${Math.round(Number(a.amount) || 0).toLocaleString()}`);
      return 'ok';
    }
    /* ── 套保窗口：裁判可宣布本季不提供套保（已签的不受影响）── */
    case 'setHedgeWindow': {
      gm.hedgeWindowOpen = a.value !== false && a.value !== 'false' && a.value !== 0;
      for (const g of sessions.values()) applyGM(g);
      gm.log.push(`燃油套保窗口 → ${gm.hedgeWindowOpen ? '开放' : '关闭（本季不签新套保）'}`);
      return 'ok';
    }
    /* ── 分季规则：裁判调整某条规则的开启回合（教学节奏）── */
    case 'setRule': {
      const key = String(a.key || '');
      if (!D.RULE_SCHEDULE.some(r => r.key === key)) return 'unknown rule';
      if (a.turn === null || a.turn === undefined || a.turn === '') delete gm.ruleOverrides[key];
      else gm.ruleOverrides[key] = Math.max(0, Math.min(D.GM.max_turns, +a.turn));
      for (const g of sessions.values()) applyGM(g);
      gm.log.push(`规则「${key}」开启回合 → ${gm.ruleOverrides[key] ?? D.RULE_SCHEDULE.find(r=>r.key===key).turn}`);
      return 'ok';
    }
    case 'openMarket': {
      if (!gm.openMarkets.includes(a.code)) gm.openMarkets.push(a.code);
      for (const g of sessions.values()) applyGM(g);
      return 'ok';
    }
    case 'triggerEvent': {
      /* ★ 网络攻击事件：被攻击席位的面板会被攻击遮罩覆盖 → 全程无法操作
         困难不是裁判"给予"的，而是事件导致的直接后果；解除方式：付赎金或裁判标记已处理 */
      if (a.eventId === 'cyber') {
        for (const [code2, g2] of sessions) {
          if (a.seat && code2 !== a.seat) continue;
          if (!a.seat) continue;                    // 未定向 → 不影响具体航司面板
          g2.hacked = { at: gm.turn, resolved: false, ransom: 0 };
          gm.log.push(`${code2} 收益管理系统遭勒索（面板不可操作）`);
        }
      }
      const ev = D.EVENTS.find(e => e.id === a.eventId); if (!ev) return 'no event';
      gm.events.push({ turn: gm.turn, ...ev, target: a.target });
      for (const g of sessions.values()) {
        if (a.seat && g.seat !== a.seat) continue;
        G.triggerEvent(g, a.eventId, a.target);
        applyGM(g);
      }
      gm.log.push(`裁判触发 ${ev.title} @ ${a.target || '全局'}`);
      return 'ok';
    }
    /* ── 提案审批：小组发起 → 裁判可修改后批准 ── */
    case 'resolveProposal': {
      const seat = a.seat;
      const g = sessions.get(seat);
      if (!g) return '席位不存在';
      // 跨组转让时，把目标席位注入给 applyProposal
      const pr = (g.proposals || []).find(x => x.id === a.id);
      if (pr && pr.kind === 'sell_to_group') {
        const toSeat = (a.modify && a.modify.toSeat) || pr.payload.toSeat;
        g.__seatTarget = toSeat ? sessions.get(toSeat) : null;
      }
      const r = G.resolveProposal(g, a.id, a.action || 'approve', a.modify || {});
      g.__seatTarget = null;
      if (!r.ok) return r.why;
      // 记账：提案成交也进入谈判日志
      negLog(gm, seat, '提案审批：' + (G.PROPOSAL_KINDS[pr?.kind]?.label || pr?.kind),
             a.action === 'reject' ? '驳回' : '批准', a.note);
      return 'ok';
    }
    /* ── 裁判谈判工作台 ── */
    case 'negotiate': {
      const seat = a.seat && a.seat !== '*' ? a.seat : null;
      const item = a.item;
      const spec = NEGOTIABLE[item];
      if (!spec) return '未知的谈判条款: ' + item;
      const targets = seat
        ? [sessions.get(seat)].filter(Boolean)
        : [...sessions.values()];
      if (!targets.length) return '席位不存在: ' + seat;
      for (const g of targets) {
        g.negotiation = g.negotiation || {};
        const v = a.value;
        // ★ 过站时间档位按经营定位强约束（低于基线或不在允许档位 → 拒绝）
        if (item === 'turnaroundMin') {
          const st = g.style || 'Hybrid';
          const base = (D.GM.style_turnaround || {})[st] || 60;
          const opts = (D.GM.style_turnaround_options || {})[st] || [60];
          const num = Number(v);
          if (!opts.includes(num) || num < base)
            return `过站时间档位不适用于 ${st}（基线 ${base} 分钟，可选 ${opts.join('/')}）`;
        }
        if (spec.type === 'perMarket') {
          const code = a.code;
          if (!code) return '缺少市场代码';
          if (item === 'subsidy') g.negotiation.subsidies[code] = Number(v) || 0;
          else if (item === 'fareDiscount') g.negotiation.fareDiscount[code] = Number(v) || 1;
          else if (item === 'marketFuel' || item === 'marketDemand') {
            g.marketParams = g.marketParams || {};
            g.marketParams[code] = g.marketParams[code] || {};
            if (item === 'marketFuel') g.marketParams[code].fuelPrice = Number(v);
            else g.marketParams[code].demandMult = Number(v) || 1;
          }
        } else if (spec.type === 'perAc') {
          const acId = Number(a.acId);
          const amt = Number(v) || 0;
          /* ★ 裁判回购报价上限（相对该机目录价）：防止离谱报价（如 20 亿）把飞机白送 */
          const ac = g.aircraft.find(x => x.id === acId);
          const maxK = D.GM.buyback_max_multiple || 0;
          if (maxK > 0 && ac) {
            const cap = Math.round(ac.price * maxK);
            if (amt > cap) return '回购报价超出上限（该机目录价 $' + Math.round(ac.price).toLocaleString() + ' × ' + maxK + ' = $' + cap.toLocaleString() + '）';
            if (amt < 0) return '报价不能为负';
          }
          g.negotiation.buyback[acId] = amt;
        } else if (spec.type === 'hedge') {
          // ★ 套保窗口关闭（裁判宣布本季不提供）→ 拒绝新签
          if (!G.hedgeWindowOpen(g)) return '裁判本季不提供燃油套保';
          // ★ 两档固定方案（真实规则，不可连续议价）
          const HEDGE = { swap: { premium: 50000, strike: 2.63, cap: false },
                          call: { premium: 350000, strike: 2.43, cap: true } };
          const pick = HEDGE[a.hedgeId] || HEDGE.swap;
          g.negotiation.fuelHedge = (g.negotiation.fuelHedge || []).filter(x => x.quarters <= 0);
          g.negotiation.fuelHedge.push({
            id: a.hedgeId || 'swap', ...pick,
            quarters: Number(a.quarters) || 2,
          });
        } else if (spec.type === 'leaseType') {
          g.negotiation.leaseType = a.value === 'dry' ? 'dry' : 'wet';
        } else if (spec.type === 'heavyCheck') {
          const r3 = G.startHeavyCheck(g, Number(a.acId));
          if (!r3.ok) return r3.why;
        } else if (spec.type === 'invest') {
          g.negotiation.investTerms = g.negotiation.investTerms || {};
          const cur = g.negotiation.investTerms[a.invId] || {};
          g.negotiation.investTerms[a.invId] = {
            ...cur,
            ...(a.costPerPax != null ? { costPerPax: Number(a.costPerPax) } : {}),
            ...(a.revenuePerPax != null ? { revenuePerPax: Number(a.revenuePerPax) } : {}),
          };
        } else {
          g.negotiation[item] = (v === null || v === '') ? null : Number(v);
        }
      }
      const logVal = item === 'fuelHedge'
        ? `锁价 ${a.price} / 覆盖 ${a.share} / ${a.quarters} 季`
        : (a.value);
      negLog(gm, seat || '*', spec.label + (a.code ? ' [' + a.code + ']' : ''), logVal, a.note);
      return 'ok';
    }
    case 'batchNegotiate': {
      // 批量下发：把同一套条款应用到若干组（"分组配置 + 批量下发"）
      const items = a.items || {};
      const seats = a.seats && a.seats.length ? a.seats : [...sessions.keys()];
      const target = a.seat ? [a.seat] : seats;
      let n = 0;
      for (const sc of target) {
        const g = sessions.get(sc);
        if (!g) continue;
        g.negotiation = g.negotiation || {};
        for (const [k, v] of Object.entries(items)) {
          if (v === null) { g.negotiation[k] = null; continue; }
          if (k === 'subsidy' || k === 'fareDiscount' || k === 'marketFuel' || k === 'marketDemand') {
            if (!a.code) continue;
            if (k === 'subsidy') g.negotiation.subsidies[a.code] = Number(v) || 0;
            else if (k === 'fareDiscount') g.negotiation.fareDiscount[a.code] = Number(v) || 1;
            else {
              g.marketParams = g.marketParams || {};
              g.marketParams[a.code] = g.marketParams[a.code] || {};
              if (k === 'marketFuel') g.marketParams[a.code].fuelPrice = Number(v);
              else g.marketParams[a.code].demandMult = Number(v) || 1;
            }
          } else if (k === 'turnaroundMin' || k === 'leaseDiscount' || k === 'insuranceRate'
                     || k === 'fuelPrice' || k === 'carbonPrice' || k === 'interestRate'
                     || k === 'connectingDemand') {
            g.negotiation[k] = Number(v);
          }
        }
        n++;
      }
      negLog(gm, a.seat || '*', '批量下发条款', JSON.stringify(items).slice(0, 80), a.note);
      return `ok:${n}`;
    }
    case 'budgetLimit': {
      // 设定各组谈判额度（null = 不限）
      const seats = a.seats && a.seats.length ? a.seats : [...sessions.keys()];
      for (const sc of seats) {
        const g = sessions.get(sc);
        if (!g) continue;
        g.negotiation = g.negotiation || {};
        g.negotiation.budgetLimit = a.limit === null || a.limit === undefined ? null : Number(a.limit);
        g.negotiation.budgetUsed = 0;
      }
      negLog(gm, a.seat || '*', '设定谈判额度', a.limit == null ? '不限' : a.limit, a.note);
      return 'ok';
    }
    case 'listScenarios': return SCENARIOS.map(s => ({
      id: s.id, name: s.name, desc: s.desc, focus: s.focus,
      budgetLimit: s.budgetLimit, events: s.events, params: s.params }));
    case 'applyScenario': {
      // 课堂场景包：一键套用预设
      const sc = a.scenario || {};
      const seats = a.seats && a.seats.length ? a.seats : [...sessions.keys()];
      for (const s2 of seats) {
        const g = sessions.get(s2);
        if (!g) continue;
        g.negotiation = g.negotiation || {};
        for (const [k, v] of Object.entries(sc.params || {})) {
          g.negotiation[k] = (v === null) ? null : Number(v);
        }
        if (sc.scenarioId) g.scenarioId = sc.scenarioId;
        // 场景自带的事件排期 → 挂到裁判事件队列（按回合触发）
        if (sc.events && sc.events.length) {
          gm.scenarioEvents = gm.scenarioEvents || [];
          for (const ev of sc.events) {
            if (!gm.scenarioEvents.some(x => x.turn === ev.turn && x.id === ev.id)) {
              gm.scenarioEvents.push({ ...ev, fired: false });
            }
          }
        }
      }
      negLog(gm, a.seat || '*', '套用课堂场景', sc.name || sc.scenarioId || '-', a.note);
      return 'ok';
    }
    case 'intelPrice': {
      const seat = a.seat;
      if (!seat) return '缺少席位';
      gm.intelPrice[seat] = gm.intelPrice[seat] || {};
      gm.intelPrice[seat][a.code] = Number(a.price) || 0;
      negLog(gm, seat, '情报报价 [' + a.code + ']', a.price, a.note);
      return 'ok';
    }
    case 'clearNegotiation': {
      const seat = a.seat;
      const g = sessions.get(seat);
      if (!g) return '席位不存在';
      g.negotiation = {
        fuelPrice: null, carbonPrice: null, interestRate: null, connectingDemand: null,
        insuranceRate: null, fuelHedge: [], intel: {}, subsidies: {}, fareDiscount: {}, buyback: {},
      };
      g.marketParams = {};
      negLog(gm, seat, '清空全部谈判条款', '-', a.note);
      return 'ok';
    }
    case 'advanceAll': {
      // 场景事件排期：到达回合即触发
      for (const ev of (gm.scenarioEvents || [])) {
        if (!ev.fired && ev.turn <= gm.turn) {
          ev.fired = true;
          for (const g of sessions.values()) {
            try { G.triggerEvent(g, ev.id, ev.target === '*' ? null : ev.target); } catch { /* 忽略 */ }
          }
          gm.log.push(`【场景事件】${ev.id} @ ${ev.target || '全局'}`);
        }
      }
      const out = {};
      for (const [seat, g] of sessions.entries()) out[seat] = applyAction(g, { type: 'advance' });
      gm.turn++;
      return out;
    }
    default: return 'unknown';
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SkyChess 沙盘服务端已启动`);
  console.log(`  玩家    http://127.0.0.1:${PORT}/player.html?seat=CA  (AB / VA)`);
  console.log(`  教师    http://127.0.0.1:${PORT}/teacher.html`);
});
