/* ============================================================
   缺口模拟产出：① AB/VA 的逐季 QSI  ② 原版各季逐项成本
   rebuild/simulate_gaps.mjs
   ------------------------------------------------------------
   原则：全部由「一手锚点 + 明确推导链」产出，标注【模拟产出·非一手数据】，
         并给出残差与敏感性；不冒充一手读数。
   ============================================================ */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const B = JSON.parse(readFileSync(join(HERE, 'baseline_real.json'), 'utf8'));
const out = { generatedAt: new Date().toISOString(), qsi: {}, costByQuarter: {}, sensitivity: {}, notes: [] };

/* ─────────── ① QSI 轨迹（模拟产出） ───────────
   已知一手锚点：
     CA: Q4'27 4.50 → Q1'28 −0.20 → Q2'28 6.10 → Q3'28 7.38
     VA: Q4'27 4.50 → Q3'28 21.96
     AB: 无任何锚点
   推导链：三期为同一批参赛者、同一营销节奏 → 用 CA 的**增量形状**作为模板
   （Δ: Q1'28 −4.70、Q2'28 +6.30、Q3'28 +1.28），按各家自身锚点平移；
   AB 以初始 QSI 4.20 为起点。Q4'28–Q2'29 用 CA 后期平均增量 +0.9/季 外推。 */
const QUARTERS = ['Q4_2027', 'Q1_2028', 'Q2_2028', 'Q3_2028', 'Q4_2028', 'Q1_2029', 'Q2_2029'];
const caKnown = { Q4_2027: 4.50, Q1_2028: -0.20, Q2_2028: 6.10, Q3_2028: 7.38 };
const vaKnown = { Q4_2027: 4.50, Q3_2028: 21.96 };
const dQ = [-4.70, 6.30, 1.28];              // CA 的季度增量形状（Q1'28→Q3'28）
const tailStep = 0.9;                          // Q4'28 起的外推步长
function project(known, startQ) {
  const seq = [];
  for (const q of QUARTERS) if (known[q] != null) seq.push({ q, v: known[q] });
  // 从最后一个锚点起：对齐 CA 的增量形状；锚点之后的季度用 CA 的形状或尾段步长
  const idx0 = QUARTERS.indexOf(seq[seq.length - 1].q);
  let v = seq[seq.length - 1].v;
  const res = {};
  for (const q of QUARTERS) res[q] = known[q] != null ? known[q] : null;
  for (let i = idx0 + 1; i < QUARTERS.length; i++) {
    const d = tailStep;   // 锚点之后按尾段步长外推（不套用形状增量）
    v += d; res[QUARTERS[i]] = Math.round(v * 10) / 10;
  }
  // 锚点之间的季度：用 CA 形状回填（同一节奏假设）
  if (seq.length >= 1) {
    const base = seq[0];
    for (let i = 1; i < seq.length; i++) {
      const k = QUARTERS.indexOf(seq[i].q) - QUARTERS.indexOf(base.q);
      res[seq[i].q] = seq[i].v;   // 锚点值优先
      void k;
    }
  }
  return res;
}
out.qsi.CA = project(caKnown, 0);
/** 锚点稀疏的季度：用「同期 CA 值 + 该家锚点偏移」回填 */
function backfill(res, known) {
  const anchorQ = Object.keys(known);
  const lastQ = anchorQ[anchorQ.length - 1];
  const off = known[lastQ] - (caKnown[lastQ] != null ? caKnown[lastQ] : 0);
  for (const q of QUARTERS) if (res[q] == null && caKnown[q] != null) res[q] = Math.round((caKnown[q] + off) * 10) / 10;
  return res;
}
out.qsi.VA = backfill(project(vaKnown, 0), vaKnown);
// AB：无锚点 → 用与 CA 相同的增量形状，起点取其初始 QSI 4.20
const abSeq = {}; let abV = 4.20;
for (let i = 0; i < QUARTERS.length; i++) {
  if (i === 0) { abSeq[QUARTERS[i]] = 4.20; continue; }
  const d = (i - 1) < dQ.length ? dQ[i - 1] : tailStep;
  abV += d; abSeq[QUARTERS[i]] = Math.round(abV * 10) / 10;
}
out.qsi.AB = abSeq;
out.qsi._DEPRECATED = {
  status: '【已作废·方法论错误】',
  reason: 'QSI 是**经营决策的内生结果**（沙盘：投资广告/服务类项目 → effect.qsi → g.qsi 累积），'
    + '而非固定参数。原版 CA 的 QSI 轨迹（4.50 → −0.20 → 6.10 → 7.38）是该团队**自身投放与退出的累积结果**，'
    + '与经营策略直接相关 → 因此**不可用 CA 的形状外推 AB/VA 的 QSI**。',
  replacement: 'AB/VA 的 QSI 无需外部数据：由各自的市场营销与服务投入在沙盘内产生（game.js: g.qsi += effect.qsi）；'
    + '下表仅作为「QSI 扰动对份额的敏感性」参考（Δ份额 ≈ p(1−p)·0.086·ΔQSI），不可当作 QSI 预测值。',
};
out.qsi._basis = {
  anchors: { CA: caKnown, VA: vaKnown, AB: '无一手锚点' },
  method: '锚点值直接采用；锚点之后的季度按尾段步长 +0.9/季外推；'
    + '锚点稀疏的季度用「同期 CA 值 + 该家锚点偏移」回填（VA）；'
    + 'AB 无任何一手锚点，以初始 QSI 4.20 起按 CA 的季度增量形状 Δ[−4.70,+6.30,+1.28] 外推，其后 +0.9/季',
  tag: '【模拟产出·非一手数据】',
};

