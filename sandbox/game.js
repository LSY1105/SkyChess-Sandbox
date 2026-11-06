/* ============================================================
   SkyChess Sandbox — 游戏状态机与回合结算
   ============================================================ */
import { GM, MARKETS, CARBON, LOAN, RULE_SCHEDULE, MARKET_LIST, AIRCRAFT, INVESTMENTS, ASSETS, EVENTS, TARGETS, MARKET_INTEL } from './data.js';
import * as E from './engine.js';
import { initCompetitors, stepCompetitors, settleCompetitors } from './competitors.js';

const RNG = (seed) => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };

/* ── 分时定价：按起飞时刻换算有效票价 ────────────────────────────
   峰时加价、谷时打折（学员可按航线调 peak/offPeak 参数）。
   ★ 与日内需求曲线联动：高峰本就有更多客源，加价后仍可能更划算；
 低谷客源少，降价用于提高客座率。 */
export function slotFareK(g, code, hour) {
  const cfg = (g.fareBands && g.fareBands[code]) || {};
  const peak = cfg.peak != null ? cfg.peak : GM.fareBandPeak;
  const off = cfg.offPeak != null ? cfg.offPeak : GM.fareBandOffPeak;
  const ph = cfg.peakHours || GM.fareBandPeakHours;
  const oh = cfg.offPeakHours || GM.fareBandOffPeakHours;
  const inPeak = ph.some(([a, b]) => hour >= a && hour < b);
  if (inPeak) return peak;
  const inOff = oh.some(([a, b]) => hour >= a && hour < b);
  return inOff ? off : 1;
}
export function effectiveFare(g, route, hour) {
  return route.fare * slotFareK(g, route.code, hour);
}

/* ============================================================
   分季规则开关（progressive rule unlocking）
   ------------------------------------------------------------
   每条机制按 RULE_SCHEDULE 的开启回合逐步引入；裁判可通过
   g.ruleOverrides 提前或延后某条规则的开启回合（教学节奏可调）。
   ============================================================ */
/* ── 裁判分季释放的航线 ────────────────────────────────────────────
   原版：航线不是一开始就全开；裁判逐季释放，各团队再与之洽谈并付开线费。 */
export function releasedRoutes(g) {
  const tbl = g.routeReleaseTurn || GM.routeReleaseTurn;
  const overrides = g.routeReleaseOverrides || {};
  return Object.entries(tbl)
    .filter(([code, t]) => {
      const turn = overrides[code] != null ? overrides[code] : t;
      return g.turn >= turn;
    })
    .map(([code]) => code);
}
export function isRouteReleased(g, code) {
  return releasedRoutes(g).includes(code);
}
/** 本回合新释放的航线（用于提示"裁判本季放出了新航线"） */
export function newlyReleasedRoutes(g) {
  const tbl = g.routeReleaseTurn || GM.routeReleaseTurn;
  const overrides = g.routeReleaseOverrides || {};
  const opened = (g.routes || []).map(r => r.code);
  return Object.entries(tbl)
    .filter(([code, t]) => {
      const turn = overrides[code] != null ? overrides[code] : t;
      return g.turn === turn && !opened.includes(code);   // 已开通（初始航线）不算「新开放」
    })
    .map(([code]) => code);
}

export function isRuleOn(g, key) {
  const ov = g.ruleOverrides?.[key];
  const def = RULE_SCHEDULE.find(r => r.key === key);
  const turn = ov != null ? ov : (def ? def.turn : 0);
  return g.turn >= turn;
}
export function ruleStatus(g) {
  return RULE_SCHEDULE.map(r => {
    const turn = g.ruleOverrides?.[r.key] != null ? g.ruleOverrides[r.key] : r.turn;
    return { ...r, turn, on: g.turn >= turn };
  });
}

export function newGame(seed = 20261021, opts = {}) {
  const rnd = RNG(seed);
  const g = {
    seed, rnd,
    turn: 0,                       // 0-based
    maxTurns: opts.maxTurns ?? GM.max_turns,
    cash: GM.start_cash,
    fuelPrice: 2.40, carbonPrice: CARBON.base_price_per_tonne, interestRate: LOAN.rate_annual,
    qsi: 4.50,
    connectingDemand: 0,        // 中转强度等级 0-3（裁判可调）——默认关闭：原版 CA Q4/2027 实测中转≈0
    /* ── 裁判谈判条款（按小组协商达成，可覆盖全局参数）── */
    negotiation: {
      fuelPrice: null,          // 定向油价覆盖
      carbonPrice: null,        // 定向碳价
      interestRate: null,       // 定向利率
      connectingDemand: null,   // 定向中转强度
      insuranceRate: null,      // 保险费率 %（null → 用全局 GM.insurance_rate）
      fuelHedge: [],            // 燃油套保 [{id:'swap'|'call', strike, quarters}]
      turnaroundMin: null,      // 短程过站时间（分钟，15 的倍数）；null=用全局
      leaseType: null,          // 'dry' | 'wet'
      leaseDiscount: null,      // 租赁折扣（0~1，如 0.20）
      heavyCheck: {},           // {acId: {done, bhUsed}} 大修状态
      intel: {},                // 已购情报 {code: {price, turn}}
      subsidies: {},            // 航线补贴 {code: 每回合金额}
      fareDiscount: {},         // 费用/运价折扣 {code: 0.95}
      buyback: {},              // 裁判回购报价 {acId: price}
      investTerms: {},          // 投资项逐组议价 {invId: {costPerPax, revenuePerPax, annual}}
      budgetUsed: 0,            // 本回合已用谈判额度
      exemptions: {},           // 事件罚则豁免 {acId: {noFine, replacementAcId}}
      cabinExtraCrew: {},       // 需额外乘务员的飞机 {acId: true}
      cateringConsistent: false,// 全航线餐饮统一
      themedOps: {},            // 主题化运营 {acId: {name, feePerPax, qsiBonus}}
      fixedItems: {},           // 已购固定价采购项
      hangarLease: null,        // 机库租赁 {pricePerMonth}
    },
    marketParams: {},            // 市场级参数 {code: {fuelPrice, demandMult}}
    demandMult: {},                // 市场级需求倍数（事件）
    demandMultUntil: {},          // 需求倍数到期回合
    marketStatus: {},             // 市场级事件状态
    utilCap: {},                  // 机型级利用上限（冰雹）
    groundUntil: {},              // 停飞至第几回合
    aircraft: [],                  // {id, type, owned, price, acquiredTurn, age, seats...}
    routes: [],                   // 已开通航线 {code, fare, openedTurn, etopsPaid}
    schedules: [],                // 本回合航班 {acId, code, flightNo, departure, bh}
    investments: [],              // {id, name, kind:'airline'|'fleet'|'route', code, amount}
    assets: [],                   // {id, name, price, code}
    investmentsAnnual: [],        // 持续投放中的年度投资
    proposals: [],                // 待裁判确认的提案
    proposals: [],                // 待裁判确认的提案
    history: [],                   // 每回合报告
    log: [],
    pendingEvent: null,
  };
  // 起始机队：G160 + APT100（与原版 CA 一致，Fleet Plans Q0：G160 159 + APT100 100 = 260 座）
  // 按**官方目录价**入账（Cost Data 2022 v5：APT100 $40M / G160 $95.04M）
  g.aircraft.push(mkAc(g, 'APT100', true, 40000000, 0, 6, 1));
  /* ★ 原版初始条件：一架 APT100 正常机龄 + 一架 G160XLR **机龄过大**（18 年）
     → 何时大修由**裁判**决定（团队自决是否处置）；机龄对学员可见，作为风险提示 */
  g.aircraft.push(mkAc(g, 'G160',   true, 95040000, 0, 18, 2));
  // 起始贷款：12 年期等额本金（本金 $71,427,040，由 CA 季息反推）
  g.loans = [{
    id: 'L1', principal: GM.start_loan, balance: GM.start_loan,
    rate: LOAN.rate_annual, quartersLeft: LOAN.quarters,
    quarterlyPrincipal: GM.start_loan / LOAN.quarters,
    quarterlyInterest: GM.start_loan * (LOAN.rate_annual / 100) / 4,
    quarterlyRepay: 0,
  }];
  // 首季还款额（含息口径）立即可算，供 UI 显示
  for (const l of g.loans) l.quarterlyRepay = l.quarterlyPrincipal + l.quarterlyInterest;
  // 起始航线：Simone（已开通）
  /* 初始航线：Simone + Ellington（原版 CA Q4/2027 即经营此两条，
     见 Reports-ROUTE METRICS：SIM 540 班/季、ETN 360 班/季） */
  g.routes.push({ code: 'SIM', fare: 120, openedTurn: 0, etopsPaid: false });
  g.routes.push({ code: 'ETN', fare: 250, openedTurn: 0, etopsPaid: false });
  initCompetitors(g, seed);
  return g;
}

function mkAc(g, type, owned, price, acquiredTurn, age, id) {
  const t = AIRCRAFT.find(a => a.name === type);
  return {
    id: id ?? (g.__acSeq = (g.__acSeq || 0) + 1), type, owned,
    price, acquiredTurn, age: age ?? 0,
    seats: t.seats, eco: t.eco, prem: t.prem, biz: t.biz,
    mtow: t.mtow, fuel: t.fuel, dmc_c: t.dmc_c, dmc_fh: t.dmc_fh, long: t.long,
    cargo: t.cargo ?? 0, cab_min: t.cab_min ?? 1,
    nickname: owned ? 'Owned' : 'Leased',
  };
}

/**
 * 飞机大修（heavy check）
 *   规则：完成大修的飞机只需运营上季一半的 block hours（实例：4.76 BH）
 *   经济性：完成大修后出售比直接卖多 $500,000（实例：$9,473,500）
 *   期间飞机仍可少量运营（实例：G160 保留 1 班/日飞 Lewis）
 */
export function startHeavyCheck(g, acId) {
  const ac = g.aircraft.find(a => a.id === acId);
  if (!ac) return { ok: false, why: '找不到飞机' };
  if (!ac.owned) return { ok: false, why: '租赁飞机不可大修' };
  g.negotiation.heavyCheck = g.negotiation.heavyCheck || {};
  if (g.negotiation.heavyCheck[acId]) return { ok: false, why: '该飞机已在做大修' };
  const lastBH = g.__lastBH?.[acId] || 0;
  const allowed = Math.floor(lastBH * 0.5 * 100) / 100;   // 允许运营上季一半 BH
  g.negotiation.heavyCheck[acId] = { done: false, bhUsed: 0, bhAllowed: allowed, startedTurn: g.turn };
  g.log.push(`开始大修 ${ac.type}：本季仅允许运营 ${allowed} BH，完成后出售溢价 $${Math.round(500000).toLocaleString()}`);
  return { ok: true, bhAllowed: allowed, resalePremium: 500000 };
}

