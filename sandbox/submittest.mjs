/* ============================================================
   提交与结算端到端测试（node:http 直连，不依赖 jsdom）
   覆盖：排班 → 提交(advance) → 生成历史 → 报表出现 → 负现金提示
   ★ 从 paneltest.mjs 拆出：那里的同类断言与页面轮询并发会随机 ECONNRESET
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

console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(46)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
if (ERRS.length) { console.log('失败:'); for (const e of ERRS) console.log('  - ' + e); }
process.exit(pass === R.length ? 0 : 1);
