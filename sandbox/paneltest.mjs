/* ============================================================
   玩家面板 / 裁判面板 DOM 冒烟测试
   ------------------------------------------------------------
   用真实服务端 + jsdom 渲染 player.html 与 teacher.html，
   断言：脚本无异常、关键板块有内容、按钮可点击、API 被正确调用。
   ============================================================ */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:8765';
/* 席位授权：服务端要求 x-sandbox-key */
const KEYS = JSON.parse(readFileSync(new URL('./.sandbox-keys.json', import.meta.url), 'utf8'));
const KH = (seat) => ({ 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : (KEYS.seats[seat] || KEYS.teacher) });
const KHdr = (seat) => ({ 'Content-Type': 'application/json', ...KH(seat) });

const R = [];
const step = async (name, fn) => {
  try { const r = await fn(); R.push({ name, ok: true, note: typeof r === 'string' ? r : '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

/** 渲染一个页面并返回 {window, doc, errors} */
async function render(file, url) {
  const html = readFileSync(join(HERE, file), 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html.replace(/<script type="module">[\s\S]*?<\/script>/, ''), {
    runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
  });
  const { window } = dom;
  const body = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const tmp = join(HERE, '_smoke_' + file.replace(/\W/g, '') + '.mjs');
  writeFileSync(tmp, body);
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.alert = () => {};
  globalThis.confirm = () => true;
  globalThis.prompt = () => 'G2';
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: window.location, configurable: true, writable: true });
  globalThis.Event = window.Event;
  // fetch 走真实服务端
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, o) => realFetch(String(u).startsWith('http') ? u : BASE + u, o);
  window.fetch = globalThis.fetch;
  await import('file://' + tmp.replace(/\\/g, '/'));
  /* 等页面自身的异步链（fetch → 渲染 → 速览/测算器等并发请求）彻底跑完：
     player.html 与 teacher.html 先后渲染于同一 JS 全局，若未等完，前者的回调会落到后者的文档上 */
  for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 250));
  return { window, doc: window.document, errors, cleanup: () => { try { unlinkSync(tmp); } catch {} } };
}

await step('服务端可达', async () => {
  const r = await fetch(BASE + '/api/gm', { headers: KH('teacher') });
  ok(r.ok, 'HTTP ' + r.status);
  await fetch(BASE + '/api/reset', { method: 'POST', headers: KHdr('teacher') });
  return 'ok';
});

/* ─────────── 玩家面板 ─────────── */
let P = null;
await step('player.html 渲染无异常', async () => {
  P = await render('player.html', BASE + '/player.html?seat=CA&key=' + KEYS.seats.CA);
  ok(P.errors.length === 0, 'JS 错误: ' + P.errors.join(' | '));
  return '0 错误';
});

await step('玩家面板 头部指标已填充', async () => {
  const d = P.doc;
  ok(d.querySelector('#hPeriod').textContent.includes('Q'), '期间未渲染');
  ok(d.querySelector('#hCash').textContent.includes('$'), '现金未渲染');
  ok(d.querySelector('#hQsi').textContent !== '—', 'QSI 未渲染');
  return `${d.querySelector('#hPeriod').textContent} 现金 ${d.querySelector('#hCash').textContent}`;
});

await step('玩家面板 航线表有行', async () => {
  const n = P.doc.querySelectorAll('#tblRoutes tr').length;
  ok(n > 1, '航线表为空');
  return n - 1 + ' 行';
});

await step('玩家面板 飞机下拉已填充', async () => {
  const opts = P.doc.querySelectorAll('#selAc option').length;
  ok(opts > 0, '飞机下拉为空');
  return opts + ' 架';
});

await step('玩家面板 市场下拉已填充（排班前置条件）', async () => {
  const opts = [...P.doc.querySelectorAll('#selMkt option')].map(o => o.value);
  ok(opts.includes('SIM'), '市场下拉无 SIM: ' + JSON.stringify(opts));
  return opts.join(',');
});

await step('玩家面板 评分表 / 预览表 / 历史区存在', async () => {
  ok(P.doc.querySelectorAll('#tblScore tr').length > 1, '评分表空');
  ok(P.doc.querySelectorAll('#tblPrev tr').length > 3, '预览表空');
  ok(P.doc.querySelector('#histBody'), '历史区缺失');
  return 'ok';
});

await step('玩家面板 投资面板 4 个子页签', async () => {
  const labels = [...P.doc.querySelectorAll('#tabsInv button')].map(b => b.textContent);
  ok(labels.length === 4, '页签数 ' + labels.length);
  return labels.join('/');
});

/* ★ 2026-11-02 修复：空排班提交被服务端拒绝（避免必然破产的巨额亏损）
   → 本用例改为「先排一班并提交」，使其后能产生历史报告 */