/** 出售飞机：完成大修的按溢价计 */
export function sellAircraft(g, acId, price) {
  const idx = g.aircraft.findIndex(a => a.id === acId);
  if (idx < 0) return { ok: false, why: '找不到飞机' };
  const ac = g.aircraft[idx];
  if (!ac.owned) return { ok: false, why: '租赁飞机不可出售' };
  const hc = g.negotiation?.heavyCheck?.[acId];
  const premium = hc && hc.done ? 500000 : 0;
  const total = price + premium;
  g.cash += total;
  g.aircraft.splice(idx, 1);
  g.schedules = g.schedules.filter(s => s.acId !== acId);
  if (hc) delete g.negotiation.heavyCheck[acId];
  g.log.push(`出售 ${ac.type}：$${Math.round(price).toLocaleString()}` + (premium ? `（含大修溢价 $${Math.round(premium).toLocaleString()}）` : ''));
  return { ok: true, total, premium };
}

/**
 * 谈判额度：每回合每组可用的谈判次数上限（裁判设定）。
 * 教学意义：真实谈判有成本与边界，不能什么都谈、无限次谈。
 * 额度用尽后新的谈判请求被拒绝并提示。
 */
export function negotiationBudget(g) {
  return g.negotiation?.budgetLimit ?? null;   // null = 不限
}
export function consumeNegotiationBudget(g, what) {
  const n = g.negotiation;
  n.budgetUsed = n.budgetUsed || 0;
  const limit = negotiationBudget(g);
  if (limit != null && n.budgetUsed >= limit) {
    return { ok: false, why: `本回合谈判额度已用尽（${n.budgetUsed}/${limit}），下回合恢复` };
  }
  n.budgetUsed++;
  g.log.push(`谈判额度使用 ${n.budgetUsed}${limit != null ? '/' + limit : ''}：${what}`);
  return { ok: true, used: n.budgetUsed, limit };
}

/* ============================================================
   提案机制（治理原则：小组只能发起，最终生效必须由裁判在裁判端确认）
   ------------------------------------------------------------
   真实游戏中，飞机可以卖回裁判（价格由裁判的回购报价给出）；
   卖给别组也符合市场逻辑，但**必须报与裁判修改，不能小组自行修改**。
   ⇒ 所有涉及"改动别组 / 改动市场规则 / 豁免罚则"的诉求，
     都走 proposal：小组发起 → 裁判审批（可修改参数）→ 才真正生效。
   ============================================================ */

/** 提案类型目录（裁判端审批面板按此渲染） */
export const PROPOSAL_KINDS = {
  sell_to_group:   { label: '飞机转让给其它小组', scope: 'crossGroup',
                     fields: [{k:'acId',t:'ac'}, {k:'toSeat',t:'seat'}, {k:'price',t:'money'}] },
  heavy_check:     { label: '飞机大修',           scope: 'own',
                     fields: [{k:'acId',t:'ac'}] },
  cabin_extra_crew:{ label: '公务舱额外乘务员',   scope: 'own',
                     fields: [{k:'acId',t:'ac'}] },
  catering_consistent: { label: '全航线餐饮统一', scope: 'own', fields: [] },
  event_exemption: { label: '事件罚则豁免 + 替代机顶班', scope: 'own',
                     fields: [{k:'acId',t:'ac'}, {k:'replacementAcId',t:'ac'}] },
  themed_op:       { label: '主题化运营（辅营收费）', scope: 'own',
                     fields: [{k:'acId',t:'ac'}, {k:'name',t:'text'}, {k:'feePerPax',t:'num'}, {k:'qsiBonus',t:'num'}] },
  fixed_price_item:{ label: '固定价采购项',       scope: 'own',
                     fields: [{k:'itemId',t:'text'}] },
  hangar_lease:    { label: '机库租赁',           scope: 'own',
                     fields: [{k:'pricePerMonth',t:'num'}] },
};

/** 小组发起提案（不改变任何运营状态） */
export function propose(g, kind, payload = {}, note = '') {
  const spec = PROPOSAL_KINDS[kind];
  if (!spec) return { ok: false, why: '未知提案类型: ' + kind };
  g.proposals = g.proposals || [];
  const id = 'pr-' + (g.proposals.length + 1) + '-' + Date.now().toString(36).slice(-4);
  const pr = { id, kind, seat: g.seat, payload: { ...payload }, note,
                status: 'pending', createdTurn: g.turn, createdAt: new Date().toISOString() };
  g.proposals.push(pr);
  g.log.push(`发起提案待裁判确认：${spec.label}${note ? '（' + note + '）' : ''}`);
  return { ok: true, proposal: pr };
}

/**
 * 裁判审批提案：可修改参数后批准，批准才真正生效。
 */
export function resolveProposal(g, id, action, modify = {}) {
  const pr = (g.proposals || []).find(x => x.id === id);
  if (!pr) return { ok: false, why: '提案不存在' };
  if (pr.status !== 'pending') return { ok: false, why: '提案已处理' };
  if (action === 'reject') {
    pr.status = 'rejected';
    pr.resolvedBy = 'judge';
    pr.resolvedAt = new Date().toISOString();
    g.log.push(`裁判驳回提案：${PROPOSAL_KINDS[pr.kind]?.label || pr.kind}`);
    return { ok: true, proposal: pr };
  }
  const payload = { ...pr.payload, ...modify };
  pr.payload = payload;
  pr.status = 'approved';
  pr.resolvedBy = 'judge';
  pr.resolvedAt = new Date().toISOString();
  const applied = applyProposal(g, pr.kind, payload);
  if (!applied.ok) { pr.status = 'failed'; return applied; }
  g.log.push(`裁判批准提案：${PROPOSAL_KINDS[pr.kind]?.label || pr.kind}`);
  return { ok: true, proposal: pr, applied };
}

/** 执行已批准的提案 */
function applyProposal(g, kind, payload) {
  const n = g.negotiation = g.negotiation || {};
  switch (kind) {
    case 'heavy_check': {
      const r = startHeavyCheck(g, Number(payload.acId));
      return r.ok ? r : { ok: false, why: r.why };
    }
    case 'cabin_extra_crew': {
      n.cabinExtraCrew = n.cabinExtraCrew || {};
      n.cabinExtraCrew[Number(payload.acId)] = true;
      return { ok: true };
    }
    case 'catering_consistent': {
      n.cateringConsistent = true;
      return { ok: true };
    }
    case 'event_exemption': {
      n.exemptions = n.exemptions || {};
      n.exemptions[Number(payload.acId)] = {
        noFine: true,
        replacementAcId: payload.replacementAcId ? Number(payload.replacementAcId) : null,
        grantedTurn: g.turn,
      };
      g.log.push(`裁判批准：${acLabel(g, payload.acId)} 享罚则豁免`
        + (payload.replacementAcId ? `，由 ${acLabel(g, payload.replacementAcId)} 顶班` : ''));
      return { ok: true };
    }
    case 'themed_op': {
      n.themedOps = n.themedOps || {};
      n.themedOps[Number(payload.acId)] = {
        name: payload.name || '主题航班',
        feePerPax: Number(payload.feePerPax) || 0,
        qsiBonus: Number(payload.qsiBonus) || 0,
      };
      return { ok: true };
    }
    case 'fixed_price_item': {
      n.fixedItems = n.fixedItems || {};
      n.fixedItems[payload.itemId] = true;
      return { ok: true };
    }
    case 'hangar_lease': {
      n.hangarLease = { pricePerMonth: Number(payload.pricePerMonth) || 0 };
      return { ok: true };
    }
    case 'sell_to_group': {
      // 转让给别组：必须由裁判批准后执行（小组不得自行改动别组数据）
      const acId = Number(payload.acId);
      const toSeat = payload.toSeat;
      const price = Number(payload.price) || 0;
      const idx = g.aircraft.findIndex(a => a.id === acId);
      if (idx < 0) return { ok: false, why: '找不到飞机' };
      if (!g.aircraft[idx].owned) return { ok: false, why: '租赁飞机不可转让' };
      const target = g.__seatTarget;   // 由 server 注入目标席位
      if (!target) return { ok: false, why: '目标席位不存在' };
      if (target.seat === g.seat) return { ok: false, why: '不能转让给本组' };
      if (target.cash < price) {
        return { ok: false, why: `目标组现金不足（需 $${price.toLocaleString()}，现有 $${Math.round(target.cash).toLocaleString()}）` };
      }
      const ac = g.aircraft[idx];
      g.aircraft.splice(idx, 1);
      g.schedules = g.schedules.filter(s => s.acId !== acId);
      g.cash += price;
      target.aircraft.push({ ...ac, acquiredTurn: target.turn, price });
      target.cash -= price;
      g.log.push(`飞机转让：${ac.type} -> ${toSeat}，$${price.toLocaleString()}`);
      return { ok: true };
    }
    default:
      return { ok: false, why: '未实现的提案类型: ' + kind };
  }
}

function acLabel(g, acId) {
  const a = g.aircraft.find(x => x.id === Number(acId));
  return a ? a.type : '飞机';
}

/** 某架飞机是否享有事件罚则豁免 */
export function hasExemption(g, acId) {
  return !!(g.negotiation?.exemptions || {})[Number(acId)];
}

/** 主题化运营的每旅客额外收费 */
export function themedFee(g, acId, pax) {
  const op = (g.negotiation?.themedOps || {})[Number(acId)];
  return op ? op.feePerPax * pax : 0;
}

/* ---------------- 湿租 ---------------- */
/**
 * 租赁一架飞机（wet lease）。
 * 与自有机的差别：
 *   · 不进 ownPrice → 不计折旧/利息/保险（那些是自有机的持有成本）
 *   · 租金走 financing 流出（季度租金）
 *   · 付押金（可退，计入 oneoff 之外的现金占用）
 *   · 真实游戏可买断（buy-out）
 */
/**
 * 机队融资通道：借款上限 = 自有资产净值 × loan_max_ratio；需规则 financingChannel 开启
 * 返回 { ok, why, amount }
 */
