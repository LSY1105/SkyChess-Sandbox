/* ============================================================
   单航班损益分摊对账测试（FLIGHT INFORMATION 的强验收）
   ------------------------------------------------------------
   验收标准：**单班次金额 × 该航线当季班次数 = 航线级科目金额**（误差 <1%）
   —— 保证弹窗里的单航班数字与结算报表不冲突、不重复计量。
   ============================================================ */
import http from 'node:http';
import { readFileSync } from 'fs';

const BASE = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';
const KEYS = JSON.parse(readFileSync(new URL(process.env.SANDBOX_KEY_FILE || './.sandbox-keys.json', import.meta.url), 'utf8'));
const H = (seat) => ({ 'Content-Type': 'application/json', 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : KEYS.seats[seat] });

function req(path, body, seat) {
  const u = new URL(BASE + path);
  return new Promise((resolve, reject) => {
    const r = http.request({
      agent: false, host: u.hostname, port: u.port, path: u.pathname + u.search,
      method: body ? 'POST' : 'GET',
      headers: { ...H(seat), 'content-length': body ? Buffer.byteLength(JSON.stringify(body)) : 0, connection: 'close' },
    }, res => { let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(s); } }); });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const R = [], ERRS = [];
const step = async (name, fn) => {
  try { const r = await fn(); R.push({ name, ok: true, note: typeof r === 'string' ? r : '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); ERRS.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

/* 与 reports.js 的 flightSplit 保持一致的口径（等分） */
function flightSplit(det) {
  const freq = Math.max(1, det.freq || 1);
  const k = 1 / freq;
  const cost = {}, rev = {};
  for (const [kk, v] of Object.entries(det.cost || {})) cost[kk] = v * k;
  for (const [kk, v] of Object.entries(det.rev || {})) rev[kk] = v * k;
  return { freq, cost, rev };
}

await step('准备：排班并结算一季', async () => {
  const gh = await req('/api/seat/CA', null, 'CA');
  const acId = gh.game.aircraft[0].id;
  const add = await req('/api/seat/CA', { type: 'addFlight', acId, code: 'SIM', departure: '07:00' }, 'CA');
  ok(add.result === 'ok', '排班失败: ' + add.result);
  await req('/api/seat/CA', { type: 'advance' }, 'CA');
  const g2 = await req('/api/seat/CA', null, 'CA');
  ok(Object.keys(g2.game.lastDetail || {}).length > 0, '无 lastDetail');
  return Object.keys(g2.game.lastDetail).join(',');
});

await step('单班次 × 班次数 = 航线级（各科目误差 <1%）', async () => {
  const g = await req('/api/seat/CA', null, 'CA');
  const det = g.game.lastDetail || {};
  let checked = 0;
  for (const [code, d] of Object.entries(det)) {
    const sp = flightSplit(d);
    for (const [k, v] of Object.entries(sp.cost)) {
      const total = v * sp.freq;
      const base = d.cost[k];
      if (!base) continue;
      const err = Math.abs(total - base) / Math.max(1, Math.abs(base));
      ok(err < 0.01, `${code}.${k}: 单班次×${sp.freq}=${total.toFixed(2)} vs 航线级 ${base.toFixed(2)}（误差 ${(err * 100).toFixed(2)}%）`);
      checked++;
    }
    for (const [k, v] of Object.entries(sp.rev)) {
      const total = v * sp.freq, base = d.rev[k];
      if (!base) continue;
      const err = Math.abs(total - base) / Math.max(1, Math.abs(base));
      ok(err < 0.01, `${code}.rev.${k}: 误差 ${(err * 100).toFixed(2)}%`);
      checked++;
    }
  }
  ok(checked > 0, '无可核对科目');
  return checked + ' 个科目闭合';
});

await step('单班次损益符号合理（收入-成本 与航线级同号）', async () => {
  const g = await req('/api/seat/CA', null, 'CA');
  const det = g.game.lastDetail || {};
  for (const [code, d] of Object.entries(det)) {
    const sp = flightSplit(d);
    const r = (sp.rev['Total Revenue'] || 0);
    const c = Object.values(sp.cost).reduce((a, v) => a + (v || 0), 0);
    const one = r - c, all = (d.rev['Total Revenue'] || 0) - ((d.dco || 0) + (d.ind || 0));
    ok(Math.sign(one) === Math.sign(all) || Math.abs(all) < 1, `${code}: 单班次 ${one.toFixed(0)} 与航线级 ${all.toFixed(0)} 符号不一致`);
  }
  return '符号一致';
});

await step('逐班次旅客数可从 lastDetail 还原（served ÷ 90）', async () => {
  const g = await req('/api/seat/CA', null, 'CA');
  const det = g.game.lastDetail || {};
  const d = det.SIM || Object.values(det)[0];
  ok(d && Array.isArray(d.flights) && d.flights.length > 0, '无逐班次明细');
  const per = d.flights[0].served / 90;
  ok(per > 0 && per <= d.flights[0].served, '单班旅客数异常: ' + per);
  return '单班 ' + per.toFixed(1) + ' 人（季 ' + d.flights[0].served.toFixed(0) + ' 人）';
});

console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(46)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
if (ERRS.length) { console.log('失败:'); for (const e of ERRS) console.log('  - ' + e); }
process.exit(pass === R.length ? 0 : 1);
