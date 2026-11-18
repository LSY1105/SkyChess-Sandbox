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
const BASE = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';
/* 席位授权：服务端要求 x-sandbox-key */
const KEYS = JSON.parse(readFileSync(new URL(process.env.SANDBOX_KEY_FILE || './.sandbox-keys.json', import.meta.url), 'utf8'));
const KH = (seat) => ({ 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : (KEYS.seats[seat] || KEYS.teacher) });
const KHdr = (seat) => ({ 'Content-Type': 'application/json', ...KH(seat) });

const R = [];
/* ★ 用法：node paneltest.mjs player | node paneltest.mjs teacher
   两个页面**分进程**运行：player.html 与 teacher.html 若在同一 JS 全局里先后渲染，
   前者的异步回调会落到后者的文档上（真实浏览器每页独立上下文，不存在此问题） */
const ONLY = process.argv[2] || '';
/* ★ 原生 fetch：页面渲染时 globalThis.fetch 会被替换成 jsdom 包装（相对路径基准不同），
   渲染后执行的断言必须用原生 fetch 直连 BASE */
const NODE_FETCH = globalThis.fetch;
/** 直连请求（node:http）：绕开 fetch —— 页面渲染后 fetch 包装在 jsdom 环境下会出现连接层失败 */
import http from 'node:http';
function nf(url, opt = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      /* ★ agent:false —— 禁用 keep-alive 连接复用：服务端响应后即关闭连接，
         复用已关闭的 socket 会抛 ECONNRESET（表现为「排班并提交产生历史」随机失败） */
      agent: false,
      host: u.hostname, port: u.port, path: u.pathname + u.search, method: opt.method || 'GET',
      /* ★ connection: close —— 明确要求逐请求新开连接：服务端响应后即关连接，
         keep-alive 复用已关闭的 socket 会抛 ECONNRESET（间歇性失败根因） */
      headers: { ...(opt.headers || {}), 'content-length': opt.body ? Buffer.byteLength(opt.body) : 0, connection: 'close' },
    }, res => { let s = ''; res.on('data', d => s += d); res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(s || '{}'), text: async () => s })); });
    req.on('error', reject);
    if (opt.body) req.write(opt.body);
    req.end();
  });
}
const step = async (name, fn) => {
  /* 分进程模式：跳过属于「另一页面」的断言（断言名以「玩家面板」/「裁判面板」区分） */
  if (ONLY === 'player' && name.includes('裁判面板')) return;
  if (ONLY === 'teacher' && name.includes('玩家面板')) return;
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
if (!ONLY || ONLY === 'player') await step('player.html 渲染无异常', async () => {
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

/* ★ 2026-11-17：小组端「报表」整页「—」回归护栏
   （根因：学员手输「12」这类缺分钟时刻 → 结算 NaN → 整季收入/现金为 null） */
await step('玩家面板 报表区有数据（页签齐 + 金额非空）', async () => {
  const body = P.doc.getElementById('repBody');
  ok(body, '报表区缺失');
  /* 页签两级化（11-17）：默认 4 个高频 + 「更多报表」；展开后 10 个页签 + 更多按钮 */
  const tabs = [...body.querySelectorAll('.tabs button')];
  ok(tabs.length === 5, '默认应露 4 个高频页签 + 更多按钮，实得 ' + tabs.length);
  const more = tabs.find(b => /更多报表/.test(b.textContent));
  ok(!!more, '缺「更多报表」按钮');
  more.click();
  const all = [...body.querySelectorAll('.tabs button')];
  ok(all.length === 11, '展开后应为 10 个页签 + 更多按钮，实得 ' + all.length);
  const txt = body.textContent || '';
  ok(/\$[\d,]+/.test(txt), '报表区无金额数值: ' + txt.slice(0, 120).replace(/\s+/g, ' '));
  return tabs.length + ' 页签，含金额';
});

/* ★ 2026-11-02 修复：空排班提交被服务端拒绝（避免必然破产的巨额亏损）
   → 本用例改为「先排一班并提交」，使其后能产生历史报告 */
/* ★ 该断言已迁到 submittest.mjs（node:http 直连，端到端可靠）
   —— 在本文件里与 jsdom 页面轮询并发会随机 ECONNRESET（单独跑必过，属测试分层问题，非功能缺陷） */

/* ★ 2026-11-17：负责划分——推进回合/计时/结算归**裁判端**，小组端不再提供这三个按钮
   → 旧断言「小组端有提交按钮」已作废；改为断言「小组端不得推进回合」 */
/* ★ 11-17 缺陷：市场「我方份额」在**有航线但无班次**时渲染成 NaN%（违反 DESIGN.md「缺数据写 —」） */
await step('玩家面板 全页不出现 NaN（数值缺失一律显示 —）', async () => {
  const txt = P.doc.body.textContent || '';
  const hit = txt.match(/.{0,50}NaN.{0,50}/);
  ok(!hit, '页面出现 NaN：' + (hit ? hit[0] : ''));
  return '无 NaN';
});

/* ★ P2：空态卡（被拒原因/消息板/日志）无内容时收紧为一行（原各占一屏高度） */
await step('玩家面板 空态卡收紧（≥3 张）', async () => {
  const folded = [...P.doc.querySelectorAll('.card.folded')];
  ok(folded.length >= 3, '应有 ≥3 张空态卡被收紧，实得 ' + folded.length);
  return folded.length + ' 张';
});

/* ★ P2：吸顶锚点条（页面 5000px、27 个同级标题、零导航 → 卡片目录化） */
await step('玩家面板 顶部锚点条存在且可跳转', async () => {
  const bar = P.doc.getElementById('jumpBar');
  ok(bar, '缺锚点条');
  const btns = [...bar.querySelectorAll('button')];
  ok(btns.length >= 8, '锚点数量 ' + btns.length);
  ok(bar.style.display === 'flex' && bar.style.flexDirection === 'row', '锚点条应为横排 flex');
  return btns.length + ' 个锚点';
});

await step('玩家面板 不含推进回合的按钮（节奏归裁判端）', async () => {
  const gone = ['btnSubmit', 'btnStartRoundP', 'btnSettleNowP'].filter(id => P.doc.getElementById(id));
  ok(gone.length === 0, '小组端仍存在裁判端按钮: ' + gone.join(','));
  ok(!!P.doc.getElementById('seatClockBar'), '小组端应保留计时进度条');
  ok(!!P.doc.getElementById('histBody'), '历史区缺失');
  return '已移除（仅剩进度条与提示）';
});

/* ★ 该断言同样迁到 submittest.mjs（直连提交 + 校验历史/报表），此处不再依赖页面轮询时序 */

/* ─────────── 裁判面板 ─────────── */
let T = null;
if (!ONLY || ONLY === 'teacher') await step('teacher.html 渲染无异常', async () => {
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