export function fleetFinancingQuota(g) {
  const ownedValue = (g.aircraft || []).filter(a => a.owned).reduce((a, x) => a + x.price, 0);
  const debt = (g.loans || []).filter(l => l.channel === 'fleet').reduce((a, l) => a + l.balance, 0);
  return Math.max(0, ownedValue * (GM.loan_max_ratio || 0.7) - debt);
}

/** 借款：注入现金并计入负债（利息随结算计入运营成本） */
export function borrowFleet(g, amount) {
  if (!isRuleOn(g, 'financingChannel')) return { ok: false, why: '融资通道未开放（自 Q2 赛季起）' };
  const quota = fleetFinancingQuota(g);
  const amt = Math.min(Number(amount) || 0, quota);
  if (amt <= 0) return { ok: false, why: `融资额度已用尽（上限 $${Math.round(quota).toLocaleString()}）` };
  g.cash += amt;
  g.loans = g.loans || [];
  g.loans.push({
    principal: amt, balance: amt, rate: effParams(g).interestRate ?? GM.interest_rate,
    quarters: GM.loan_term_quarters || 48, channel: 'fleet', startTurn: g.turn,
  });
  g.log.push(`机队融资借款 $${Math.round(amt).toLocaleString()}（额度上限 $${Math.round(quota).toLocaleString()}，剩余 ${Math.round(quota - amt).toLocaleString()}）`);
  return { ok: true, amount: amt };
}

export function leaseAircraft(g, typeName, opts = {}) {
  const t = AIRCRAFT.find(a => a.name === typeName);
  if (!t) return { ok: false, why: '未知机型' };
  const price = t.price * 1e6;
  const leaseType = opts.leaseType || g.negotiation?.leaseType || 'wet';
  // ★ 折扣可谈（真实实例：P3 原价 1.06 亿 → 20% 折扣；APT100 40 万/月 → 32 万/月）
  const discount = opts.discount != null ? Number(opts.discount)
                    : (g.negotiation?.leaseDiscount != null ? g.negotiation.leaseDiscount : 0);
  /* ★ 课程裁定 A（2026-11-03）：首季允许「赊机」——押金免预付、首期租金后付
     → 签约现金门槛 = 0；租金仍按**全额**计入营业成本并在结算时支付
        （经济实质不变，只解决现金流门槛：保留「初始资产不变」的公平起点） */
  const deposit = 0;                                  // 押金免预付（可抵扣租金的后续形态预留）
  const rentQ = price * (leaseType === 'dry' ? GM.lease_rate_annual_dry : GM.lease_rate_annual) / 4 * (1 - discount);
  const ac = {
    id: (g.__acSeq = (g.__acSeq || g.aircraft.length) + 1), type: typeName, owned: false,
    price, acquiredTurn: g.turn, age: 0, seats: t.seats, eco: t.eco, prem: t.prem, biz: t.biz,
    mtow: t.mtow, fuel: t.fuel, dmc_c: t.dmc_c, dmc_fh: t.dmc_fh, long: t.long,
    cargo: t.cargo ?? 0, cab_min: t.cab_min ?? 1, nickname: 'Leased',
  };
  g.aircraft.push(ac);
  g.leases = g.leases || [];
  g.leases.push({
    acId: ac.id, type: typeName, deposit, quarterlyRent: rentQ, rentDeferred: true,
    monthsLeft: GM.lease_min_months, startTurn: g.turn,
    leaseType, discount, flexibleReturn: true,   // ★ 租期内随时可退，不额外收费
  });
  g.log.push(`${leaseType === 'dry' ? '干租' : '湿租'} ${typeName}：押金 $${Math.round(deposit).toLocaleString()} + 季租 $${Math.round(rentQ).toLocaleString()}${discount ? `（折扣 ${(discount*100).toFixed(0)}%）` : ''}`);
  return { ok: true, ac, deposit, rentQ };
}

/** 买断一架租赁中的飞机 */
export function buyOutLease(g, acId) {
  const l = (g.leases || []).find(x => x.acId === acId);
  if (!l) return { ok: false, why: '该飞机不是租赁' };
  const ac = g.aircraft.find(a => a.id === acId);
  if (!ac) return { ok: false, why: '找不到飞机' };
  const t = AIRCRAFT.find(a => a.name === ac.type);
  const buyout = (t ? t.price * 1e6 : ac.price) * GM.lease_buyout_rate;
  if (g.cash < buyout) return { ok: false, why: `现金不足（买断价 $${Math.round(buyout).toLocaleString()}）` };
  g.cash -= buyout;
  g.cash += l.deposit;                 // 退还押金
  ac.owned = true;
  ac.price = t ? t.price * 1e6 : ac.price;
  g.leases = g.leases.filter(x => x.acId !== acId);
  g.log.push(`买断 ${ac.type}：$` + Math.round(buyout).toLocaleString() + `（押金已退）`);
  return { ok: true, buyout };
}

/**
 * 机队—航线匹配预警。
 *
 * ★ 真实教学点（谈判纪要原话）：
 *   "You will lose money if you fly to Simone with it."
 *   "make sure that on the route you're flying a big plane, there are enough
 *    passengers to the market, a good load factor, the demand of the market."
 *
 * 判据：用该市场的**日潜在运量**（情报值，dailyPax）对比该机型的**日座位数**。
 * 若机型日座位 >> 市场日潜在运量 → 即使满座也卖不满 → 客座率结构性偏低。
 */
export function fleetRouteWarning(g, ac, code) {
  const m = MARKETS[code];
  const intel = (g.negotiation?.intel || {})[code];
  const im = intel ? (MARKET_INTEL[code] || null) : null;   // 按市场 code 索引
  const daily = im && (im.dailyPaxLow || im.dailyPaxHigh)
    ? ((im.dailyPaxLow || 0) + (im.dailyPaxHigh || 0)) / 2 : null;
  const seats = ac?.seats || 0;
  if (!daily || !seats) return null;
  const ratio = seats / daily;                 // 供给 / 需求
  if (ratio < 1.2) return null;                 // 供给不超过需求，无风险
  return {
    seats, dailyPax: daily, ratio,
    message: `${ac.type}（${seats} 座/日）投入 ${m?.name_c || code}：`
      + `该市场日潜在运量约 ${Math.round(daily)} 人，机型供给为其 ${ratio.toFixed(1)} 倍，`
      + `即使满座客座率也仅约 ${(daily / seats * 100).toFixed(0)}%，大概率亏损`
      + `（纪要："You will lose money if you fly to Simone with it."）`,
  };
}

/* ---------------- 回合准备 ---------------- */
/* ── 生效参数：谈判条款优先于全局设置 ── */
export function effParams(g) {
  const n = g.negotiation || {};
  return {
    fuelPrice: n.fuelPrice ?? g.fuelPrice,
    carbonPrice: n.carbonPrice ?? g.carbonPrice,
    interestRate: n.interestRate ?? g.interestRate,
    connectingDemand: n.connectingDemand ?? g.connectingDemand,
    insuranceRate: n.insuranceRate ?? GM.insurance_rate,
  };
}

/**
 * 生效燃油价（考虑燃油套保）。
 * 套保结构：{price 锁定价, share 覆盖比例, quarters 剩余季度}
 * 生效价 = share × 锁定价 + (1−share) × 现货价（按剩余季度加权）
 */
/**
 * 本季是否开放燃油套保谈判。
 * 真实机制（执行过程报告 §5.1）：Q3 末裁判以「当季油价极高」为由**不提供套保**，
 * 建议下一窗口为 Q5 为 Q6 锁价 → 裁判对窗口有单方决定权（已签套保不受影响）。
 */
export function hedgeWindowOpen(g) {
  return g.hedgeWindowOpen !== false;
}

export function effFuelPrice(g, marketCode = null) {
  const n = g.negotiation || {};
  // 生效现货价优先级：市场级（裁判逐市场设定） > 定向（谈判） > 系统派生（基准 + 长程加价）
  const base = n.fuelPrice ?? g.fuelPrice;
  const m = marketCode ? MARKETS[marketCode] : null;
  const derived = (m && m.sector_km >= GM.fuel_long_haul_km)
    ? base + GM.fuel_long_haul_premium : base;
  const spot = marketCode && g.marketParams?.[marketCode]?.fuelPrice != null
    ? g.marketParams[marketCode].fuelPrice
    : derived;
  // ★ 真实机制：两档固定方案，不是连续可谈的锁定价
  //   swap（$5万）：结算价双向固定 strike
  //   call（$35万）：结算价上限 strike，低于则按市价
  const h = (n.fuelHedge || []).find(x => (x.quarters ?? 0) > 0);
  if (!h) return spot;
  return hedgeSettlePrice(h, spot);
}

/** 套保结算价：swap 双向锁定 / call 封顶 / collar 走廊；share<1 时按覆盖比例加权 */
export function hedgeSettlePrice(h, spot) {
  const share = h.share == null ? 1 : Math.max(0, Math.min(1, Number(h.share)));
  let settle;
  if (h.product === 'collar') {
    const lo = h.floor ?? -Infinity, hi = h.strike ?? Infinity;
    settle = Math.max(lo, Math.min(hi, spot));
  } else if (h.cap) {
    settle = Math.min(spot, h.strike);           // 看涨：封顶
  } else {
    settle = h.strike;                           // 互换：双向锁定
  }
  return spot * (1 - share) + settle * share;    // 未覆盖部分仍按市价
}

/** 该航司本季预计燃油加仑（按排班推算，供比价用） */
export function forecastGallons(g) {
  let gal = 0;
  for (const s of (g.schedules || [])) gal += E.F08_GAL(s.bh || 0) * 90;
  return gal;
}

/**
 * 三方报价比价（统一可比字段）：
 *   每份报价 → 各情景下的覆盖量、结算价、套保后成本 → 加权期望成本 → 折算「每加仑成本」
 *   附：最低加仑量是否满足、预付要求、杠杆、是否含信用保护
 */
