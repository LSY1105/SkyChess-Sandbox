/* ============================================================
   开局面规格测试 —— 通过**真实服务端**锁定三组初始航线/机队/现金/定位
   一手依据：原版复盘结论（server.mjs 注释）：
     Simone 独飞 CA｜Parker 独飞 AB｜Fitzgerald 独飞 VA｜Ellington 三家共享（CA 份额 48.40%）
   ★ 走 HTTP 而非 newGame()：初始现金差异与航司定位由 server.mjs 的席位规格决定，
     直接调 newGame 会漏测 → 故本测试针对**真实开局面**。
   ============================================================ */
import http from 'node:http';
import { readFileSync } from 'fs';

const BASE = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';
const KEYS = JSON.parse(readFileSync(new URL(process.env.SANDBOX_KEY_FILE || './.sandbox-keys.json', import.meta.url), 'utf8'));
const H = (seat) => ({ 'Content-Type': 'application/json', 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : KEYS.seats[seat] });

function req(path, body, seat) {
  const u = new URL(BASE + path);
  return new Promise((resolve, reject) => {
    const r = http.request({ agent: false, host: u.hostname, port: u.port, path: u.pathname + u.search,
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

const games = {};
for (const s of ['CA', 'AB', 'VA']) games[s] = (await req('/api/seat/' + s, null, s)).game;

await step('CA 初始航线 = SIM + ETN', () => {
  const g = games.CA;
  const c = g.routes.map(r => r.code).sort();
  ok(c.join(',') === 'ETN,SIM', '实际 ' + c.join(','));
  return c.join(' + ');
});
await step('AB 初始航线 = PKR + ETN', () => {
  const g = games.AB;
  const c = g.routes.map(r => r.code).sort();
  ok(c.join(',') === 'ETN,PKR', '实际 ' + c.join(','));
  return c.join(' + ');
});
await step('VA 初始航线 = FTZ + ETN', () => {
  const g = games.VA;
  const c = g.routes.map(r => r.code).sort();
  ok(c.join(',') === 'ETN,FTZ', '实际 ' + c.join(','));
  return c.join(' + ');
});
await step('航线结构：仅 ETN 共享，其余各组独占', () => {
  const sets = {};
  for (const s of ['CA', 'AB', 'VA']) sets[s] = new Set(games[s].routes.map(r => r.code));
  const shared = ['CA', 'AB', 'VA'].filter(s => ['ETN'].every(x => sets[s].has(x)));
  ok(shared.length === 3, 'ETN 应为三家共享');
  const CAonly = [...sets.CA].filter(x => x !== 'ETN');
  const ABonly = [...sets.AB].filter(x => x !== 'ETN');
  const VAonly = [...sets.VA].filter(x => x !== 'ETN');
  ok(CAonly.length === 1 && ABonly.length === 1 && VAonly.length === 1, '各组应各有一条独占航线');
  ok(!(CAonly[0] === ABonly[0] || CAonly[0] === VAonly[0] || ABonly[0] === VAonly[0]), '独占航线不得重复');
  return `共享 ${shared.join('/')}｜独占 ${CAonly[0]}/${ABonly[0]}/${VAonly[0]}`;
});
await step('初始机队：每组 2 架（APT100 + G160），均为自有', () => {
  for (const s of ['CA', 'AB', 'VA']) {
    const g = games[s];
    ok(g.aircraft.length === 2, `${s} 机队数 ${g.aircraft.length}`);
    ok(g.aircraft.every(a => a.owned), `${s} 含非自有飞机`);
    ok(g.aircraft.some(a => a.type === 'APT100') && g.aircraft.some(a => a.type === 'G160'), `${s} 机型不符`);
  }
  return '三组一致';
});
await step('初始现金：CA $2,000,000 / AB $3,200,000 / VA $3,600,000', () => {
  const exp = { CA: 2000000, AB: 3200000, VA: 3600000 };
  for (const s of ['CA', 'AB', 'VA']) {
    const g = games[s];
    ok(g.cash === exp[s], `${s} 现金 ${g.cash} ≠ ${exp[s]}`);
  }
  return '三组一致';
});
await step('初始无排班 / 无投资 / 无提案（干净起点）', () => {
  for (const s of ['CA', 'AB', 'VA']) {
    const g = games[s];
    ok((g.schedules || []).length === 0, `${s} 初始有排班`);
    ok((g.investments || []).length === 0, `${s} 初始有投资`);
    ok((g.proposals || []).length === 0, `${s} 初始有提案`);
    ok((g.assets || []).length === 0, `${s} 初始有资产`);
  }
  return '干净';
});
await step('初始航司定位：CA=LCC / AB=FSC / VA=Hybrid', () => {
  const exp = { CA: 'LCC', AB: 'FSC', VA: 'Hybrid' };
  for (const s of ['CA', 'AB', 'VA']) {
    const g = games[s];
    const st = g.style || 'Hybrid';
    ok(st === exp[s], `${s} 定位 ${st} ≠ ${exp[s]}`);
  }
  return '一致';
});

console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(48)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
if (ERRS.length) { console.log('失败:'); for (const e of ERRS) console.log('  - ' + e); }
process.exit(pass === R.length ? 0 : 1);
