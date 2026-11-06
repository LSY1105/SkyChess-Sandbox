/* ============================================================
   多 Agent 演练汇总：LLM 决策 vs 规则兜底 对照 + 三种定位对比 + 原版对标
   rebuild/summarize_agentplay.mjs
   运行：node rebuild/summarize_agentplay.mjs
   ============================================================ */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const R = JSON.parse(readFileSync(join(HERE, 'sandbox', 'replay_out', 'agentplay.json'), 'utf8'));
const B = JSON.parse(readFileSync(join(HERE, 'rebuild', 'baseline_real.json'), 'utf8'));
const SEATS = ['CA', 'AB', 'VA'];
const STYLE = { CA: 'LCC 低成本型', AB: 'FSC 全服务型', VA: 'Hybrid 混合型' };
const out = { generatedAt: new Date().toISOString(), turns: R.turns, seats: {}, coverage: {}, vsBaseline: {}, findings: [] };

/* ① 逐季决策来源与动作成败 */
let llmTurns = 0, fbTurns = 0, actOk = 0, actRej = 0;
const src = {};
for (const s of SEATS) src[s] = { llm: 0, fallback: 0, applied: 0, rejected: 0 };
for (const se of R.seasons) {
  for (const d of se.decisions) {
    if (!d || !d.seat) continue;
    const isFb = d.fallback || d.fallback === 'rule-after-reject';
    if (isFb) { src[d.seat].fallback++; fbTurns++; } else { src[d.seat].llm++; llmTurns++; }
    for (const a of (d.applied || [])) { src[d.seat].applied++; actOk++; }
    for (const a of (d.rejected || [])) { src[d.seat].rejected++; actRej++; }
  }
}
out.coverage = {
  decisions: llmTurns + fbTurns, llmDecisions: llmTurns, fallbackDecisions: fbTurns,
  fallbackRate: +((fbTurns / Math.max(1, llmTurns + fbTurns)) * 100).toFixed(1),
  actionsAccepted: actOk, actionsRejected: actRej,
  acceptRate: +((actOk / Math.max(1, actOk + actRej)) * 100).toFixed(1),
  perSeat: src,
};

/* ② 经营轨迹与三家定位对比 */
for (const s of SEATS) {
  const rows = R.seasons.map(se => se.seats[s]);
  out.seats[s] = {
    style: STYLE[s],
    cash: rows.map(r => r.cash), revenue: rows.map(r => r.revenue),
    operating_profit: rows.map(r => r.operating_profit), lf: rows.map(r => r.load_factor),
    share: rows.map(r => r.share), routes: rows.map(r => r.routes.join('+')),
    finalCash: rows[rows.length - 1].cash,
    cumProfit: rows.reduce((a, r) => a + (r.operating_profit || 0), 0),
    cumRevenue: rows.reduce((a, r) => a + (r.revenue || 0), 0),
    avgLF: +(rows.reduce((a, r) => a + (r.load_factor || 0), 0) / rows.length).toFixed(4),
    maxLF: Math.max(...rows.map(r => r.load_factor || 0)),
    finalShare: rows[rows.length - 1].share,
  };
}

/* ③ 与原版对标（首季 CA：原版 CA Q1 2028 收入 13.95M / LF 57% / margin 7.42%） */
const baseCA = B.capital_airways.quarters.Q1_2028;
const t0 = R.seasons[0].seats;
out.vsBaseline = {
  CA_Q1_2028: {
    baseline: { revenue: baseCA.revenue, load_factor: baseCA.load_factor, net_margin: baseCA.net_margin, closing_cash: baseCA.closing_cash },
    agentplay: { revenue: t0.CA.revenue, load_factor: t0.CA.load_factor, closing_cash: t0.CA.cash },
    revenueRatio: +((t0.CA.revenue || 0) / baseCA.revenue).toFixed(3),
    lfGapPp: +(((t0.CA.load_factor || 0) - baseCA.load_factor) * 100).toFixed(1),
  },
  note: '演练为「初始 2 架飞机 + 规则不变 + 融资 Q2 起」的教学起点；原版 CA 首季为已具规模后的状态',
};