export function hedgeQuoteComparison(g, quotes, scenarios, spotPrice) {
  const spot = spotPrice ?? (g.fuelPrice ?? 2.4);
  const gal = forecastGallons(g);
  const rows = (quotes || []).map(q => {
    const covered = gal * (q.share ?? 1);
    const feasible = (q.minGallons || 0) <= covered;
    let exp = 0, perScenario = [];
    for (const sc of (scenarios || [])) {
      const mkt = spot * sc.priceFactor;
      const h = { strike: q.strike, floor: q.floor, cap: q.product === 'call', product: q.product, share: q.share ?? 1 };
      const settle = hedgeSettlePrice(h, mkt);
      const coverCost = covered * settle + covered * (q.varPerGal || 0);
      const fixed = (q.fixedFeePerQuarter || 0) * (q.quarters || 1);
      const total = coverCost + fixed + (q.upfront || 0);
      perScenario.push({ key: sc.key, label: sc.label, market: +mkt.toFixed(4), settle: +settle.toFixed(4),
                         coveredGal: Math.round(covered), cost: Math.round(total), weight: sc.weight });
      exp += sc.weight * total;
    }
    return {
      id: q.id, supplier: q.supplier, product: q.product, terms: q.terms,
      strike: q.strike, floor: q.floor, share: q.share, quarters: q.quarters,
      upfront: q.upfront, fixedFeePerQuarter: q.fixedFeePerQuarter, varPerGal: q.varPerGal,
      prepayRate: q.prepayRate, minGallons: q.minGallons, creditSupport: q.creditSupport, leverage: q.leverage,
      feasible, forecastGal: Math.round(gal), coveredGal: Math.round(covered),
      expectedCost: Math.round(exp), costPerGal: +(exp / Math.max(gal, 1)).toFixed(4),
      unhedgedCost: Math.round(gal * spot), savingVsSpot: Math.round(gal * spot - exp),
      scenarios: perScenario,
    };
  });
  rows.sort((a, b) => (a.feasible === b.feasible ? a.costPerGal - b.costPerGal : (a.feasible ? -1 : 1)));
  return { forecastGallons: Math.round(gal), spotPrice: spot, rows };
}

/** 本回合可领取的航线补贴合计 */
export function effSubsidy(g) {
  const s = g.negotiation?.subsidies || {};
  return Object.values(s).reduce((a, x) => a + (x || 0), 0);
}

/** 某市场是否有已购情报（决定参数可见性与事件预警） */
export function hasIntel(g, code) {
  return !!(g.negotiation?.intel || {})[code];
}

/** 当前生效参数（含谈判覆盖），供 UI 展示 */
export function currentPeriod(g) {
  const idx = g.turn + GM.base_quarter;
  const year = GM.base_year + Math.floor(idx / 4);
  const q = (idx % 4) + 1;
  return { year, q, label: `Q${q} ${year}` };
}

export function maxBH(g) { return GM.max_bh; }

/** 单机每回合可排班上限 */
export function acCapacity(g, ac) {
  // 短程 775 BH/季，长程 900 BH/季（由真实排班反推验证）
  // 事件限飞（如冰雹）会进一步压低：utilCap 存 {bh, turnsLeft}
  const base = ac.long ? GM.max_bh : GM.flight_crew_max_bh;
  const c = g.utilCap[ac.type];
  const lim = c == null ? null : (typeof c === 'number' ? c : c.bh);
  const cap = lim == null ? base : Math.min(base, lim);
  return Math.min(cap, GM.max_bh);
}

/** 某回合该机队已排的 BH */
export const DAYS_PER_QUARTER = 90;

export function acUsedBH(g, acId) {
  // 每条排班 = 每日 1 班；季度 BH = 日 BH × 90
  return g.schedules.filter(s => s.acId === acId)
    .reduce((a, s) => a + s.bh, 0) * DAYS_PER_QUARTER;
}

export function turnaroundFor(ac, code, g = null) {
  const m = MARKETS[code];
  const isLH = !!ac.long;   // ★ 只按机型能力判定（航段距离不作数）：ETN 1150km 由 SR 型执飞 → 走短程过站基线
  if (isLH) return GM.lh_turnaround;        // 长程过站时间固定，不可调整
  // ★ 短程可谈判：45 分钟档（免费、保留货运）/ 30 分钟档（须放弃货运）
  // ★ 按经营定位的过站基线（强约束）与允许档位
  const style = (g && g.style) || 'Hybrid';
  const base = (GM.style_turnaround && GM.style_turnaround[style]) || GM.sh_turnaround;
  const opts = (GM.style_turnaround_options && GM.style_turnaround_options[style]) || [GM.sh_turnaround, 60];
  const neg = g && g.negotiation ? g.negotiation.turnaroundMin : null;
  if (neg != null && opts.includes(Number(neg)) && Number(neg) >= base) return Number(neg);
  return base;
}

export function canAddFlight(g, ac, code, departure = '09:00') {
  const m = MARKETS[code];
  if (!m) return { ok: false, why: '未知市场' };
  const route = g.routes.find(r => r.code === code);
  if (!route) return { ok: false, why: '航线未开通' };
  if (m.etops && !route.etopsPaid) return { ok: false, why: '需要 ETOPS 运营许可' };
  if (g.groundUntil[ac.id] && g.groundUntil[ac.id] > g.turn) return { ok: false, why: '飞机停飞中' };
  const bh = m.bh;                           // 单班 BH（=报表 ADU/日班次）
  if (acUsedBH(g, ac.id) + bh * DAYS_PER_QUARTER > acCapacity(g, ac)) {
    return { ok: false, why: `超出本回合利用小时上限 (${acCapacity(g, ac)} BH)` };
  }
    const longHaul = !!ac.long;
  const acSchedules = g.schedules.filter(x => x.acId === ac.id);   // ★ 提前声明（过站约束要用）
const turn = turnaroundFor(ac, code, g);
  const depNew = mins(departure);
  const bhMin = bh * 60;
  /* ★ 过站时间是强约束：该机当日可容纳的班次数由「可用时段 − 往返」÷（往返 + 过站）反算
     短程可用时段 06:00–22:00（16h）；长程过夜 → 1 班/日
     → 过站时间越长，同机日班次上限越低（教学：全服务的保障时间直接吃掉运力） */
  const dayWindowH = longHaul ? 24 : 16;
  const perFlightH = 2 * bh + turn / 60;
  /* 单程口径：一班占用 = 往返(2×bh) + 过站 */
  /* 一班占用 = 推出 + 空中(bh) + 撤轮档 */
  const occH = bh + (GM.taxi_out_min || 0) / 60 + (GM.taxi_in_min || 0) / 60;
  const maxByTurn = longHaul ? 1 : Math.max(0, Math.floor((dayWindowH - occH) / (occH + turn / 60)));
  const maxPerDay = Math.min(longHaul ? 1 : 2, maxByTurn);
  if (acSchedules.length >= maxPerDay)
    return { ok: false, why: `该机每日最多 ${maxPerDay} 班（过站 ${turn} 分钟、航段 ${bh}h 下的运力上限；长程 1 班/日）` };
  /* 过夜规则（演练规则原文）：
     「所有飞机每晚必须返回基地枢纽，除非使用具备过夜能力的特定长程机型」
     → 短程：06:00 之后起飞、22:00 前必须回到基地（同日往返）
     → 长程（航段 ≥1000km 或具备远程能力）：**允许过夜**，不检查当日返航，
        但相邻班次的间隔须 ≥ 往返时长 + 过站时间（过夜后次日才归位） */
  /* 过夜资格 = **机型能力**（ac.long：远程机型 G160XLR/G200LR/G250/APT300）
     ⚠ 不可用航段距离判定：Ellington 1150km 由 **SR 型** G160 执飞，
       原版 CA 在其上飞 4 班/日 → 1150km 并非过夜航线 */
  /* ★ 课程裁定（2026-11-03）：短程机型每日 **2 班**，长程每日 1 班（过夜）
     同一模型的每条排班 = 该机每日 1 班 → 故「该机排班条数」= 每日班次数
     ⚠ 回程约束：两班之间必须留出去-回-周转的完整时间（2×BH + turn） */
  if (!longHaul) {
    // 推出时刻 = 轮挡起飞 − taxi_out，须 ≥ 06:00；落地 + 撤轮档须 ≤ 22:00
    if (depNew < 6 * 60)
      return { ok: false, why: `起点过早（${minToHHMM(6 * 60)} 之前不能开始滑行）` };
    if (depNew + (GM.taxi_out_min || 0) + bhMin + (GM.taxi_in_min || 0) > 22 * 60)
      return { ok: false, why: `无法当日返航（起点最晚 ${minToHHMM(22 * 60 - (GM.taxi_out_min || 0) - bhMin - (GM.taxi_in_min || 0))}，含滑行与清洁保障前的到达时间）` };
  }
  // 过站/过夜间隔：短程与长程均需 **往返 + 周转**（回程约束，避免同机同时出现在两地）
  /* ★ bh = **单程** Block Hours（核查见 rebuild/audit_route_time.mjs：
     APT100/SIM 1.13h 单程 → 隐含巡航 465 km/h；G160XLR/GEE 6.82h → 772 km/h → 全部落在合理区间）
     → 同机两班最小间隔 = 去-回-周转 = 2×BH + 周转 */
  /* ★ 同机两班最小间隔（去-回-周转，两端含地滑与撤轮档）：
       taxi_out + bh + taxi_in + turn + taxi_in + bh + taxi_out */
  const taxiOut = GM.taxi_out_min || 0, taxiIn = GM.taxi_in_min || 0;
  /* ★ 学员填的是**起点**（撤轮档完成、开始滑行）→ 到达(廊桥) = 起点 + 滑行 + 飞行 + 滑行到廊桥
     两班起点间隔 = (滑行 + 飞行 + 滑行到廊桥) + 清洁保障 */
  const minGap = taxiOut + bhMin + taxiIn + turn;
  for (const s of g.schedules.filter(x => x.acId === ac.id)) {
    if (Math.abs(depNew - mins(s.departure)) < minGap) {
      return { ok: false, why: `过站时间不足 ${Math.round(minGap)} 分钟` };
    }
  }
  return { ok: true, bh };
}

/** 某机在某航线的可行日班次上限（受 BH、过站、当日返航窗口约束） */
export function maxDailyFlights(g, ac, code) {
  const m = MARKETS[code];
  if (!m) return 0;
  const turn = turnaroundFor(ac, code, g);
  const bhMin = m.bh * 60;
  const lastDep = 22 * 60 - 2 * bhMin - turn;
  const firstDep = 6 * 60;
  if (lastDep < firstDep) return 0;
  // 时间窗内可容纳的班次数
  const byTime = Math.floor((lastDep - firstDep) / (bhMin + turn)) + 1;
  const room = acCapacity(g, ac) - acUsedBH(g, ac.id);
  const byBh = Math.floor(room / (m.bh * DAYS_PER_QUARTER));
  return Math.max(0, Math.min(byTime, byBh));
}

