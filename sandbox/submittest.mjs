/* ============================================================
   提交与结算端到端测试（node:http 直连，不依赖 jsdom）
   覆盖：排班 → 提交(advance) → 生成历史 → 报表出现 → 负现金提示
   ★ 从 paneltest.mjs 拆出：那里的同类断言与页面轮询并发会随机 ECONNRESET
   ============================================================ */
import http from 'node:http';
import { readFileSync } from 'fs';
import { isAbsolute } from 'path';

const BASE = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';
/* ★ 密钥文件：相对路径按模块解析，**绝对路径直接用**（new URL('C:\...') 会变成 c: 协议而拿不到） */
const _KF = process.env.SANDBOX_KEY_FILE
  ? (isAbsolute(process.env.SANDBOX_KEY_FILE) ? process.env.SANDBOX_KEY_FILE : new URL(process.env.SANDBOX_KEY_FILE, import.meta.url))
  : new URL('./.sandbox-keys.json', import.meta.url);
const KEYS = JSON.parse(readFileSync(_KF, 'utf8'));
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

const R = []; const ERRS = [];
const step = async (name, fn) => {
  try { const r = await fn(); R.push({ name, ok: true, note: typeof r === 'string' ? r : '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); ERRS.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

await step('排班并提交产生历史', async () => {
  const gh = await req('/api/seat/CA', null, 'CA');
  const acId = gh.game.aircraft[0].id;
  const add = await req('/api/seat/CA', { type: 'addFlight', acId, code: 'SIM', departure: '07:00' }, 'CA');
  ok(add.result === 'ok', '排班失败: ' + add.result);
  const adv = await req('/api/seat/CA', { type: 'advance' }, 'CA');
  const gh2 = await req('/api/seat/CA', null, 'CA');
  ok(gh2.game.history && gh2.game.history.length > 0, '提交后无历史记录');
  return gh2.game.history.length + ' 个季度';
});

await step('结算后 lastDetail 含逐班次旅客数', async () => {
  const gh = await req('/api/seat/CA', null, 'CA');
  const d = gh.game.lastDetail || {};
  const codes = Object.keys(d);
  ok(codes.length > 0, '无 lastDetail');
  const hasFlights = codes.some(c => Array.isArray(d[c].flights) && d[c].flights.length);
  ok(hasFlights, 'lastDetail 无逐班次明细');
  return codes.length + ' 条航线';
});

await step('历史报告含收益与客座率', async () => {
  const gh = await req('/api/seat/CA', null, 'CA');
  const h = (gh.game.history || [])[0];
  ok(h && typeof h.revenue === 'number', '历史缺 revenue');
  ok(typeof h.load_factor === 'number', '历史缺 load_factor');
  return 'revenue=' + Math.round(h.revenue) + ' LF=' + (h.load_factor * 100).toFixed(1) + '%';
});

await step('FLIGHTS 页签数据源就绪（peerSchedules 含运价）', async () => {
  const gh = await req('/api/seat/CA', null, 'CA');
  const ps = gh.game.peerSchedules || {};
  const seats = Object.keys(ps);
  ok(seats.length >= 3, 'peerSchedules 组数不足: ' + seats.length);
  const withFare = seats.filter(s => (ps[s].schedules || []).some(x => x.fare != null));
  ok(withFare.length > 0, 'peerSchedules 未下发 fare');
  return seats.length + ' 组';
});

/* ★ 回归护栏（2026-11-17）：学员手输「12」这类**缺分钟**的起飞时刻曾入库 →
   结算时解析出 NaN → 单班 NaN 经 reduce 把**整季**收入/成本/利润/现金全污染成 null
   → 小组端报表整页「—」（用户报「小组页面数据显示缺失」）。 */
await step('缺分钟时刻被归一化为 HH:MM（12 → 12:00）', async () => {
  const gh = await req('/api/seat/CA', null, 'CA');
  const acId = gh.game.aircraft[0].id;
  const add = await req('/api/seat/CA', { type: 'addFlight', acId, code: 'SIM', departure: '12' }, 'CA');
  ok(add.result === 'ok', '排班被拒: ' + add.result);
  const g2 = await req('/api/seat/CA', null, 'CA');
  const fl = (g2.game.schedules || []).find(x => x.departure === '12:00');
  ok(!!fl, '起飞时刻未归一化: ' + JSON.stringify((g2.game.schedules || []).map(x => x.departure)));
  const bad = await req('/api/seat/CA', { type: 'addFlight', acId, code: 'SIM', departure: 'abc' }, 'CA');
  ok(bad.result !== 'ok', '非法时刻应被拒绝');
  return '12 → 12:00；非法值已拒';
});

await step('缺分钟时刻不污染整季（结算后报表各项为有限数）', async () => {
  await req('/api/seat/CA', { type: 'advance' }, 'CA');
  const gh = await req('/api/seat/CA', null, 'CA');
  const h = (gh.game.history || [])[gh.game.history.length - 1];
  ok(h, '无历史报告');
  for (const k of ['revenue', 'cost', 'operating_profit', 'load_factor', 'cash_end', 'gross_margin']) {
    ok(Number.isFinite(h[k]), '报告字段被污染: ' + k + '=' + JSON.stringify(h[k]));
  }
  ok(Number.isFinite(gh.game.cash), '组现金被污染: ' + JSON.stringify(gh.game.cash));
  ok(h.revenue > 0, '收入为 0');
  return 'revenue=' + Math.round(h.revenue) + ' LF=' + (h.load_factor * 100).toFixed(1) + '% cash=' + Math.round(gh.game.cash);
});


/* ★ 11-20 回归（用户实测）：同一架飞机的回程路上，却能再排一班去程
   原因：占用判定只比「两个起飞时刻之差」，且用的 minGap 只有「单程 + 过站」
   → 上一班还在回程航段（11:32→13:04）就能排 12:00 的去程 → 同机同时出现在两地
   现模型：每班占用 [起点, 回程到达]，回程落地后即可再推 */
await step('同机回程路上不得再排去程（占用区间重叠）', async () => {
  const gh = await req('/api/seat/CA', null, 'CA');
  const cnt = (id) => (gh.game.schedules || []).filter(s => s.acId === id).length;
  const ac = gh.game.aircraft.slice().sort((a, b) => cnt(a.id) - cnt(b.id))[0];
  for (let i = (gh.game.schedules || []).length - 1; i >= 0; i--) {
    if (gh.game.schedules[i].acId === ac.id) await req('/api/seat/CA', { type: 'removeFlight', index: i }, 'CA');
  }
  const a1 = await req('/api/seat/CA', { type: 'addFlight', acId: ac.id, code: 'SIM', departure: '09:00' }, 'CA');
  ok(a1.result === 'ok', '09:00 去程排班成功', String(a1.result));
  const g2 = await req('/api/seat/CA', null, 'CA');
  const sc = (g2.game.schedules || []).find(s => s.acId === ac.id);
  ok(!!sc && sc.returnArrival === '13:04', `默认回程落地 = ${sc && sc.returnArrival}（应为 13:04）`);
  const a2 = await req('/api/seat/CA', { type: 'addFlight', acId: ac.id, code: 'SIM', departure: '12:00' }, 'CA');
  ok(a2.result !== 'ok', '回程路上（12:00）再排去程必须被拒', String(a2.result));
  const a3 = await req('/api/seat/CA', { type: 'addFlight', acId: ac.id, code: 'SIM', departure: '14:30' }, 'CA');
  ok(a3.result === 'ok', '回程落地（13:04）之后（14:30）可再排班', String(a3.result));
});

await step('回程时刻拖晚撞下一班必须被拒', async () => {
  const gh = await req('/api/seat/CA', null, 'CA');
  const cnt = (id) => (gh.game.schedules || []).filter(s => s.acId === id).length;
  const ac = gh.game.aircraft.slice().sort((a, b) => cnt(a.id) - cnt(b.id))[0];
  for (let i = (gh.game.schedules || []).length - 1; i >= 0; i--) {
    if (gh.game.schedules[i].acId === ac.id) await req('/api/seat/CA', { type: 'removeFlight', index: i }, 'CA');
  }
  await req('/api/seat/CA', { type: 'addFlight', acId: ac.id, code: 'SIM', departure: '09:00' }, 'CA');
  await req('/api/seat/CA', { type: 'addFlight', acId: ac.id, code: 'SIM', departure: '16:00' }, 'CA');
  const g2 = await req('/api/seat/CA', null, 'CA');
  const idx = g2.game.schedules.findIndex(s => s.acId === ac.id && s.departure === '09:00');
  const bad = await req('/api/seat/CA', { type: 'setReturnFlight', index: idx, departure: '15:00' }, 'CA');
  ok(bad.result !== 'ok', '把回程拖到 15:00（落地 16:32）撞上 16:00 那班 → 必须被拒', String(bad.result));
});

console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(46)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
if (ERRS.length) { console.log('失败:'); for (const e of ERRS) console.log('  - ' + e); }
process.exit(pass === R.length ? 0 : 1);
