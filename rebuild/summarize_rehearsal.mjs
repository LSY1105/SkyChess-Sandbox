/* ============================================================
   7 季演练汇总 + 三机制验证表
   rebuild/summarize_rehearsal.mjs
   ============================================================ */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const R = JSON.parse(readFileSync(join(HERE, 'sandbox', 'replay_out', 'agentplay.json'), 'utf8'));
const SEATS = ['CA', 'AB', 'VA'];
const STYLE = { CA: 'LCC 低成本型', AB: 'FSC 全服务型', VA: 'Hybrid 混合型' };
const rows = R.seasons.map(se => {
  const o = { turn: se.turn, judge: (se.judgeActs || []).join('、'), seats: {} };
  for (const s of SEATS) {
    const v = se.seats[s];
    const d = (se.decisions || []).find(x => x.seat === s) || {};
    o.seats[s] = { cash: v.cash, revenue: v.revenue, op: v.operating_profit, lf: v.load_factor,
                   share: v.share, sched: v.schedules, routes: (v.routes || []).join('+'),
                   blocked: !!d.blocked, fallback: !!d.fallback, note: d.note || '',
                   applied: (d.applied || []).length, rejected: (d.rejected || []).length,
                   rejWhy: (d.rejected || []).map(x => x.why).filter(Boolean) };
  }
  return o;
});
/* 三机制验证 */
const mech = { attack: [], heavyCheck: [], slotGrab: [] };
for (const se of R.seasons) {
  const j = (se.judgeActs || []).join('、');
  if (/event:cyber/.test(j)) {
    const seat = (j.match(/event:cyber.*/) || [''])[0];
    for (const s of SEATS) {
      const d = se.seats[s], dec = (se.decisions || []).find(x => x.seat === s) || {};
      if (dec.blocked) mech.attack.push({ turn: se.turn, seat: s, blocked: true,
        effect: `本季无法操作（收入 ${Math.round(d.revenue / 1000)}k、LF ${((d.load_factor || 0) * 100).toFixed(1)}%）` });
    }
  }
  if (/heavyCheck/.test(j)) {
    for (const s of SEATS) {
      const d = se.seats[s];
      mech.heavyCheck.push({ turn: se.turn, seat: s, note: (j.match(/heavyCheck:[^、]*/) || ['heavyCheck'])[0],
        effect: `收入 ${Math.round(d.revenue / 1000)}k、LF ${((d.load_factor || 0) * 100).toFixed(1)}%、班次 ${d.schedules}` });
    }
  }
}
for (const se of R.seasons) for (const s of SEATS) {
  const d = (se.decisions || []).find(x => x.seat === s) || {};
  for (const w of (d.rejWhy || [])) if (/抢占|时刻/.test(w))
    mech.slotGrab.push({ turn: se.turn, seat: s, why: w });
}
/* 汇总输出 */
console.log('══ 逐季指标 ══');
for (const r of rows) {
  console.log('\n【第 ' + r.turn + ' 季】裁判动作：' + (r.judge || '—'));
  for (const s of SEATS) {
    const v = r.seats[s];
    console.log('  ' + s + ' ' + STYLE[s] + '｜现金 ' + Math.round(v.cash).toLocaleString()
      + '｜收入 ' + (v.revenue != null ? Math.round(v.revenue).toLocaleString() : '—')
      + '｜利润 ' + (v.op != null ? Math.round(v.op).toLocaleString() : '—')
      + '｜LF ' + (v.lf != null ? (v.lf * 100).toFixed(1) + '%' : '—')
      + '｜份额 ' + (v.share != null ? (v.share * 100).toFixed(1) + '%' : '—')
      + '｜班次 ' + v.sched + '｜' + (v.blocked ? '⛔面板被攻击·无法操作' : (v.fallback ? '↩规则兜底' : '🤖Agent决策'))
      + '｜' + v.note);
  }
}
console.log('\n══ 三机制验证表 ══');
console.log('① 网络攻击 → 面板全屏不可操作：' + (mech.attack.length ? '' : '本次演练未触发到被攻击组'));
for (const x of mech.attack) console.log('   T' + x.turn + ' ' + x.seat + '：' + x.effect);
console.log('② 裁判触发大修 → 运力减半：');
for (const x of mech.heavyCheck) console.log('   T' + x.turn + ' ' + x.seat + '：' + x.note + ' → ' + x.effect);
console.log('③ 时刻抢占（其他航司被拒）：' + (mech.slotGrab.length ? mech.slotGrab.length + ' 次' : '本次未出现'));
for (const x of mech.slotGrab.slice(0, 8)) console.log('   T' + x.turn + ' ' + x.seat + '：' + x.why);
const sum = {};
for (const s of SEATS) {
  const vs = rows.map(r => r.seats[s]);
  sum[s] = { style: STYLE[s], cumProfit: vs.reduce((a, v) => a + (v.op || 0), 0),
             cumRevenue: vs.reduce((a, v) => a + (v.revenue || 0), 0),
             avgLF: +(vs.reduce((a, v) => a + (v.lf || 0), 0) / vs.length).toFixed(4),
             finalCash: vs[vs.length - 1].cash, blocked: vs.filter(v => v.blocked).length,
             fallback: vs.filter(v => v.fallback).length, scheds: vs.map(v => v.sched).join('→') };
}
console.log('\n══ 三家 7 季汇总 ══');
for (const s of SEATS) {
  const v = sum[s];
  console.log('  ' + s + ' ' + v.style + '：累计利润 $' + Math.round(v.cumProfit).toLocaleString()
    + '｜累计收入 $' + Math.round(v.cumRevenue).toLocaleString()
    + '｜平均 LF ' + (v.avgLF * 100).toFixed(1) + '%｜末现金 $' + Math.round(v.finalCash).toLocaleString()
    + '｜停摆 ' + v.blocked + ' 季｜兜底 ' + v.fallback + ' 季｜班次轨迹 ' + v.scheds);
}
writeFileSync(join(HERE, 'rebuild', 'rehearsal_summary.json'), JSON.stringify({ rows, mech, sum }, null, 2));
console.log('\n已写入 rebuild/rehearsal_summary.json');