await step('玩家面板 排班并提交产生历史', async () => {
  const gh = await (await fetch(BASE + '/api/seat/CA', { headers: { 'x-sandbox-key': KEYS.seats.CA } })).json();
  const acId = gh.game.aircraft[0].id;
  await fetch(BASE + '/api/seat/CA', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sandbox-key': KEYS.seats.CA },
    body: JSON.stringify({ type: 'addFlight', acId, code: 'SIM', departure: '07:00' }) });
  await fetch(BASE + '/api/seat/CA', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sandbox-key': KEYS.seats.CA },
    body: JSON.stringify({ type: 'advance' }) });
  const gh2 = await (await fetch(BASE + '/api/seat/CA', { headers: { 'x-sandbox-key': KEYS.seats.CA } })).json();
  ok(gh2.game.history && gh2.game.history.length > 0, '提交后无历史记录');
  return gh2.game.history.length + ' 个季度';
});

await step('玩家面板 提交按钮可点', async () => {
  const b = P.doc.querySelector('#btnSubmit');
  ok(!b.disabled, '提交按钮被禁用');
  b.click();
  await new Promise(r => setTimeout(r, 800));
  const h = P.doc.querySelector('#histBody');
  ok(!!h, '历史区缺失');
  return '可点';
});

await step('玩家面板 提交后出现历史报告页签', async () => {
  const n = P.doc.querySelectorAll('#tabsHist button').length;
  ok(n > 0, '无历史页签');
  return n + ' 个季度';
});

/* ─────────── 裁判面板 ─────────── */
let T = null;
await step('teacher.html 渲染无异常', async () => {
  T = await render('teacher.html', BASE + '/teacher.html?key=' + KEYS.teacher);
  ok(T.errors.length === 0, 'JS 错误: ' + T.errors.join(' | '));
  return '0 错误';
});

await step('裁判面板 顶栏参数已填充', async () => {
  const d = T.doc;
  ok(d.querySelector('#gFuel').textContent !== '—', '油价未渲染');
  ok(d.querySelector('#gTurn').textContent !== '—', '回合未渲染');
  return `油价 ${d.querySelector('#gFuel').textContent} 碳价 ${d.querySelector('#gCarbon').textContent} 利率 ${d.querySelector('#gRate').textContent}`;
});

await step('裁判面板 席位监控表列出各组', async () => {
  await new Promise(r => setTimeout(r, 900));
  const rows = T.doc.querySelectorAll('#tblSeats tr').length;
  ok(rows > 1, '席位表为空');
  return (rows - 1) + ' 个席位';
});

await step('裁判面板 事件下拉含全部 5 个事件', async () => {
  const opts = [...T.doc.querySelectorAll('#selEvent option')].map(o => o.value);
  ok(opts.length === 5, '事件数 ' + opts.length);
  return opts.join(',');
});

await step('裁判面板 市场列表 10 个', async () => {
  const n = (T.doc.querySelector('#mktList').textContent.match(/·/g) || []).length;
  ok(n === 10, '市场数 ' + n);
  return n + ' 个';
});

await step('裁判面板 改油价 → 广播到玩家面板', async () => {
  T.doc.querySelector('#inFuel').value = '3.75';
  T.doc.querySelector('#btnFuel').click();
  await new Promise(r => setTimeout(r, 900));
  const g = await (await fetch(BASE + '/api/gm', { headers: KH('teacher') })).json();
  ok(g.gm.fuelPrice === 3.75, '服务端油价 ' + g.gm.fuelPrice);
  const ca = await (await fetch(BASE + '/api/seat/CA', { headers: KH('CA') })).json();
  ok(ca.game.fuelPrice === 3.75, 'CA 未收到');
  return '3.75 已广播';
});

await step('裁判面板 触发事件 → 事件历史可审计', async () => {
  T.doc.querySelector('#selEvent').value = 'hail';
  T.doc.querySelector('#selEvent').dispatchEvent(new T.window.Event('change'));
  await new Promise(r => setTimeout(r, 300));
  T.doc.querySelector('#btnEvent').click();
  await new Promise(r => setTimeout(r, 900));
  const g = await (await fetch(BASE + '/api/gm', { headers: KH('teacher') })).json();
  ok(g.gm.events.some(e => (e.id || e.title).toString().includes('hail')), '事件未记录');
  return g.gm.events.length + ' 条事件';
});

await step('裁判面板 结算全部席位', async () => {
  T.doc.querySelector('#btnAdvanceAll').click();
  await new Promise(r => setTimeout(r, 1200));
  const g = await (await fetch(BASE + '/api/gm', { headers: KH('teacher') })).json();
  ok(g.gm.turn > 0, '全局回合未推进');
  return '回合 ' + g.gm.turn;
});

await step('裁判面板 重置全局', async () => {
  T.doc.querySelector('#btnReset').click();
  await new Promise(r => setTimeout(r, 1200));
  const g = await (await fetch(BASE + '/api/gm', { headers: KH('teacher') })).json();
  ok(g.gm.turn === 0, '回合未归零');
  return 'ok';
});

P?.cleanup(); T?.cleanup();

console.log('='.repeat(84));
console.log('★ 玩家面板 / 裁判面板 DOM 冒烟测试');
console.log('='.repeat(84));
console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(44)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
process.exit(pass === R.length ? 0 : 1);