/* ─────────── ② 各季逐项成本（模拟产出 + 残差检验） ───────────
   锚点：CA 首季（Q4/2027）17 项逐项真实值（baseline.global_baseline_q4_2027）
   约束：各季已知 revenue / net_margin（→ operating_profit）/ fuel_cost / carbon_cost
   做法：以首季的成本结构为模板，按「可变项随运量/业务量、折旧与利息随资产」分别缩放；
        缩放因子由该季已知的 fuel/carbon/revenue 联合确定 → 输出逐项推导值与总量残差。 */
const Q = B.global_baseline_q4_2027.operating_costs_statement;
const baseRev = Q.revenues['TOTAL REVENUE'];
const baseItems = {};
for (const k of Object.keys(Q.direct_cash_operating_costs)) if (!k.startsWith('DIRECT')) baseItems[k] = Q.direct_cash_operating_costs[k];
for (const k of Object.keys(Q.indirect_operating_costs)) if (!k.startsWith('INDIRECT')) baseItems[k] = Q.indirect_operating_costs[k];
baseItems['Depreciation on Owned Assets'] = Q.total_ownership_costs['Depreciation on Owned Assets'];
baseItems['Insurance'] = Q.total_ownership_costs['Insurance'];
const baseTotal = Q.totals['TOTAL OPERATING COSTS'];
/** 可变项（随业务量缩放） vs 固定项（随资产/期数缩放） */
const VARIABLE = new Set(['Passenger Revenue', 'Cargo Revenue', 'Ancillary Revenue', 'Fuel', 'Carbon',
  'Maintenance', 'Flight Crew', 'Cabin Crew', 'Landing', 'Navigation', 'Aircraft Handling', 'Traffic Handling',
  'Cargo Handling', 'Passenger Services', 'Ticketing, Sales and Promotion', 'General & Administration', 'Cargo Overheads']);

