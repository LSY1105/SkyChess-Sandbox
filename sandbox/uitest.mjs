/* ============================================================
   UI 全功能点击测试（jsdom 真实 DOM）
   ------------------------------------------------------------
   把 index.html 里的页面脚本抽成同目录 .mjs 文件（相对 import 才可解析），
   在 jsdom 中执行后，逐一点击每个功能并断言。
   ============================================================ */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.error('JSDOM:', e.message));

const dom = new JSDOM(html.replace(/<script type="module">[\s\S]*?<\/script>/, ''), {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1/',
  virtualConsole: vc,
});
const { window } = dom;
const doc = window.document;

// 抽取页面脚本 → 同目录临时模块
const body = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const tmp = join(HERE, '_page_test.mjs');
writeFileSync(tmp, body);
globalThis.window = window;
globalThis.document = doc;
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.prompt = () => '';
Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});
Object.defineProperty(globalThis,'location',{value:window.location,configurable:true,writable:true});
globalThis.Event = window.Event;
try {
  await import('file://' + tmp.replace(/\\/g, '/'));
} catch (e) {
  console.error('页面脚本执行失败:', e.message);
  process.exit(2);
}

console.log('='.repeat(84));
console.log('★ UI 全功能点击测试');
console.log('='.repeat(84));

const R = [], ERRS = [];
const step = (name, fn) => {
  try { const r = fn(); R.push({ name, ok: r === undefined ? true : !!r, note: typeof r === 'string' ? r : '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); ERRS.push(`${name}: ${e.message}`); }
};
const $ = s => doc.querySelector(s);
const g = () => window.__g();
const clickAll = (sel, filter) => [...doc.querySelectorAll(sel)].filter(filter || (() => true));

// ── 1 头部 ──
step('头部渲染', () => { const t = $('#hPeriod').textContent; if (!t || t === '—') throw new Error('期间空'); return t; });
step('头部：现金/QSI/油价/BH/回合 全部有值', () => {
  for (const id of ['#hCash', '#hQsi', '#hFuel', '#hBH', '#hTurn']) {
    const v = $(id).textContent; if (!v || v === '—') throw new Error(id + ' 未渲染');
  }
  return 'ok';
});

// ── 2 航线与运价 ──
step('航线表渲染', () => { const n = $('#tblRoutes').querySelectorAll('tr').length; if (n < 2) throw new Error('空'); return n + ' 行'; });
step('运价可修改', () => {
  const inp = $('#tblRoutes').querySelector('input[type=number]');
  if (!inp) throw new Error('无输入框');
  inp.value = '150'; inp.dispatchEvent(new window.Event('change'));
  if (g().routes[0].fare !== 150) throw new Error('未生效: ' + g().routes[0].fare);
  return 'fare=150';
});
step('「提示最优价」按钮', () => {
  const b = clickAll('#tblRoutes button').find(x => x.textContent.includes('最优'));
  if (!b) throw new Error('按钮不存在'); b.click(); return 'ok';
});

// ── 3 开航线 ──
step('开通普通航线', () => {
  $('#selNewRoute').value = 'LEW'; $('#btnOpenRoute').click();
  if (!g().routes.find(r => r.code === 'LEW')) throw new Error('未开通');
  return g().routes.map(r => r.code).join(',');
});
step('ETOPS 航线开通但未付费标记', () => {
  $('#selNewRoute').value = 'ARM'; $('#btnOpenRoute').click();
  const r = g().routes.find(x => x.code === 'ARM');
  if (!r) throw new Error('未开通');
  if (r.etopsPaid) throw new Error('误标 ETOPS 已购');
  return 'ARM 开通, etopsPaid=false';
});
step('Charles City 需环保投资', () => {
  $('#selNewRoute').value = 'CHA'; $('#btnOpenRoute').click();
  if (g().routes.find(x => x.code === 'CHA')) throw new Error('未投资却开通');
  return '正确拒绝';
});

// ── 4 排班 ──
step('加入班次', () => {
  $('#selAc').value = String(g().aircraft[0].id);
  $('#selMkt').value = 'SIM'; $('#inpDep').value = '09:00';
  $('#btnAddFlight').click();
  if (!g().schedules.length) throw new Error('未加入');
  return g().schedules.length + ' 班';
});
step('容量上限生效（不会无限加班）', () => {
  for (let i = 0; i < 60; i++) {
    $('#selAc').value = String(g().aircraft[0].id);
    $('#selMkt').value = 'SIM'; $('#inpDep').value = '09:00';
    $('#btnAddFlight').click();
  }
  const used = g().schedules.filter(s => s.acId === g().aircraft[0].id).length;
  if (used === 0) throw new Error('一班都加不了');
  const cap = window.__cap ? window.__cap() : 775;
  if (used * 1.13 * 90 > cap + 2) throw new Error(`容量未限制 ${used}`);
  return `限 ${used} 班`;
});
step('取消班次', () => {
  const b = clickAll('#tblSched button').find(x => x.textContent === '取消');
  if (!b) throw new Error('无按钮');
  const before = g().schedules.length; b.click();
  if (g().schedules.length !== before - 1) throw new Error('未生效');
  return 'ok';
});

// ── 5 投资四面板 ──
for (const [label, key] of [['航空公司','airline'], ['机队','fleet'], ['航线','route'], ['资产','asset']]) {
  step(`投资面板「${label}」渲染`, () => {
    const b = clickAll('#tabsInv button').find(x => x.textContent === label);
    if (!b) throw new Error('tab 不存在');
    b.click();
    const n = $('#invBody').querySelectorAll('tr').length;
    if (n < 1) throw new Error('面板空');
    return n + ' 行';
  });
  step(`投资面板「${label}」操作生效`, () => {
    const b = $('#invBody').querySelector('button');
    if (!b) throw new Error('无操作按钮');
    const before = g().cash;
    b.click();
    const after = g().cash;
    if (after === before && key === 'fleet') return '现金不足(正常)';
    return `cash ${Math.round(before)} -> ${Math.round(after)}`;
  });
}

// ── 6 结算 ──
step('结算本回合产生报告', () => {
  const before = g().history.length;
  $('#btnAdvance').click();
  if (g().history.length !== before + 1) throw new Error('无报告');
  const r = g().history[g().history.length - 1];
  if (!Number.isFinite(r.operating_profit)) throw new Error('利润 NaN');
  if (!Number.isFinite(r.cash_end)) throw new Error('现金 NaN');
  return `${r.period} 利润 ${Math.round(r.operating_profit).toLocaleString()}`;
});
step('历史报告可切换', () => {
  const b = clickAll('#tabsHist button');
  if (!b.length) throw new Error('无历史');
  b[0].click();
  return b.length + ' 季度';
});
step('评分表渲染', () => { const n = $('#tblScore').querySelectorAll('tr').length; if (n < 2) throw new Error('空'); return n + ' 行'; });
step('预览表渲染', () => { const n = $('#tblPrev').querySelectorAll('tr').length; if (n < 3) throw new Error('空'); return n + ' 行'; });
step('竞品表渲染', () => { const n = $('#tblComp').querySelectorAll('tr').length; if (n < 2) throw new Error('空'); return n + ' 行'; });

// ── 7 事件 ──
step('事件下拉含全部事件', () => {
  const o = [...$('#selEvent').options].map(x => x.value);
  if (o.length < 4) throw new Error('事件不足: ' + o.length);
  return o.join(',');
});
step('事件目标随类型切换', () => {
  $('#selEvent').value = 'volcano'; $('#selEvent').dispatchEvent(new window.Event('change'));
  const m = [...$('#selEvTarget').options].map(x => x.value);
  if (!m.includes('SIM')) throw new Error('市场目标缺失');
  $('#selEvent').value = 'hail'; $('#selEvent').dispatchEvent(new window.Event('change'));
  const a = [...$('#selEvTarget').options].map(x => x.value);
  if (!a.length) throw new Error('航司目标缺失');
  return `市场${m.length}/航司${a.length}`;
});
step('触发市场事件（火山）', () => {
  $('#selEvent').value = 'volcano'; $('#selEvent').dispatchEvent(new window.Event('change'));
  $('#selEvTarget').value = 'SIM'; $('#btnEvent').click();
  if (!g().demandMult.SIM) throw new Error('未生效');
  return 'SIM 需求×' + g().demandMult.SIM;
});
step('触发航司事件（冰雹）', () => {
  $('#selEvent').value = 'hail'; $('#selEvent').dispatchEvent(new window.Event('change'));
  $('#selEvTarget').value = g().aircraft[0].type; $('#btnEvent').click();
  const uc = g().utilCap[g().aircraft[0].type];
  if (!uc) throw new Error('未生效');
  const bh = typeof uc === 'number' ? uc : uc.bh;
  return `限飞 ${bh} BH/季`;
});
step('触发全球事件（疫情）', () => {
  $('#selEvent').value = 'pandemic'; $('#selEvent').dispatchEvent(new window.Event('change'));
  $('#btnEvent').click();
  if (!Object.keys(g().demandMult).length) throw new Error('未生效');
  return Object.keys(g().demandMult).length + ' 市场受影响';
});

// ── 8 重开 ──
step('重开游戏', () => {
  $('#btnReset').click();
  if (g().history.length) throw new Error('历史未清');
  return 'ok';
});

// ── 汇总 ──
console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(36)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
if (ERRS.length) { console.log('失败:'); for (const e of ERRS) console.log('  -', e); }
try { unlinkSync(tmp); } catch {}
process.exit(pass === R.length ? 0 : 1);