/* ④ 结论清单（自动判定） */
const f = out.findings;
const worst = SEATS.map(s => [s, out.seats[s].cumProfit]).sort((a, b) => b[1] - a[1]);
f.push(`决策来源：LLM ${out.coverage.llmDecisions} 次、规则兜底 ${out.coverage.fallbackDecisions} 次（兜底率 ${out.coverage.fallbackRate}%）`);
f.push(`动作接受率 ${out.coverage.acceptRate}%（接受 ${out.coverage.actionsAccepted}／拒绝 ${out.coverage.actionsRejected}）`);
f.push(`累计经营利润排序：${worst.map(([s, v]) => `${s} ${STYLE[s]} $${Math.round(v).toLocaleString()}`).join(' ｜ ')}`);
f.push(`平均 LF：${SEATS.map(s => `${s} ${(out.seats[s].avgLF * 100).toFixed(1)}%（峰值 ${(out.seats[s].maxLF * 100).toFixed(1)}%）`).join(' ｜ ')}`);
f.push(`首季 vs 原版 CA Q1'2028：收入 ${out.vsBaseline.CA_Q1_2028.revenueRatio}×、LF ${out.vsBaseline.CA_Q1_2028.lfGapPp}pp`);
f.push(`三家 7 季末现金：${SEATS.map(s => `${s} $${out.seats[s].finalCash.toLocaleString()}`).join(' ｜ ')} → 均为负（初始 2 架 + 固定成本高 → 必须靠融资/出租/提价脱困）`);

writeFileSync(join(HERE, 'rebuild', 'agentplay_summary.json'), JSON.stringify(out, null, 2));
console.log('══ 决策来源与动作成败 ══');
console.log(`  LLM 决策 ${out.coverage.llmDecisions} 次｜规则兜底 ${out.coverage.fallbackDecisions} 次（${out.coverage.fallbackRate}%）`);
console.log(`  动作接受率 ${out.coverage.acceptRate}%（${out.coverage.actionsAccepted} 接受 / ${out.coverage.actionsRejected} 拒绝）`);
for (const s of SEATS) console.log(`   ${s} ${STYLE[s]}：LLM ${src[s].llm}／兜底 ${src[s].fallback}｜接受 ${src[s].applied} 拒绝 ${src[s].rejected}`);
console.log('\n══ 7 季经营轨迹 ══');
console.log('季   ' + SEATS.map(s => s.padEnd(22)).join(''));
R.seasons.forEach((se, i) => {
  const cells = SEATS.map(s => { const v = se.seats[s];
    return (`收入 ${Math.round((v.revenue || 0) / 1000)}k LF ${((v.load_factor || 0) * 100).toFixed(0)}% 份额 ${((v.share || 0) * 100).toFixed(0)}%`).padEnd(22); });
  console.log(`T${i}  ` + cells.join(''));
});
console.log('\n══ 三家定位对比（7 季累计）══');
for (const s of SEATS) { const v = out.seats[s];
  console.log(`  ${s} ${v.style}：累计利润 $${Math.round(v.cumProfit).toLocaleString()}｜累计收入 $${Math.round(v.cumRevenue).toLocaleString()}｜平均 LF ${(v.avgLF * 100).toFixed(1)}%｜峰值 LF ${(v.maxLF * 100).toFixed(1)}%｜末份额 ${((v.finalShare || 0) * 100).toFixed(1)}%｜末现金 $${v.finalCash.toLocaleString()}`); }
console.log('\n══ 首季 vs 原版 CA Q1 2028 ══');
console.log(`  原版：收入 $${baseCA.revenue.toLocaleString()}｜LF ${(baseCA.load_factor * 100).toFixed(1)}%｜margin ${(baseCA.net_margin * 100).toFixed(2)}%｜期末现金 $${baseCA.closing_cash.toLocaleString()}`);
console.log(`  演练：收入 $${(t0.CA.revenue || 0).toLocaleString()}（${out.vsBaseline.CA_Q1_2028.revenueRatio}×）｜LF ${((t0.CA.load_factor || 0) * 100).toFixed(1)}%（差 ${out.vsBaseline.CA_Q1_2028.lfGapPp}pp）｜期末现金 $${t0.CA.cash.toLocaleString()}`);
console.log('\n══ 结论 ══');
for (const x of f) console.log('  · ' + x);
console.log('\n已写入 rebuild/agentplay_summary.json');
