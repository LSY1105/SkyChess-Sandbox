/* ============================================================
   演练版本对照：旧版（无扩张通道） vs 当前版（B方案 + 双口径 + 过站强约束）
   rebuild/compare_rehearsals.mjs
   ============================================================ */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const R = JSON.parse(readFileSync(join(HERE, 'sandbox', 'replay_out', 'agentplay.json'), 'utf8'));
let BASE = null;
try { BASE = JSON.parse(readFileSync(join(HERE, 'rebuild', 'agentplay_summary.json'), 'utf8')); } catch { }
const SEATS = ['CA', 'AB', 'VA'];
const STYLE = { CA: 'LCC 低成本型', AB: 'FSC 全服务型', VA: 'Hybrid 混合型' };
const cur = {};
for (const s of SEATS) {
  const rows = R.seasons.map(se => se.seats[s]);
  cur[s] = { cash: rows.map(r => r.cash), revenue: rows.map(r => r.revenue), lf: rows.map(r => r.load_factor),
              share: rows.map(r => r.share), cumProfit: rows.reduce((a, r) => a + (r.operating_profit || 0), 0),
              cumRevenue: rows.reduce((a, r) => a + (r.revenue || 0), 0),
              finalCash: rows[rows.length - 1].cash, avgLF: +(rows.reduce((a, r) => a + (r.load_factor || 0), 0) / rows.length).toFixed(4) };
}
const out = { generatedAt: new Date().toISOString(), current: cur,
  baseline: BASE ? { CA: BASE.seats.CA, AB: BASE.seats.VA ? BASE.seats.VA : BASE.seats.VA, VA: BASE.seats.VA } : null,
  summary: {} };
if (BASE) {
  for (const s of SEATS) {
    const b = BASE.seats[s], c = cur[s];
    out.summary[s] = {
      cumProfit_old: b.cumProfit, cumProfit_new: c.cumProfit, profitDelta: c.cumProfit - b.cumProfit,
      avgLF_old: b.avgLF, avgLF_new: c.avgLF, lfDeltaPp: +(((c.avgLF - b.avgLF) * 100)).toFixed(1),
      finalCash_old: b.finalCash, finalCash_new: c.finalCash,
      cumRevenue_old: b.cumRevenue, cumRevenue_new: c.cumRevenue,
    };
  }
  out.findings = [
    `决策来源：当前版 LLM ${R.seasons.length} 季中可用决策占比见 agentplay_summary（本次重跑后更新）`,
    `CA 累计利润 ${Math.round(out.summary.CA.profitDelta).toLocaleString()}（旧 ${Math.round(out.summary.CA.cumProfit_old).toLocaleString()} → 新 ${Math.round(out.summary.CA.cumProfit_new).toLocaleString()}）`,
    `CA 平均 LF ${(out.summary.CA.avgLF_old * 100).toFixed(1)}% → ${(out.summary.CA.avgLF_new * 100).toFixed(1)}%`,
    `三家末现金：${SEATS.map(s => `${s} $${Math.round(cur[s].finalCash).toLocaleString()}`).join(' ｜ ')}`,
    `是否转正：${SEATS.every(s => cur[s].cumProfit > 0) ? '三家累计盈利' : '仍为负（见结论）'}`,
  ];
}
writeFileSync(join(HERE, 'rebuild', 'replay_comparison.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('══ 版本对照（旧版 → 当前版）══');
for (const s of SEATS) {
  if (!BASE) break;
  const b = out.summary[s], c = cur[s];
  console.log(`  ${s} ${STYLE[s]}：累计利润 $${Math.round(b.cumProfit_old).toLocaleString()} → $${Math.round(b.cumProfit_new).toLocaleString()}` +
    `（Δ ${Math.round(b.profitDelta).toLocaleString()}）｜平均 LF ${(b.avgLF_old * 100).toFixed(1)}% → ${(b.avgLF_new * 100).toFixed(1)}%（Δ ${b.lfDeltaPp}pp）｜末现金 $${Math.round(c.finalCash).toLocaleString()}`);
}
if (out.findings) { console.log('\n══ 结论 ══'); for (const f of out.findings) console.log('  · ' + f); }
console.log('\n已写入 rebuild/replay_comparison.json');