function mins(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

/* ---------------- 回合结算 ---------------- */
/**
 * 市场需求的竞争分配（玩家与竞品共用同一份份额，消除重复计量）。
 * 在竞品决策完成之后调用，结果挂在 g.__alloc 上供双方使用。
 */
export function allocateMarkets(g) {
  const alloc = {};
  const codes = new Set(g.routes.map(r => r.code));
  for (const c of (g.competitors || [])) for (const r of (c.routes || [])) codes.add(r.code);
  for (const code of codes) {
    const m = MARKETS[code];
    if (!m) continue;
    const mult = g.demandMult[code] ?? 1;
    const airlines = [];
    // 玩家
    const r = g.routes.find(x => x.code === code);
    const fl = g.schedules.filter(s => s.code === code &&
      !(g.groundUntil[s.acId] && g.groundUntil[s.acId] > g.turn));
    if (r && fl.length) {
      airlines.push({
        key: 'player', fare: r.fare, freq: fl.length * DAYS_PER_QUARTER,
        qsi: g.qsi, brand: 0,
        slots: fl.map(s => hhmmToMin(s.departure)),   // 起飞时刻 → 市场运营小时基准
      });
    }
    // 竞品
    for (const c of (g.competitors || [])) {
      const cr = (c.routes || []).find(x => x.code === code);
      const cfl = (c.schedules || []).filter(s => s.code === code);
      if (cr && cfl.length) {
        airlines.push({
          key: c.code || ('comp' + (c.id || 0)), fare: cr.fare,
          freq: cfl.length * DAYS_PER_QUARTER, qsi: c.qsi || 0, brand: 0,
          slots: cfl.map(s => hhmmToMin(s.departure)),   // 对手的班次时刻同样计入基准
        });
      }
    }
    if (airlines.length) alloc[code] = E.allocateMarket(m.name, airlines, mult);
  }
  g.__alloc = alloc;
  return alloc;
}

/** 因停飞（冰雹等事件）而必须作废的班次 —— 事件对各家的影响因此不对称 */
export function dropGroundedSchedules(g) {
  const drop = g.schedules.filter(s =>
    g.groundUntil[s.acId] && g.groundUntil[s.acId] > g.turn);
  if (!drop.length) return [];
  const ids = new Set(drop.map(s => s.acId));
  g.schedules = g.schedules.filter(s => !ids.has(s.acId));
  for (const s of drop) {
    g.log = g.log || [];
    g.log.push(`⚠ ${s.acId} 因事件停飞，作废 ${s.code} 的 ${s.departure} 班次`);
  }
  return drop;
}

/**
 * 经营失败收口（方案 C）：① 现金为负 → 强制退租赁（可退不罚，退还押金）② 仍资不抵债 → 破产清算
 * 返回 { reduced: [...], bankrupt: bool }
 */
/**
 * 扩张测算（组合式）：拟增 n 架飞机后的季度收入/成本/盈亏平衡 LF
 *   · 收入：新增运力可承运的旅客 × 运价（受该航线「市场总需求 × 我方份额」约束）
 *   · 变动成本：燃油 + 机组 + 维护（按新增班次）
 *   · 固定成本：利息（自有）+ 折旧（自有）
 * 用途：小组端「扩张测算器」与回测 Agent 的扩张判据共用同一逻辑
 */
export function estimateScale(g, n, price = 40000000, fareRatio = 1) {
  const d = g.lastDetail || {};
  const codes = Object.keys(d);
  const seats = 100, perDay = 2, days = 90;
  const detailRows = [];
  let rev = 0, varCost = 0;
  for (const code of codes) {
    const x = d[code];
    const r = (g.routes || []).find(q => q.code === code); if (!r) continue;
    const lf = x.lf || 0;
    const share = x.share != null ? x.share : 1;
    /* 票价调整 → 需求按价格弹性变化：eps = 1 + 0.05 × 该市场 elasticity（engine.js 同口径）
       需求 D ∝ fare^(-eps) → 调整比例 fareRatio 后需求 × fareRatio^(-eps) */
    const mk = MARKETS[code] || {};
    const eps = 1 + 0.05 * (mk.elasticity || 1);
    const demAdj = Math.pow(Math.max(fareRatio, 1e-6), -eps);
    const want = (x.marketDemand || 0) * demAdj * share;   // 该航线我方可争取的季度旅客
    const extraFlights = (n / Math.max(1, codes.length)) * perDay * days;
    const cap = extraFlights * seats;
    const served = Math.min(cap, want);
    const revenue = served * r.fare * fareRatio;
    /* ★ 每班次运营成本：用该航线**历史实际**反推（季度总额 ÷ 季度班次）
       —— 不能直接套季度级公式（F06/F07/F08 的 bh 语义是季度总 BH），否则会放大数十倍 */
    const freq = x.freq || 0;
    const perFlightOps = freq > 0
      ? ((x.cost['Fuel'] || 0) + (x.cost['Maintenance'] || 0) + (x.cost['Flight Crew'] || 0)) / freq
      : 0;
    const vc = extraFlights * perFlightOps;
    rev += revenue; varCost += vc;
    detailRows.push({ code, name: (MARKETS[code] || {}).name_c || code, fare: Math.round(r.fare * fareRatio), lf: +(lf * demAdj).toFixed(4), fareBase: r.fare,
      extraFlights: Math.round(extraFlights), served: Math.round(served), revenue: Math.round(revenue) });
  }
  const interest = n * price * (g.interestRate || 5) / 100 / 4;
  const dep = n * price / (GM.depreciation_years || 25) / 4;
  const total = rev - varCost - interest - dep;
  // 盈亏平衡 LF：在该规模下达到 total=0 所需客座率
  const capSeats = n / Math.max(1, codes.length) * perDay * days * seats;
  const beLF = capSeats > 0 ? Math.max(0, (varCost + interest + dep) / (capSeats * ((g.routes[0] || {}).fare || 200))) : null;
  return { n, revenue: Math.round(rev), variableCost: Math.round(varCost), interest: Math.round(interest),
           depreciation: Math.round(dep), net: Math.round(total), breakEvenLF: beLF != null ? +beLF.toFixed(3) : null,
           rows: detailRows };
}

/**
 * 定价 × 运力 联合测算：对每个候选机队规模 N 与运价倍率，取**净收益最大**的组合
 * 用途：小组端「扩张测算器」升级（现价 vs 最优运价两套结果）；回测 Agent 的扩张判据
 */
export function estimateScaleJoint(g, nMax = 4, ratios = [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) {
  const rows = [];
  for (let n = 0; n <= nMax; n++) {
    for (const ratio of ratios) {
      const est = estimateScale(g, n, 40000000, ratio);
      rows.push({ n, fareRatio: ratio, revenue: est.revenue, variableCost: est.variableCost,
        interest: est.interest, depreciation: est.depreciation, net: est.net,
        breakEvenLF: est.breakEvenLF, rows: est.rows });
    }
  }
  let best = rows[0], bestNow = rows.find(r => r.n === 0 && r.fareRatio === 1) || rows[0];
  for (const r of rows) {
    if (r.net > best.net) best = r;
    if (r.fareRatio === 1 && r.net > bestNow.net) bestNow = r;
  }
  return { best, bestAtCurrentFare: bestNow, rows };
}

export function applyFinancialHealth(g) {
  const res = { reduced: [], bankrupt: false };
  if (g.bankrupt) return res;
  if (g.cash >= 0) return res;
  // ① 强制削减：退最贵租金的租赁（押金退还）
  let guard = 0;
  while (g.cash < 0 && (g.leases || []).length && guard++ < 12) {
    let idx = 0;
    for (let i = 1; i < g.leases.length; i++) if ((g.leases[i].quarterlyRent || 0) > (g.leases[idx].quarterlyRent || 0)) idx = i;
    const l = g.leases[idx];
    g.leases.splice(idx, 1);
    g.aircraft = (g.aircraft || []).filter(a => a.id !== l.acId);
    g.schedules = (g.schedules || []).filter(s => s.acId !== l.acId);
    g.cash += l.deposit || 0;                      // 可退不罚 → 押金退还
    res.reduced.push(`${l.type}（季租 $${Math.round(l.quarterlyRent || 0).toLocaleString()}，押金 $${Math.round(l.deposit || 0).toLocaleString()} 已退）`);
  }
  // ② 仍资不抵债 → 破产清算
  if (g.cash < (GM.bankrupt_cash || -5000000)) {
    g.bankrupt = true;
    g.bankruptTurn = g.turn;
    g.schedules = [];
    res.bankrupt = true;
  }
  return res;
}

export function advanceTurn(g) {
  const per = currentPeriod(g);
  // ★ 燃油套保：剩余季度递减
  for (const h of (g.negotiation?.fuelHedge || [])) {
    if (h.quarters > 0) h.quarters -= 1;
  }
  g.negotiation.fuelHedge = (g.negotiation.fuelHedge || []).filter(h => h.quarters > 0);
  stepCompetitors(g);          // AI 竞品先行动
  dropGroundedSchedules(g);    // 事件停飞的班次作废（对各家影响不对称）
  allocateMarkets(g);          // ★ 竞争分配：市场需求切分给各航司（无重复计量）
  settleCompetitors(g);
  const report = computeTurn(g, per);
  g.lastDetail = report.detail;
  g.lastConnByRoute = {};
  for (const [k, d] of Object.entries(report.detail)) g.lastConnByRoute[k] = d.connected_pax;
  g.history.push(report);
  g.cash = report.cash_end;
  g.qsi = report.qsi_end;
  g.fuelPrice = report.fuel_price_next;
  g.carbonPrice = report.carbon_price;
  g.interestRate = report.interest_rate;
  // 事件倒计时（按到期回合判定）
  for (const k of Object.keys(g.demandMult))
    if ((g.demandMultUntil[k] ?? 0) <= g.turn) { delete g.demandMult[k]; delete g.demandMultUntil[k]; }
  for (const k of Object.keys(g.utilCap))
    if (--g.utilCap[k].turnsLeft <= 0) delete g.utilCap[k];
  for (const k of Object.keys(g.groundUntil))
    if (g.groundUntil[k] <= g.turn) delete g.groundUntil[k];
  // ★ F9 修复：annual 为年费，回合=季度 → 按 1/4 摊销（原按每回合全额扣 = 一年 4 倍）
  for (const inv of g.investmentsAnnual) { g.cash -= inv.annual / 4; }
  /* ★ 班次集合**跨赛季保留**（= 时刻占用表）：
     上赛季未调整的航线时刻，本赛季**继续占飞**；
     删除某个时刻 = 释放该时刻航线 → 其他航司可从图表看到变化并抢占（跨席位校验见 server addFlight） */
  // g.schedules = [];   ← 不再清空
  g.turn++;
  return report;
}

/* ============================================================
   中转机制 (Connecting Demand)
   ------------------------------------------------------------
   官方课件 p48「The Power Of A Hub」、p74「连接空中交通」：
     枢纽的中转能力支撑大型飞机的高载客率；
     短程机必须夜间返 HUB，为长程航线输送中转客源。
   服务端参数: game.connecting_demand = 2（裁判可调等级 0-3）
   ============================================================ */
export const CONNECT_WINDOW = { min: 45, max: 360 };   // 可衔接时间窗(分钟)
export const HUB_NIGHT_RETURN = true;                    // 短程机夜间必须返 HUB

function hhmmToMin(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
export function minToHHMM(v) {
  const h = Math.floor(v / 60) % 24, m = Math.round(v % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** 某航线一个航班的"到达枢纽时刻"（去程 BH 折算，航段时间用 BH 近似小时） */
function arrivalAtHub(ac, code, departure) {
  const m = MARKETS[code];
  const bh = m.bh;                       // 单程 BH ≈ 航段时间(小时)
  const dep = hhmmToMin(departure);
  return dep + bh * 60;
}

/**
 * 计算中转旅客。
 * 规则:
 *  - 抵达枢纽的旅客全部进入"待转池"
 *  - 后续 45~360 分钟内起飞的航班可承接转机
 *  - 承接比例随 connecting_demand 等级提升
 *  - 转机旅客按【后续航段】的运价付费（长程票价高 → 中转价值大）
 */
export function computeConnections(g, routeResults) {
  // ★ 分季规则：中转客源自 T2 起才开放（教学节奏；原版首季中转≈0）
  if (!isRuleOn(g, 'connections')) return { connected: 0, byRoute: {}, rate: 0 };
  const lvl = g.connectingDemand ?? 0;              // 0-3
  if (lvl <= 0) return { connected: 0, byRoute: {}, rate: 0 };
  const rate = [0, 0.10, 0.20, 0.32][Math.min(lvl, 3)];

  // 1) 汇集所有到达枢纽的旅客（含时间）
  const arrivals = [];
  for (const r of routeResults) {
    for (const f of r.flights) {
      const fl = (g.routeFlags || {})[r.code] || {};
      arrivals.push({ at: f.arrivalMin, pax: f.served, fromCode: r.code,
                      hub: fl.hub !== false });   // ★ 该航线是否可作中转点（学员可关）
    }
  }
  arrivals.sort((a, b) => a.at - b.at);

  // 2) 每班出发班次承接转机
  let connected = 0;
  const byRoute = {};
  for (const r of routeResults) {
    const rfl = (g.routeFlags || {})[r.code] || {};
    if (rfl.feed === false) continue;               // ★ 该航线不提供联程（学员可关）
    let got = 0;
    for (const f of r.flights) {
      const win = arrivals.filter(a =>
        a.hub !== false && a.fromCode !== r.code &&
        a.at <= f.departureMin &&
        f.departureMin - a.at >= CONNECT_WINDOW.min &&
        f.departureMin - a.at <= CONNECT_WINDOW.max);
      const pool = win.reduce((a, x) => a + x.pax, 0);
      const take = pool * rate;
      got += take;
      for (const a of win) a.pax -= take / Math.max(win.length, 1);
    }
    byRoute[r.code] = got;
    connected += got;
  }
  return { connected, byRoute, rate };
}

/** 短程机必须夜间返 HUB —— 排班校验 */
export function nightReturnRequired(g, ac, code, departure) {
  if (!HUB_NIGHT_RETURN) return false;
  const m = MARKETS[code];
  const long = !!ac.long;      // 过夜资格按机型能力（Ellington 1150km 由 SR 型 G160 飞，非过夜）
  if (long) return false;                 // 长程可过夜
  const dep = hhmmToMin(departure);
  const arr = dep + m.bh * 60;
  return arr > 22 * 60 || arr < 6 * 60;  // 短程晚班/早班需当日返航
}

export function computeTurn(g, per) {
  const routes = {};
  let revenue = 0, cost = 0;
  const detail = {};

  // ══ 第一遍：各航线基础需求与承运（不含中转）══
  const prelim = [];
  // ★ 事件豁免：停飞机可由裁判批准的替代机顶班（原机班次转移）
  const repl = {};
  for (const [acId, ex] of Object.entries(g.negotiation?.exemptions || {})) {
    if (ex && ex.replacementAcId) repl[acId] = ex.replacementAcId;
  }
  for (const route of g.routes) {
    const m = MARKETS[route.code];
    // 停飞飞机的班次不参与本回合运营（豁免时由替代机顶班）
    let fl = g.schedules.filter(s => s.code === route.code &&
      !(g.groundUntil[s.acId] && g.groundUntil[s.acId] > g.turn));
    if (fl.length !== g.schedules.filter(s => s.code === route.code).length) {
      const grounded = g.schedules.filter(s => s.code === route.code &&
        g.groundUntil[s.acId] && g.groundUntil[s.acId] > g.turn);
      for (const gs of grounded) {
        const to = repl[gs.acId];
        const ta = to ? g.aircraft.find(a => a.id === to) : null;
        if (ta) {
          fl.push({ ...gs, acId: ta.id, ac: ta, seats: ta.seats,
                    departure: gs.departure, flightNo: gs.flightNo + '-R' });
          g.log = g.log || [];
          g.log.push(`⚠ ${gs.acId} 停飞，由替代机 ${ta.type} 顶班承担 ${route.code}`);
        }
      }
    }
    if (!fl.length) continue;
    const freq = fl.length * DAYS_PER_QUARTER;
    const seatsOffered = fl.reduce((a, s) => a + s.seats, 0) * DAYS_PER_QUARTER;
    const bh = fl.reduce((a, s) => a + s.bh, 0) * DAYS_PER_QUARTER;
    // ★ 谈判生效：市场级油价 + 燃油套保
    const fuelPx = effFuelPrice(g, route.code);
    const mult = (g.demandMult[route.code] ?? 1)
               * (g.marketParams?.[route.code]?.demandMult ?? 1);
    // ★ 竞争分配：玩家只拿自己的份额（避免与竞品重复计量同一市场需求）
    const al = (g.__alloc || {})[route.code];
    /* 分时定价：各班次起飞时刻的有效票价（峰加价 / 谷打折）
       → 市场需求用**班次加权均价**计算（票价高 → 需求略降） */
    const slotHours = fl.map(s => Math.max(0, Math.min(23, Math.floor(hhmmToMin(s.departure) / 60))));
    const slotFares = slotHours.map(h => effectiveFare(g, route, h));
    const avgFare = slotFares.length ? slotFares.reduce((a, b) => a + b, 0) / slotFares.length : route.fare;
    const D = al ? al.alloc.player : E.demand(m.name, avgFare, freq, mult);
    /* ── 日内需求曲线：把市场当季需求按**起飞时刻**分配 ──────────
       ★ 这是原版「选时刻」决策的收益来源（Role Guide 专章 / 演练规则：
         需求曲线决定你的班次能不能接到客）。
       原实现按班**均匀**分配（served = pax/fl.length）→ 时刻选择无经营意义。
       现实现：日需求 = 季需求/90；各时刻有独立需求池；
         同时刻多班按座位比例分池；单班承运 = min(座位, 该池×份额)。 */
    const shape = E.dayShape(m.name);              // 24 小时归一化权重（和=1）
    const slotOf = (s) => Math.max(0, Math.min(23, Math.floor(hhmmToMin(s.departure) / 60)));
    /* 每**班次**的需求 = 玩家每班平均需求 × 时刻形状系数
       ★ 关键：需求按「班次」分配，不是把季总需求摊到 24 小时后每班只取自己那一格。
         后者会让「未被任何班次覆盖的时刻」的需求凭空流失（客座率塌陷）。
         现模型：每班需求 ∝ shape[h]（早高峰班次需求高），总量仍由 D 约束。 */

/* 日内需求分配（最终模型）
       ★ 该时刻的**市场需求池** = 市场日总需求 × 时刻形状权重
         玩家在此时刻的班次按**座位比例**分取该池的「玩家份额」部分。
       —— 用「市场池」而非「玩家班次平均需求」：
          ① 高峰时刻池大 → 把班次放在高峰能多接客（时刻收益成立）
          ② 玩家只覆盖自己飞的时刻 → 承运 ≤ 份额需求（总量守恒）
       —— 若按「玩家班次平均需求」分配，玩家班次少时会独吞整份需求，
          或反之把总量摊薄，两者都不符原版。 */
    const marketDaily = (al ? al.totalDemand : D) / DAYS_PER_QUARTER;
    const playerShare = al ? al.shares.player : 1;
    const slotSeats = new Map();
    for (const s of fl) slotSeats.set(slotOf(s), (slotSeats.get(slotOf(s)) || 0) + s.seats);
    /* 池的归一化基准 = **该市场实际运营的小时集合**（而非 24 小时）
       —— 原版市场的需求是被「实际飞班的时段」消耗掉的：独占市场只飞 6 个时段，
          就只能消耗这 6 个时段的需求；若按 24 小时摊薄，玩家只覆盖 25% 的时间，
          承运会塌到无意义（LF 0%）。
       ⚠ 共享市场时本基准只含**本方**班次小时（缺竞品时刻数据）→ 近似，
          会在竞品飞行时段较多时高估本方承运；已知缺口，待补竞品时刻后修正。 */
    const usedHours = new Set(fl.map(slotOf));
    const rawW = E.dayShapeRaw(m.name);
    /* 基准小时集合：本方运营小时 ∪ （若能取到）竞品运营小时
       ⚠ 竞品班次时刻目前不在沙盘状态内 → 共享市场的基准只含本方小时（近似）。
       ⚠ 信息不足时（运营小时 < 3，常见于单班/少班场景）退回 24 小时基准，
          否则该小时会独占整份需求 → 时刻差异消失、且高估单班承运。 */
    // 基准优先取**全市场**运营小时（含对手），退回本方小时，再退回 24 小时
    const marketHours = al && al.marketHours && al.marketHours.length ? al.marketHours : null;
    const baseHours = (marketHours && marketHours.length >= 3) ? new Set(marketHours)
                  : (usedHours.size >= 3 ? usedHours : null);
    const baseSum = baseHours
      ? rawW.reduce((a, _, h) => a + (baseHours.has(h) ? rawW[h] : 0), 0)
      : rawW.reduce((a, b) => a + b, 0);
    const wUsed = rawW.map(x => x / baseSum);   // 在基准小时上归一化（和=1）
    // 形状系数：shape[h]×24（1.0 = 平均时刻），**不再按玩家班次归一化**
    //  —— 归一化会把「把班次放在高峰」的收益完全抵消（单班时 shapeK 被拉回 1）
    //  —— 总量仍受下方「总量保护」约束（pax ≤ 玩家需求），不会失控
    const flights = fl.map((s) => {
      const depMin = hhmmToMin(s.departure);
      const h = slotOf(s);
      const slotPool = marketDaily * wUsed[h];      // 该时刻的市场日需求池
      const seatShare = s.seats / (slotSeats.get(h) || s.seats);
      const servedSeason = Math.min(s.seats * DAYS_PER_QUARTER,
        slotPool * playerShare * seatShare * DAYS_PER_QUARTER);
      return { departureMin: depMin, arrivalMin: arrivalAtHub(s.ac, route.code, s.departure),
               served: servedSeason, slot: h };
    });
    // 总量保护：容量集中在高峰时刻时，按比例回缩到市场需求
    let pax = flights.reduce((a, f) => a + f.served, 0);
    if (pax > D && pax > 0) {
      const k = D / pax;
      for (const f of flights) f.served *= k;
      pax = D;
    }
    pax = Math.min(pax, seatsOffered);
    /* 分时定价下的客运收入：各班次有效票价 × 该班承运量（第一段算好，第二段取用） */
    const paxRevSlot = flights.reduce((a, f, i) => a + E.F01(slotFares[i] || route.fare, f.served), 0);
    prelim.push({ route, m, fl, freq, seatsOffered, bh, D, pax, al, fuelPx, flights,
                  slotFares, paxRev: paxRevSlot });
  }

  // ══ 中转结算 ══
  g.connectingDemand = effParams(g).connectingDemand;
  const conn = computeConnections(g, prelim.map(p => ({
    code: p.route.code, flights: p.flights })));

  // ══ 第二遍：含中转的最终收入与成本 ══
  for (const p of prelim) {
    const { route, m, fl, freq, seatsOffered, bh, D } = p;
    // 中转旅客须与本地旅客共用同一批座位：本地客优先，中转填余量
    const connWant = conn.byRoute[route.code] || 0;
    const localPax = p.pax;
    const connPax = Math.min(connWant, Math.max(0, seatsOffered - localPax));
    const pax = localPax + connPax;
    const offeredSeats = seatsOffered;
    const ask = offeredSeats * m.sector_km;
    const rpk = E.rpkAbs(pax, m.sector_km);
    const lf = E.loadFactor(rpk, ask);
    const cargoCap = fl.reduce((a, s) => a + (s.cargoCap || 0), 0) * freq;
    const cargoDemand = m.cargo_demand * DAYS_PER_QUARTER * (m.cargo_demand > 30 ? 0.25 : 1);
    /* ★ 载重平衡：座位多、客座率高 → 客舱重量大 → 货舱可载货少（甚至不载）
       裁判可对某航线（或全局）关闭载货 → cargoPolicy[code].open === false */
    const flightsN = Math.max(1, fl.length * freq);
    const ratedPerFlight = fl.reduce((a, s) => a + (s.cargoCap || 0), 0) / Math.max(1, fl.length);
    const paxPerFlight = pax / flightsN;
    const cargoPolicy = (g.cargoPolicy || {})[route.code] || (g.cargoPolicy || {})['*'] || {};
    const cargoOpen = cargoPolicy.open !== false;
    const weightLeft = Math.max(0, ratedPerFlight - paxPerFlight * 0.1);   // 吨：每客按 100kg 计
    const cargo = cargoOpen ? Math.min(cargoDemand, weightLeft * flightsN) : 0;
    const cargoRev = cargo * m.cargo_yield * m.sector_km * 2;
    /* 客运收入 = 本地旅客全额 + 中转旅客按**续程结算比例**（余额归原承运人） */
    const paxRev = (() => {
      const total = p.paxRev || 0;
      const connP = connPax;
      const paxAll = p.pax || 1;
      if (!connP || !paxAll) return total;
      const connShare = connP / paxAll;                       // 中转旅客占承运量比例
      const payout = GM.connect_payout_ratio != null ? GM.connect_payout_ratio : 0.5;
      return total * (1 - connShare * (1 - payout));           // 中转部分只收 payout 比例
    })();
    /* ★ 辅营收入：按原版 CA 首季反推（$154,800 / 60,311 旅客 = $2.57/人）
       → pax × (1.0 + 0.35 × QSI)，qsi=4.5 → $2.575/人（误差 0.3%） */
    const ancRev = pax * (1.0 + 0.35 * g.qsi);

    // ★ 固定项由航司层统一计一次（companyFixed），此处只用变动项，避免按航线重复
    // ★ 干租（dry lease）由出租方承担燃油/维护/机组/保险 → 承租方不计这些运营成本
    //   （湿租 wet：承租方承担运营，仅付租金）
    const dryRatio = fl.length ? fl.filter(s => {
      const l = (g.leases || []).find(x => x.acId === s.acId);
      return l && l.leaseType === 'dry';
    }).length / fl.length : 0;
    const opShare = 1 - dryRatio;
    // ★ 加仑数与结算价分离：套保下结算价≠实际价，反推加仑会失真 → 用真实加仑
    const fuelGal = E.F08_GAL(bh) * opShare;
    const fuelCost = fuelGal * p.fuelPx;
    const c = {
      'Fuel': fuelCost,   // 已含 F08_VAR（固定项在航司层计一次）
      // ★ 分季规则：SAF 强制掺混自 2029-01-01（turn 5）起生效，此前为 0
      'Sustainable Aviation Fuel': isRuleOn(g, 'safMandate') ? E.safCost(fuelCost) : 0,
      // ★ 碳成本按燃油量计量（原版口径），非按旅客数
      'Carbon': isRuleOn(g, 'carbonCost') ? E.carbonCost(fuelGal, g.carbonPrice, CARBON.index) : 0,
      'Maintenance': E.F07_VAR(freq / DAYS_PER_QUARTER, bh) * opShare,   // 变动项（公司级固定项见下）
      'Flight Crew': E.F06_VAR(freq / DAYS_PER_QUARTER, bh) * opShare,    // 变动项（公司级固定项见下）
      'Cabin Crew': cabCrewCost(g, fl) * opShare,
      'Landing': E.landingFee(route.code, freq),
      'Navigation': E.navigationCost(pax, m.sector_km),
      'Aircraft Handling': E.aircraftHandling(freq),
      'Traffic Handling': E.trafficHandling(route.code, pax),
      'Cargo Handling': E.cargoHandling(cargo),
      'Cargo Overheads': E.cargoOverheads(ask),
      'General & Administration': E.generalAdmin(ask),
      'Passenger Services': E.passengerServices(paxRev),
      'Ticketing, Sales and Promotion': E.ticketingSales(bh),
    };
    const IND = ['Cargo Overheads','General & Administration','Passenger Services','Ticketing, Sales and Promotion'];
    const dco = Object.entries(c).filter(([k]) => !IND.includes(k)).reduce((a, [, v]) => a + v, 0);
    const ind = IND.reduce((a, k) => a + c[k], 0);
    const totRev = paxRev + cargoRev + ancRev;
    const op = totRev - dco - ind;

    detail[route.code] = {
      market: m.name, code: route.code, freq, bh, ask, pax, rpk, lf, cargo,
      local_pax: (p.flights || []).reduce((a, f) => a + (f.served || 0), 0),  // 局地承运（不含中转）→ 时刻收益分析
      flights: (p.flights || []).map(f => ({ departureMin: f.departureMin, served: f.served, slot: f.slot })),
      demand: D, fare: route.fare, qsi: g.qsi,
      share: p.al ? p.al.shares.player : 1,
      marketDemand: p.al ? p.al.totalDemand : D,
      rivals: p.al ? Object.entries(p.al.shares).filter(([k]) => k !== 'player')
                       .map(([k, v]) => ({ key: k, share: v })) : [],
      connected_pax: connPax,
      connected_spill: Math.max(0, connWant - connPax),
      rev: { 'Passenger Revenue': paxRev, 'Cargo Revenue': cargoRev,
             'Ancillary Revenue': ancRev, 'Total Revenue': totRev },
      cost: c, dco, ind, operating_profit: op,
    };
    revenue += totRev; cost += dco + ind;
  }

  // ---- 航司层持有成本（只计一次）----
  const ownedAll = g.aircraft.filter(a => a.owned);
  const ownPrice = ownedAll.reduce((a, x) => a + x.price, 0);
  const ownDep = ownedAll.reduce((a, x) => a + E.quarterlyDepreciation(x.price), 0);
  const effRate = effParams(g).interestRate;
  const ownInt = ownedAll.reduce((a, x) => a + E.quarterlyInterest(x.price, effRate), 0);
  const ins = ownPrice * (effParams(g).insuranceRate ?? GM.insurance_rate) / 100 / 4;
  /* ★ 口径修正：折旧 + 保险属于原版 TOTAL OWNERSHIP COSTS（计入营业成本）；
     **利息不属于营业成本**（原版在营业利润之下计入 NET FINANCE CHARGES）——
     此前把 ownInt 混进 cost，导致经营利润已是税前口径，且与 financing 重复计息。 */
  const own = ownDep + ins;
  cost += own;
  /* ★ 租金计入营业成本（原版 TOTAL OWNERSHIP COSTS 内含 Wet Lease Payments） */
  let leasePayments = 0;
  if (g.leases) for (const l of g.leases) leasePayments += l.quarterlyRent;
  cost += leasePayments;
  for (const d of Object.values(detail)) d.leasePayments = leasePayments;
  /* 机组 / 维护 / 燃油的公司级固定项（每季只计一次，原版口径） */
  const companyFixed = E.F06_FIXED + E.F07_FIXED + E.F08_FIXED;
  cost += companyFixed;
  for (const d of Object.values(detail)) d.companyFixed = companyFixed;
  for (const d of Object.values(detail)) d.own = own;

  let oneoff = 0;
  for (const r of g.routes) {
    // 开线费已在裁判批准开线时即时支付（route.feePaid）→ 此处不再重复扣，避免双扣
    if (r.openedTurn === g.turn && !r.feePaid) oneoff += GM.new_route_fee;
    // ★ F10 修复：etops_fee 已由 server payEtops 即时扣款，此处**不再重复**（曾被误加回导致双扣）
  }

  // ★ 谈判生效：航线补贴计入本回合现金流
  const subsidy = effSubsidy(g);
  revenue += subsidy;

  // ★ 投资项的 per-passenger 成本/收益（真实结构：Costs / Revenue per passenger）
  //   航司级投资对全部旅客生效；航线级投资只对该市场旅客生效
  const paxTotal = Object.values(detail).reduce((a, d) => a + d.pax, 0);
  let invCost = 0, invRevenue = 0;
  for (const inv of (g.investments || [])) {
    const def = INVESTMENTS.find(x => x.id === inv.id);
    if (!def) continue;
    const cfg = g.negotiation?.investTerms?.[inv.id] || {};
    const cPax = cfg.costPerPax != null ? cfg.costPerPax : (def.costPerPax || 0);
    const rPax = cfg.revenuePerPax != null ? cfg.revenuePerPax : (def.revenuePerPax || 0);
    const scope = def.cat === 'route' ? (inv.code || null) : null;
    const pax = scope ? (detail[scope]?.pax || 0) : paxTotal;
    invCost += cPax * pax;
    invRevenue += rPax * pax;
  }
  revenue += invRevenue;
  cost += invCost;
  g.lastInvestmentPL = { invCost, invRevenue, paxTotal };

  const ocf = revenue - cost;
  // ★ F1 修复：investment upfront 已由 server.mjs invest 动作即时扣款，
  //   结算期不再二次扣减（否则实扣 2 倍）
  /* ── 贷款结算 ──────────────────────────────────────────────────
     口径（rebuild/verify_loan_repayment.py 验证结论）：
       每季还款 = 等额本金(总本金/48) + 当季利息(期初余额×利率/4)   ← 含利息
     现金流呈现：融资活动只列**本金**，利息在经营活动的 Interest Paid 体现，
       避免原版「同一笔利息列两次」的呈现缺陷（第 4 处原版缺陷）。 */
  let loanPrincipal = 0, loanInterest = 0, fleetFinancingInterest = 0;
  for (const l of (g.loans || [])) {
    l.quarterlyPrincipal = l.principal / LOAN.quarters;
    l.quarterlyInterest = l.balance * (l.rate / 100) / 4;
    if (l.channel === 'fleet') fleetFinancingInterest += l.quarterlyInterest;  // ★ 机队融资利息 → 运营成本
    l.quarterlyRepay = l.quarterlyPrincipal + l.quarterlyInterest;   // 含息（台账口径）
    loanPrincipal += l.quarterlyPrincipal;
    loanInterest += l.quarterlyInterest;
  }
  /* 利息口径：原版自有资产**不计息**（折旧已提），利息仅针对贷款 → 不加 ownInt */
  /* ★ 机队融资通道利息 + 赊账开线费利息 → 计入营业成本（课程裁定：融资成本计入运营成本） */
  if (fleetFinancingInterest) cost += fleetFinancingInterest;
  const routeFeeInterest = (g.routeFeeDue || 0) * (effParams(g).interestRate ?? GM.interest_rate) / 100 / 4;
  if (routeFeeInterest) cost += routeFeeInterest;

  const financing = -loanPrincipal;
  let cash_end = g.cash + ocf - oneoff + financing;

  /* ── 超额现金强制还贷（仅当仍有未偿贷款）─────────────────────────
     证据：CA 期初 $2,687,673、VA 期初 $2,400,000（不同），
           但首季期末**都恰好 $2,000,000**（= 初始股本）→ 首季把超额现金还了贷。
     ⚠ 这**不是硬下限**：CA Q2 期末 $2,917,559、Q3 $4,512,841 均高于 $2,000,000，
       VA Q1 穿仓 −$703,245 远低于它 → 非破产线、非硬约束，
       而是「有贷款未清 + 现金充裕 → 优先还贷」的行为。
     g.noCashSweep 仅供测试隔离变量用。 */
  let loanSweep = 0;
  if (LOAN.force_sweep_excess && !g.noCashSweep && (g.loans || []).length) {
    let excess = cash_end - LOAN.cash_floor;
    for (const l of g.loans) {
      if (excess <= 0) break;
      const avail = Math.max(0, l.balance - l.quarterlyPrincipal);
      const pay = Math.min(excess, avail);
      l.balance -= pay; excess -= pay; loanSweep += pay;
    }
    cash_end -= loanSweep;
  }

  const askTotal = Object.values(detail).reduce((a, d) => a + d.ask, 0);
  const lfTotal = askTotal ? Object.values(detail).reduce((a, d) => a + d.rpk, 0) / askTotal : 0;
  const ancTotal = Object.values(detail).reduce((a, d) => a + d.rev['Ancillary Revenue'], 0);
  const gross = revenue ? (revenue - cost) / revenue : 0;
  g.lastDetail = detail;

  return {
    period: per.label, turn: g.turn, detail,
    revenue, cost, operating_profit: ocf, oneoff, financing, cash_end,
    net_finance_charges: loanInterest, loan_principal: loanPrincipal,
    loan_sweep: loanSweep, loan_balance: (g.loans || []).reduce((a, l) => a + l.balance, 0),
    qsi_end: Math.max(0, g.qsi),
    fuel_price_next: g.fuelPrice, carbon_price: g.carbonPrice, interest_rate: g.interestRate,
    paxTotal: Object.values(detail).reduce((a, d) => a + d.pax, 0),
    askTotal, load_factor: lfTotal,
    connected_total: conn.connected, connect_rate: conn.rate,
    ancillary_share: revenue ? ancTotal / revenue : 0,
    gross_margin: gross,
    market_share: marketShare(g),
    leasePayments,
  };
}

/** 网络份额 = 本航司 RPK / 全网 RPK（竞品按 AI 模拟值） */
export function marketShare(g) {
  const mine = Object.values(g.lastDetail || {}).reduce((a, d) => a + d.rpk, 0);
  const rivals = (g.competitors || []).reduce((a, c) => a + (c.lastRPK || 0), 0);
  const tot = mine + rivals;
  return tot ? mine / tot : 0.35;
}

function cabCrewCost(g, fl) {
  let cost = 0;
  for (const s of fl) {
    const need = Math.max(1, Math.ceil(s.seats / GM.seat_per_crew));
    const have = (s.ac.cabinCrew ?? need) || need;   // ★ 修：cabinCrew=0 时 ?? 不生效 → 乘务员成本归零
    // ★ 修：每条排班为「每日 1 班」→ 季班次 = DAYS_PER_QUARTER（此前按班次数组条数计，
    //   一季只算了 6~10 班而非 540/360 班次；改按季班次后又误乘了航线 freq → 正确口径为 90）
    cost += have * (GM.cabin_crew_salary + GM.cabin_crew_allowance * s.bh) * DAYS_PER_QUARTER;
  }
  return cost;
}

/* ---------------- 评分 ---------------- */
export function score(g) {
  const h = g.history;
  const cumProfit = h.reduce((a, r) => a + r.operating_profit, 0);
  const last = h[h.length - 1];
  const t = TARGETS;
  const rows = [
    ['毛利率', t.gross_margin, last ? last.gross_margin : 0, 'pct'],
    ['辅营收入占比', t.ancillary_share, last ? last.ancillary_share : 0, 'pct'],
    ['累计利润 (Q1-Q6)', t.cumulative_profit, cumProfit, 'money'],
    ['客座率', t.load_factor, last ? last.load_factor : 0, 'pct'],
    ['市场份额', t.market_share, last ? last.market_share : 0, 'pct'],
  ];
  return rows.map(([name, tgt, act, kind]) => ({
    name, target: tgt, actual: act, kind,
    met: kind === 'pct' ? act >= tgt : act >= tgt,
    pct: kind === 'pct' ? act / tgt : act / tgt,
  }));
}

/* ---------------- 事件 ---------------- */
export function triggerEvent(g, eventId, target) {
  const ev = EVENTS.find(e => e.id === eventId);
  if (!ev) return;
  const fx = ev.effect || {};
  if (ev.scope === 'market' && target) {
    // 市场级：需求倍数（如火山 0.55，持续 turns 个回合）
    if (fx.demand_mult != null) {
      g.demandMult[target] = fx.demand_mult;
      g.demandMultUntil[target] = g.turn + (fx.turns || 1);
    }
  } else if (ev.scope === 'airline' && target) {
    const ac = g.aircraft.find(a => a.id === target || a.type === target);
    if (ac) {
      // 冰雹：日利用上限 util_cap BH/日 → 折算为季度 BH；停飞 ground_weeks 周
      if (fx.util_cap != null) {
        g.utilCap[ac.type] = { bh: fx.util_cap * DAYS_PER_QUARTER, turnsLeft: fx.turns || 1 };
      }
      if (fx.ground_weeks) {
        const quarters = Math.max(1, Math.ceil(fx.ground_weeks / (DAYS_PER_QUARTER / 7)));
        g.groundUntil[ac.id] = g.turn + quarters;
      }
    }
    if (fx.qsi) g.qsi = Math.max(0, g.qsi + fx.qsi);
    if (fx.ransom) {
      const amt = fx.ransom_amount || 2500000;
      g.cash -= amt;
      g.log.push(`勒索赎金 ${(amt / 1e6).toFixed(1)}M 已支付`);
    }
  } else if (ev.scope === 'global') {
    if (fx.demand_mult != null) {
      for (const c of MARKET_LIST) { g.demandMult[c] = fx.demand_mult; g.demandMultUntil[c] = g.turn + (fx.turns || 1); }
    }
    if (fx.fuel_mult) g.fuelPrice *= fx.fuel_mult;
  }
  g.log.push(`事件：${ev.title} ${target || ''} — ${ev.text}`);
}
