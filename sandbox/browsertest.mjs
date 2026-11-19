/* ============================================================
   真实浏览器护栏（Chrome DevTools Protocol · 零依赖）
   ------------------------------------------------------------
   为什么需要它：**jsdom 没有排版引擎**，抓不到「人眼看得见、机器看不见」的一类缺陷
     ① 选项文字被截断（<select> 宽度不够 → 裁判选错投资项）——11-18 踩过
     ② 状态回显不可见（字号太小 / 对比度不足 / 埋在离动作很远的地方）——11-18 踩过
     ③ 手填输入被回显冲掉 ——11-18 踩过
   这三类在 11-18 ~ 11-19 连续三轮人工复跑里各出现过一次，全靠人眼发现。
   本脚本用已装的 Chrome + Node 内置 WebSocket 驱动，断言**可见性与可读性**；
   逻辑正确性仍由 jsdom 那套（runtests.mjs）负责 —— 两者互补，不重叠。

   ★ 只允许在**隔离实例**上跑：它会 POST /api/reset —— 对局状态不持久化，
     指向 8765 正式对局会把正在上课的局清空。故：必须显式给 SANDBOX_BASE
     （`node runtests.mjs` 会自动注入一个独立实例的地址）。

   用法：
     node runtests.mjs                     # 正常入口（自动起隔离实例并注入 SANDBOX_BASE）
     SANDBOX_BASE=http://127.0.0.1:8799 node browsertest.mjs   # 自建测试实例
   ============================================================ */
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, isAbsolute } from 'path';
import net from 'node:net';

const BASE = process.env.SANDBOX_BASE || '';
if (!BASE) {
  console.log('SKIP: 真实浏览器护栏只在**隔离实例**上跑（本脚本会 /api/reset）。');
  console.log('      请用 `node runtests.mjs`（自动注入独立实例），或自建实例后设 SANDBOX_BASE。');
  process.exit(2);
}
/* 密钥文件：相对路径按模块解析，绝对路径直接用（new URL('C:\\...') 会变成 c: 协议 → 读不到） */
const KEYFILE = process.env.SANDBOX_KEY_FILE
  ? (isAbsolute(process.env.SANDBOX_KEY_FILE) ? process.env.SANDBOX_KEY_FILE
     : new URL(process.env.SANDBOX_KEY_FILE, import.meta.url))
  : new URL('./.sandbox-keys.json', import.meta.url);