function deriveQuarter(label, o) {
  // o: { revenue, net_margin, fuel_cost, carbon_cost }
  const opProfit = o.revenue * o.net_margin;
  const totalCost = o.revenue - opProfit;
  // ① 燃油缩放因子：fuel / 基期 fuel
  const fFuel = o.fuel_cost != null ? o.fuel_cost / baseItems['Fuel'] : null;
  // ② 碳缩放：carbon / 基期 carbon
  const fCarbon = o.carbon_cost != null ? o.carbon_cost / baseItems['Carbon'] : null;
  // ③ 规模因子（收入）：收入之比 → 运营量之比
  const fScale = o.revenue / baseRev;
  // 逐项推导
  const items = {};
  for (const [k, v] of Object.entries(baseItems)) {
    let f = fScale;
    if (k === 'Fuel') f = fFuel != null ? fFuel : fScale;
    else if (k === 'Carbon') f = fCarbon != null ? fCarbon : fScale;
    else if (k === 'Depreciation on Owned Assets') f = 1;          // 资产未变（无购机记录）
    else if (k === 'Insurance') f = 1;
    else f = VARIABLE.has(k) ? fScale : fScale;
    items[k] = Math.round(v * f);
  }
  // ④ 用总量约束求整体修正系数（保持结构、匹配已知总量）
  const sum = Object.values(items).reduce((a, b) => a + b, 0);
  const corr = sum > 0 ? totalCost / sum : 1;
  const final = {};
  for (const [k, v] of Object.entries(items)) final[k] = Math.round(v * corr);
  const sum2 = Object.values(final).reduce((a, b) => a + b, 0);
  const anchorCheck = {};
  if (o.fuel_cost != null) anchorCheck.Fuel = { derived: final['Fuel'], actual: o.fuel_cost, dev: +(final['Fuel'] / o.fuel_cost - 1).toFixed(4) };
  if (o.carbon_cost != null) anchorCheck.Carbon = { derived: final['Carbon'], actual: o.carbon_cost, dev: +(final['Carbon'] / o.carbon_cost - 1).toFixed(4) };
  return {
    label, anchor: o, revenue: o.revenue, operating_profit: Math.round(opProfit),
    anchorCheck, residualNote: '总量残差为构造性归零（按总量做了整体修正），不构成独立验证；'
      + '有意义的检验是 anchorCheck（与该季已知 fuel/carbon 的偏离）',
    total_cost_derived: sum2, total_cost_actual: Math.round(totalCost),
    residual: Math.round(sum2 - totalCost), correction: +corr.toFixed(4),
    items: final, tag: '【模拟产出·非一手数据】推导值，未经一手逐项核对',
  };
}
const CA = B.capital_airways.quarters;
out.costByQuarter.CA_Q1_2028 = deriveQuarter('CA Q1 2028', { revenue: CA.Q1_2028.revenue, net_margin: CA.Q1_2028.net_margin, fuel_cost: CA.Q1_2028.fuel_cost, carbon_cost: CA.Q1_2028.carbon_cost });
out.costByQuarter.CA_Q2_2028 = deriveQuarter('CA Q2 2028', { revenue: CA.Q2_2028.revenue, net_margin: CA.Q2_2028.net_margin, fuel_cost: CA.Q2_2028.fuel_cost, carbon_cost: CA.Q2_2028.carbon_cost });
out.costByQuarter.CA_Q3_2028 = deriveQuarter('CA Q3 2028', { revenue: CA.Q3_2028.revenue, net_margin: CA.Q3_2028.net_margin, fuel_cost: CA.Q3_2028.fuel_cost, carbon_cost: CA.Q3_2028.carbon_cost });
const VA = B.vision_air.quarters;
out.costByQuarter.VA_Q4_2027 = deriveQuarter('VA Q4 2027', { revenue: VA.Q4_2027.revenue, net_margin: VA.Q4_2027.net_margin });

/* ─────────── ③ QSI 敏感性（对最终份额的影响） ───────────
   竞争模型（校准值）：logit 份额 = −0.562·ln(fare) + 1.160·ln(freq) + 0.086·QSI
   → 某家 QSI ±2 → 其 logit ±0.172 → 份额变化随对手数与自身份额而定
   解析给出：玩家份额 p，n-1 个对手 → 玩家 logit 变动 δ 时份额变动 ≈ p·(1−p)·δ / (1 + ...) 的一阶近似。 */
const QSI_W = 0.086;
for (const d of [1, 2, 3]) {
  const delta = d * QSI_W;
  const table = {};
  for (const p of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
    const approx = p * (1 - p) * delta;              // 一阶近似：份额变化
    table['p=' + p] = { share_delta_pp: +(approx * 100).toFixed(2), lf_delta_pp: +(approx * 100).toFixed(2) };
  }
  out.sensitivity['qsi_plus_' + d] = { logit_delta: +delta.toFixed(3), table,
    note: '一阶近似：Δ份额(pp) ≈ p(1−p)·δ；LF 变化幅度同数量级（需按航线加权）' };
}

writeFileSync(join(HERE, 'simulate_gaps.json'), JSON.stringify(out, null, 2));
console.log('=== QSI 轨迹（模拟产出）===');
console.log('季度        CA      AB      VA');
for (const q of QUARTERS) console.log(q.padEnd(11), String(out.qsi.CA[q]).padStart(6), String(out.qsi.AB[q]).padStart(7), String(out.qsi.VA[q]).padStart(7));
console.log('\n=== 各季逐项成本（模拟产出 + 残差）===');
for (const [k, v] of Object.entries(out.costByQuarter)) {
  console.log(`${v.label}: 收入 $${v.revenue.toLocaleString()} 推导总成本 $${v.total_cost_derived.toLocaleString()} 实际 $${v.total_cost_actual.toLocaleString()} 残差 ${v.residual.toLocaleString()} (修正系数 ${v.correction})`);
  const top = Object.entries(v.items).sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log('   ' + top.map(([a, b]) => `${a} ${(b / 1e6).toFixed(2)}M`).join(' | '));
}
console.log('\n=== QSI 敏感性（Δ份额 pp）===');
for (const d of [1, 2, 3]) {
  const s = out.sensitivity['qsi_plus_' + d];
  console.log(`QSI +${d} → logit ${s.logit_delta}: ` + Object.entries(s.table).map(([k, v]) => `${k}:${v.share_delta_pp}`).join(' '));
}
console.log('\n已写入', join(HERE, 'simulate_gaps.json'));
