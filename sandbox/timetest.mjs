/* ============================================================
   航线「距离 × 时间」一致性回归
   sandbox/timetest.mjs   （运行：node timetest.mjs）
   ============================================================ */
import { auditRoutes } from '../rebuild/audit_route_time.mjs';
let pass = 0, fail = 0;
const ok = (c, m, n) => { if (c) { pass++; console.log('  ✓ ' + m + (n ? '  ' + n : '')); } else { fail++; console.log('  ✗ ' + m + (n ? '  ' + n : '')); } };
const A = auditRoutes();
console.log('航线距离/时间一致性回归');
ok(A.issues.length === 0, '全部航线通过距离/时间校验', A.issues.join('; '));
ok(A.rows.length === 10, '航线数 10 条', String(A.rows.length));
for (const r of A.rows) {
  ok(r.spd >= 300 && r.spd <= 900, `${r.code} 隐含速度 ${r.spd} km/h 在 300–900`);
  ok(r.km > 0 && r.bh > 0, `${r.code} 距离 ${r.km}km / 单程 ${r.bh}h 合法`);
}
const sim = A.rows.find(r => r.code === 'SIM');
ok(sim.perDay.LCC >= 2 && sim.perDay.FSC >= 2, '短程 SIM 每机每日 2 班（三风格均可）', JSON.stringify(sim.perDay));
for (const code of ['ARM', 'BZY', 'GEE']) {
  const r = A.rows.find(x => x.code === code);
  ok(r.remoteOnly === true, `${code} 标记为超长航线（须远程机型）`);
}
console.log('─'.repeat(60));
console.log(`航线时间一致性：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
process.exit(fail ? 1 : 0);