let KEYS;
try { KEYS = JSON.parse(readFileSync(KEYFILE, 'utf8')); }
catch { console.log('SKIP: 读不到密钥文件 ' + KEYFILE + '（跑 runtests.mjs 会自动注入）'); process.exit(2); }

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => p && existsSync(p));
if (!CHROME) {
  console.log('SKIP: 未找到 Chrome / Edge（可用 CHROME_PATH 指定）');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

async function freePort() {
  return new Promise(res => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

/** 极简 CDP 客户端：一条 WebSocket，按 id 配对回包 */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.errors = []; }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连接失败')); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) {
        const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        c.errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        c.errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      } else if (m.method === 'Network.responseReceived') {
        const rs = m.params.response || {};
        if (rs.status >= 400) c.errors.push(`HTTP ${rs.status} ${rs.url}`);
      } else if (m.method === 'Page.javascriptDialogOpening') {
        /* S7：结果不能只靠 alert() 呈现 → 命中即记为违规，同时放行避免页面卡死 */
        c.errors.push('alert(): ' + (m.params.message || '') + '（违反 CODING_STANDARDS S7）');
        c.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      setTimeout(() => { if (this.waiting.delete(id)) rej(new Error('CDP 超时: ' + method)); }, 30000);
    });
  }
  /** 在页面里调用一个函数（awaitPromise + returnByValue） */
  async call(fn, ...args) {
    const expr = `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面求值异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  /** 在页面里求值一段**源码表达式**（与 call(函数) 分开，避免两种入参混淆） */
  async callSrc(src) {
    const r = await this.send('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面求值异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  /** 反复调用直到返回真值（避免固定 sleep 竞态） */
  async until(fn, timeoutMs = 8000, every = 200) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = await this.call(fn); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) return null;
      await sleep(every);
    }
  }
}

async function withPage(url, fn) {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'browsertest-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
    '--window-size=1366,768', 'about:blank',   // 笔记本/投影仪尺寸：更贴近真实课堂
  ], { stdio: 'ignore' });
  try {
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find(t => t.type === 'page');
        if (page) wsUrl = page.webSocketDebuggerUrl;
      } catch { /* 还没起来 */ }
    }
    if (!wsUrl) throw new Error('Chrome CDP 未就绪');
    const cdp = await CDP.attach(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.navigate', { url });
    await cdp.until(() => document.readyState === 'complete');
    return await fn(cdp);
  } finally {
    proc.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }
  }
}

/* 页面里取「可见文本 + 高度」（三处断言共用同一形状） */
const visibleOf = id => `(() => { const el = document.getElementById(${JSON.stringify(id)});
  return { text: el ? el.textContent.replace(/\\s+/g, ' ').trim() : '', h: el ? el.getBoundingClientRect().height : 0 }; })()`;

/* ── 准备一组确定的会话状态（走真实 API，模拟裁判已谈妥一项） ── */
const api = (p, body, key) => fetch(BASE + p, {
  method: body ? 'POST' : 'GET',
  headers: { 'x-sandbox-key': key, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then(r => r.json());

console.log('真实浏览器护栏（Chrome CDP）· ' + BASE);
await api('/api/reset', {}, KEYS.teacher);
await api('/api/gm', { type: 'negotiate', seat: 'CA', item: 'investTerms', invId: 'cab_lowcost', open: true, costPerPax: 1.5, revenuePerPax: 2 }, KEYS.teacher);
await api('/api/seat/CA', { type: 'invest', id: 'cab_lowcost' }, KEYS.seats.CA);

/* ─────────── 裁判端 ─────────── */
await withPage(`${BASE}/teacher.html?key=${KEYS.teacher}`, async cdp => {
  ok(!!(await cdp.until(() => { const e = document.getElementById('invState'); return !!e && e.textContent.includes('当前'); })),
    '裁判端状态回显已加载');
  console.log('\n[裁判端]');

  const st = await cdp.callSrc(visibleOf('invState'));
  ok(!!st.text && st.h > 8, `状态回显有内容且有高度（h=${Math.round(st.h)}）: ${st.text.slice(0, 60)}`);

  /* ★ 状态行**人眼看得见**的三条可算判据（11-18 ② 的真凶：11px 灰字 / 埋在离动作很远的地方）
     ⚠ 位置判据必须**同卡片内**比对：整页首屏判据会假红（状态行本来就在长页面里） */
  const vis = await cdp.call(() => {
    const el = document.getElementById('invState');
    const card = el.closest('.card');
    const btn = document.getElementById('btnInvToggle');
    const msg = document.getElementById('invTermsMsg');
    const cs = getComputedStyle(el);
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number);
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const l1 = lum(cs.color), l2 = lum(getComputedStyle(card).backgroundColor);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const r1 = el.getBoundingClientRect(), r2 = btn.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const m1 = msg.getBoundingClientRect();
    return { fontSize: parseFloat(cs.fontSize), ratio: Math.round(ratio * 100) / 100,
             topGap: Math.round(r1.top - cr.top),
             msgDist: Math.round(Math.hypot(m1.left - r2.left, m1.top - r2.top)),
             msgSameRow: Math.abs(m1.top - r2.top) < 40 };
  });
  ok(vis.fontSize >= 13, `状态回显字号 ≥13px（实得 ${vis.fontSize}px）`);
  ok(vis.ratio >= 4.5, `状态回显文字与卡片底对比度 ≥4.5:1（实得 ${vis.ratio}:1）`);
  ok(vis.topGap <= 150, `状态回显在卡片顶部（距卡片顶 ${vis.topGap}px ≤150px）`);
  ok(vis.msgSameRow && vis.msgDist <= 200, `操作反馈与触发按钮**同排**且相距 ≤200px（实得 ${vis.msgDist}px，同排=${vis.msgSameRow}）`);

  /* ★ 最长选项文本宽度 vs 控件宽度
     ⚠ 不能用 select.scrollWidth/clientWidth：Chrome 关闭态是**裁剪**不是溢出 → 永远相等 → 断言恒真 */
  const clip = await cdp.call(() => {
    const s = document.getElementById('invItem');
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = getComputedStyle(s).font || '13px sans-serif';
    let widest = 0;
    for (const o of s.options) widest = Math.max(widest, ctx.measureText(o.text).width);
    return { widest: Math.round(widest), cw: s.clientWidth, n: s.options.length,
             groups: s.querySelectorAll('optgroup').length };
  });
  ok(clip.widest <= clip.cw, `最长选项文本不超控件宽度（${clip.widest}px ≤ ${clip.cw}px，共 ${clip.n} 项）`);
  ok(clip.groups >= 2, `投资项下拉按类别分组（${clip.groups} 组）`);

  /* ★ 切到另一项 → 按钮文案随状态翻转 → 点一下 → 回显必须变成「已关闭（裁判指定）」 */
  await cdp.call(() => {
    const s = document.getElementById('invItem'); s.value = 'adv_web';
    s.dispatchEvent(new Event('change')); return true;
  });
  ok(!!(await cdp.until(() => document.getElementById('invState').textContent.includes('广告'))),
    '已切到「广告（网站与代理）」');
  const beforeTxt = await cdp.call(() => ({
    state: document.getElementById('invState').textContent,
    btn: document.getElementById('btnInvToggle').textContent.trim(),
  }));
  ok(/开放（默认/.test(beforeTxt.state), `未议定项显示「开放（默认 · 未议定）」: ${beforeTxt.state.slice(0, 50)}`);
  ok(beforeTxt.btn === '关闭该项', `默认开放项的按钮文案是「关闭该项」（点它=关掉）: ${beforeTxt.btn}`);
  await cdp.call(() => { document.getElementById('btnInvToggle').click(); return true; });
  const after = await cdp.until(() => {
    const t = document.getElementById('invState').textContent;
    return t.includes('已关闭（裁判指定）') ? t : null;
  });
  ok(!!after, `点开关后回显变成「已关闭（裁判指定）」（开关真的会关）: ${(after || '(无)').slice(0, 60)}`);
  const afterBtn = await cdp.call(() => document.getElementById('btnInvToggle').textContent.trim());
  ok(afterBtn === '开放该项', `按钮文案随状态翻转成「开放该项」: ${afterBtn}`);
  const fb = await cdp.call(() => ({
    msg: document.getElementById('invTermsMsg').textContent.trim(),
    fs: parseFloat(getComputedStyle(document.getElementById('invTermsMsg')).fontSize),
  }));
  ok(/✔ 已(关闭|开放)/.test(fb.msg), `按钮旁就有就地反馈（不必去别处找）: 「${fb.msg}」`);
  ok(fb.fs >= 11, `反馈字号 ≥11px（实得 ${fb.fs}px）`);

  /* ★ 已议定项清单：可见 + 含已议定项 */
  const list = await cdp.callSrc(visibleOf('invList'));
  ok(list.h > 8 && list.text.includes('客舱升级'), `已议定项清单可见（h=${Math.round(list.h)}）: ${list.text.slice(0, 56)}`);

  /* ★ 清单行**可点载入**（㉙① 的验收标准，此前无任何断言） */
  const loaded = await cdp.call(async () => {
    const rows = [...document.getElementById('invList').querySelectorAll('div')].filter(x => x.onclick);
    if (!rows.length) return { ok: false, why: '清单无可点行' };
    rows[0].click();
    await new Promise(x => setTimeout(x, 400));
    return { ok: true, pick: document.getElementById('invItem').value };
  });
  ok(loaded.ok && loaded.pick === 'cab_lowcost', `点清单行即载入该投资项到表单: ${loaded.pick || loaded.why}`);

  /* ★ S3 真正的检验：**手填与服务端不同的值**，再触发**另一个动作**的回显（发放资金）
     —— 用「议定条款」检验是假的：它刚好把同一个值存回服务端 → 回填写回同一个数 → 恒真 */
  await cdp.call(() => {
    const c = document.getElementById('invCost'), r = document.getElementById('invRev');
    c.value = '9.99'; r.value = '7.77';
    document.getElementById('grantAmt').value = '1000';
    document.getElementById('btnGrant').click(); return true;
  });
  ok(!!(await cdp.until(() => (document.getElementById('invTermsMsg').textContent || '').includes('发放资金'))),
    '发放资金后有即时反馈');
  const keep = await cdp.call(() => ({
    c: document.getElementById('invCost').value,
    r: document.getElementById('invRev').value,
    msg: document.getElementById('invTermsMsg').textContent,
  }));
  ok(keep.c === '9.99' && keep.r === '7.77', `手填条款未被回显冲掉（${keep.c} / ${keep.r}）· 反馈「${keep.msg}」`);

  /* ★ 议定条款：写入服务端 + 回显生效条款 */
  await cdp.call(() => {
    document.getElementById('invCost').value = '1.5';
    document.getElementById('invRev').value = '2';
    document.getElementById('btnInvTerms').click(); return true;
  });
  ok(!!(await cdp.until(() => (document.getElementById('invTermsMsg').textContent || '').includes('议定'))),
    '议定条款后有即时反馈');
  const terms = await cdp.until(() => {
    const t = document.getElementById('invState').textContent;
    return t.includes('成本 $1.5') ? t : null;
  });
  ok(!!terms, `议定后状态行显示生效条款: ${(terms || '(无)').slice(0, 70)}`);

  ok(cdp.errors.length === 0, '裁判端无 JS 报错 / 网络错误 / alert()' + (cdp.errors.length ? ': ' + cdp.errors.slice(0, 2).join(' | ') : ''));
});

/* ─────────── 小组端 ─────────── */
await withPage(`${BASE}/player.html?seat=CA&key=${KEYS.seats.CA}`, async cdp => {
  ok(!!(await cdp.until(() => { const e = document.getElementById('invSummary'); return !!e && e.textContent.includes('已投放'); })),
    '小组端已投放小结已加载');
  console.log('\n[小组端]');

  const sum = await cdp.callSrc(visibleOf('invSummary'));
  ok(sum.h > 8 && sum.text.includes('客舱升级'), `投资卡顶部「已投放小结」可见且含投资名: ${sum.text.slice(0, 70)}`);

  /* ★ 徽标必须**分态**（S4），不是二值 —— 断言具体状态词，而不是"有没有徽标" */
  const inv = await cdp.call(() => {
    const t = (document.getElementById('invBody') || {}).textContent || '';
    return {
      hasInvested: t.includes('已投放'),
      defaultOpen: t.includes('按目录默认值'),   // 从未谈过 → 目录默认
      negotiated: t.includes('已议定'),          // 议过条款 → 已议定
      judgeOpen: t.includes('裁判指定'),        // 裁判显式开放
      notOpen: t.includes('未开放'),
    };
  });
  ok(inv.hasInvested, '投资表显示「已投放」');
  ok(inv.defaultOpen, '徽标区分「按目录默认值」（默认开放）');
  ok(inv.negotiated, '徽标区分「已议定」（议过条款）');
  ok(inv.judgeOpen || inv.notOpen, '徽标能区分「裁判指定」/「未开放」');

  /* ★ 「📄 投资报表」直达：点了之后报表必须停在 Investments 页签且有数据 */
  await cdp.call(() => { document.getElementById('btnInvReport').click(); return true; });
  const rep = await cdp.until(() => {
    const b = document.getElementById('repBody'); if (!b) return null;
    const tabs = [...b.querySelectorAll('.tabs button')];
    const on = tabs.find(x => /Investments/.test(x.textContent) && x.className.includes('on'));
    return (on && (b.textContent || '').includes('客舱升级')) ? b.textContent.replace(/\s+/g, ' ').slice(0, 60) : null;
  });
  ok(!!rep, '点「投资报表」后报表停在 Investments 页签且含投资数据' + (rep ? ': ' + rep : ''));

  /* ★ 页面无横向溢出（宽表被裁 = 学员看不到列） */
  const ovf = await cdp.call(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(ovf.sw <= ovf.cw + 4, `页面无横向溢出（scrollWidth ${ovf.sw} ≤ clientWidth ${ovf.cw}）`);

  /* ★ 服务端失败文案必须中文（学员看到的是原文） */
  const rej = await cdp.call(async () => {
    const q = new URLSearchParams(location.search);
    const r = await fetch('/api/seat/' + q.get('seat'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sandbox-key': q.get('key') },
      body: JSON.stringify({ type: 'invest', id: 'cab_lowcost' }),
    }).then(x => x.json());
    const why = ((r.game && r.game.rejects) || []).filter(x => x.type === 'invest')[0];
    return { res: String(r.result), why: why ? String(why.why) : '' };
  });
  ok(/[一-龥]/.test(rej.res), `重复投资的服务端错误码是中文: ${rej.res}`);
  ok(!/already invested|no cash/.test(rej.res + rej.why), '错误码不再是英文原文');

  ok(cdp.errors.length === 0, '小组端无 JS 报错 / 网络错误 / alert()' + (cdp.errors.length ? ': ' + cdp.errors.slice(0, 2).join(' | ') : ''));
});

console.log('\n' + '='.repeat(60));
console.log(`真实浏览器护栏：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
process.exit(fail ? 1 : 0);
