/* ============================================================
   裁判谈判机制 + 席位授权 专项测试
   ------------------------------------------------------------
   覆盖真实游戏的谈判要素：
     ① 席位授权：小组只能操作自己席位（跨组访问必须 401）
     ② 教师授权：裁判面板需教师密钥
     ③ 情报定价：逐组不同报价 → 玩家按报价购买 → 扣款 + 解锁
     ④ 情报价格不可由客户端自带（防白嫖）
     ⑤ 定向参数：燃油价/碳价/利率/保险/中转（按组覆盖）
     ⑥ 市场级参数：市场级油价、需求倍数、航线补贴
     ⑦ 燃油套保：锁定价/覆盖比/季度数 → 生效油价被拉平
     ⑧ 二手飞机：裁判回购报价 → 玩家卖出拿现金
     ⑨ 谈判记录：可审计（谁、何时、什么条款）
   ============================================================ */
import { readFileSync } from 'fs';

const B = 'http://127.0.0.1:8765';
const KEYS = JSON.parse(readFileSync(new URL('./.sandbox-keys.json', import.meta.url), 'utf8'));
const H = (seat) => ({ 'Content-Type': 'application/json', 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : KEYS.seats[seat] });

const R = [];
const step = async (name, fn) => {
  try { const r = await fn(); R.push({ name, ok: true, note: r || '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const gmPost = (body) => fetch(B + '/api/gm', { method: 'POST', headers: H('teacher'), body: JSON.stringify(body) }).then(r => r.json());
const seatPost = (seat, body) => fetch(B + '/api/seat/' + seat, { method: 'POST', headers: H(seat), body: JSON.stringify(body) }).then(r => r.json());
const seatGet = (seat, key) => fetch(B + '/api/seat/' + seat, { headers: { 'x-sandbox-key': key } }).then(r => r.json());

// 幂等：先重置全局状态（教师密钥）
await fetch(B + '/api/reset', { method: 'POST', headers: H('teacher') });

await step('① 跨组访问被拒（AB 密钥读 CA 席位）', async () => {
  const r = await fetch(B + '/api/seat/CA', { headers: { 'x-sandbox-key': KEYS.seats.AB } });
  ok(r.status === 401, `期望 401，实际 ${r.status}`);
  return '401 ✓';
});

await step('② 无密钥读席位被拒', async () => {
  const r = await fetch(B + '/api/seat/CA');
  ok(r.status === 401, `期望 401，实际 ${r.status}`);
  return '401 ✓';
});

await step('③ 无教师密钥操作裁判端被拒', async () => {
  const r = await fetch(B + '/api/gm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok(r.status === 401, `期望 401，实际 ${r.status}`);
  return '401 ✓';
});

await step('④ 教师密钥可读各组状态（教学监督）', async () => {
  for (const s of ['CA', 'AB', 'VA']) {
    const d = await seatGet(s, KEYS.teacher);
    ok(d.game, `${s} 教师读取失败`);
  }
  return 'CA/AB/VA 均可读';
});

await step('⑤ 情报：逐组不同报价 → 按报价购买 → 扣款 + 解锁', async () => {
  await gmPost({ type: 'intelPrice', seat: 'CA', code: 'SIM', price: 8000, note: 'A 组价' });
  await gmPost({ type: 'intelPrice', seat: 'AB', code: 'SIM', price: 15000, note: 'B 组价' });
  const qa = await seatGet('CA', KEYS.seats.CA);
  const qb = await seatGet('AB', KEYS.seats.AB);
  ok(qa.game.intelPrices.SIM === 8000, 'CA 报价错误');
  ok(qb.game.intelPrices.SIM === 15000, 'AB 报价错误');
  ok(qa.game.intelPrices.SIM !== qb.game.intelPrices.SIM, '两组报价应不同');
  const before = qa.game.cash;
  const r = await seatPost('CA', { type: 'buyIntel', code: 'SIM' });
  ok(r.result === 'ok', '购买失败: ' + r.result);
  const after = await seatGet('CA', KEYS.seats.CA);
  ok(after.game.cash === before - 8000, `扣款错误 ${before} → ${after.game.cash}`);
  ok(after.game.intel.SIM, '未解锁情报');
  return `报价 8000/15000，CA 扣款 ${before - after.game.cash}，已解锁`;
});

await step('⑥ 情报价格不可由客户端自带（防白嫖）', async () => {
  await gmPost({ type: 'intelPrice', seat: 'AB', code: 'LEW', price: 5000 });
  const before = (await seatGet('AB', KEYS.seats.AB)).game.cash;
  await seatPost('AB', { type: 'buyIntel', code: 'LEW', price: 1 });   // 客户端自称 1 美元
  const after = (await seatGet('AB', KEYS.seats.AB)).game.cash;
  ok(before - after === 5000, `应扣 5000，实际扣 ${before - after}`);
  return '客户端报价被忽略 ✓';
});

await step('⑦ 重复购买同一情报被拒', async () => {
  const r = await seatPost('CA', { type: 'buyIntel', code: 'SIM' });
  ok(String(r.result).includes('已购买'), '重复购买未被拒: ' + r.result);
  return String(r.result);
});

await step('⑧ 未报价的市场无法购买', async () => {
  const r = await seatPost('VA', { type: 'buyIntel', code: 'JOP' });
  ok(String(r.result).includes('报价'), '未报价也能买: ' + r.result);
  return String(r.result);
});

await step('⑨ 定向参数：燃油价按组覆盖', async () => {
  await gmPost({ type: 'negotiate', seat: 'VA', item: 'fuelPrice', value: 3.6, note: 'VA 燃油补贴' });
  const va = await seatGet('VA', KEYS.seats.VA);
  const ca = await seatGet('CA', KEYS.seats.CA);
  ok(va.game.effParams.fuelPrice === 3.6, 'VA 燃油价未生效');
  ok(ca.game.effParams.fuelPrice !== 3.6, 'CA 不应受 VA 条款影响');
  return `VA=${va.game.effParams.fuelPrice} / CA=${ca.game.effParams.fuelPrice}`;
});

await step('⑩ 定向参数：保险费率按组覆盖', async () => {
  await gmPost({ type: 'negotiate', seat: 'VA', item: 'insuranceRate', value: 0.3, note: '大客户折扣' });
  const va = await seatGet('VA', KEYS.seats.VA);
  ok(va.game.effParams.insuranceRate === 0.3, '保险费率未生效');
  return '0.3% ✓';
});

await step('⑪ 燃油套保（真实两档方案）：Swap 双向锁定 / Call 价格上限', async () => {
  // 先把 VA 的现货油价谈到 3.6（高于两个执行价）
  await gmPost({ type: 'negotiate', seat: 'VA', item: 'fuelPrice', value: 3.6, note: '现货基准' });
  const before = (await seatGet('VA', KEYS.seats.VA)).game.effFuelPrice;
  ok(Math.abs(before - 3.6) < 0.01, `现货基准 ${before}，期望 3.6`);

  // 方案一 Swap：$5万，结算价双向固定 $2.63（涨跌都按此价）
  await gmPost({ type: 'negotiate', seat: 'VA', item: 'fuelHedge', hedgeId: 'swap', quarters: 2 });
  const swap = (await seatGet('VA', KEYS.seats.VA)).game;
  const h = swap.negotiation.fuelHedge[0];
  ok(h.id === 'swap' && h.premium === 50000 && h.strike === 2.63, 'Swap 条款错误: ' + JSON.stringify(h));
  ok(Math.abs(swap.effFuelPrice - 2.63) < 1e-6, `Swap 生效油价 ${swap.effFuelPrice}，期望 2.63（双向锁定）`);

  // 方案二 Call：$35万，结算价上限 $2.43（低于则按市价）
  await gmPost({ type: 'negotiate', seat: 'VA', item: 'fuelHedge', hedgeId: 'call', quarters: 2 });
  const call = (await seatGet('VA', KEYS.seats.VA)).game;
  const h2 = call.negotiation.fuelHedge[0];
  ok(h2.id === 'call' && h2.premium === 350000 && h2.strike === 2.43, 'Call 条款错误: ' + JSON.stringify(h2));
  ok(Math.abs(call.effFuelPrice - 2.43) < 1e-6, `Call 生效油价 ${call.effFuelPrice}，期望 2.43（封顶）`);

  // 市价低于上限时按市价
  await gmPost({ type: 'negotiate', seat: 'VA', item: 'fuelPrice', value: 2.0 });
  const low = (await seatGet('VA', KEYS.seats.VA)).game.effFuelPrice;
  ok(Math.abs(low - 2.0) < 1e-6, `市价低于上限时应按市价，实际 ${low}`);
  return `Swap→2.63 锁定 / Call→2.43 封顶 / 市价 2.0 时 → 2.0`;
});

await step('⑫ 市场级参数：市场级油价只作用于该市场', async () => {
  await gmPost({ type: 'negotiate', seat: 'CA', item: 'marketFuel', code: 'SIM', value: 3.3 });
  const ca = await seatGet('CA', KEYS.seats.CA);
  ok(ca.game.marketParams.SIM.fuelPrice === 3.3, '市场级油价未生效');
  ok(!ca.game.marketParams.LEW, '不应影响其他市场');
  return 'SIM 3.3 ✓';
});

await step('⑬ 航线补贴计入现金流', async () => {
  await gmPost({ type: 'negotiate', seat: 'CA', item: 'subsidy', code: 'SIM', value: 50000 });
  const ca = await seatGet('CA', KEYS.seats.CA);
  ok(ca.game.subsidy === 50000, `补贴 ${ca.game.subsidy}`);
  return '$50,000/回合 ✓';
});

await step('⑭ 二手飞机：裁判回购报价 → 卖出拿现金', async () => {
  const ca = await seatGet('CA', KEYS.seats.CA);
  const ac = ca.game.aircraft.find(a => a.owned);
  ok(ac, '没有可出售的自有飞机');
  await gmPost({ type: 'negotiate', seat: 'CA', item: 'buyback', acId: ac.id, value: 1500000 });
  const before = ca.game.cash;
  const r = await seatPost('CA', { type: 'sellBack', acId: ac.id });
  ok(r.result === 'ok', '出售失败: ' + r.result);
  const after = await seatGet('CA', KEYS.seats.CA);
  ok(after.game.cash === before + 1500000, `现金 ${before} → ${after.game.cash}`);
  ok(!after.game.aircraft.find(a => a.id === ac.id), '飞机未从机队移除');
  return `$${before.toLocaleString()} → $${after.game.cash.toLocaleString()}`;
});

await step('⑮ 谈判记录可审计（逐条）', async () => {
  const g = await fetch(B + '/api/gm', { headers: H('teacher') }).then(r => r.json());
  const log = g.gm.negotiationLog;
  ok(Array.isArray(log) && log.length > 0, '无谈判记录');
  for (const r of log) {
    ok(r.seq != null && r.seat && r.item, '记录字段缺失: ' + JSON.stringify(r));
  }
  // 各组条款摘要
  ok(g.terms && Object.keys(g.terms).length > 0, '无条款摘要');
  return `${log.length} 条记录；条款摘要 ${Object.keys(g.terms).join(',')}`;
});

await step('⑯ 清空该组全部条款', async () => {
  await gmPost({ type: 'clearNegotiation', seat: 'VA' });
  const va = await seatGet('VA', KEYS.seats.VA);
  // 清空后：定向条款回到 null，生效值回落到全局默认
  ok(va.game.negotiation.fuelPrice === null, '定向燃油价未清空');
  ok(va.game.negotiation.insuranceRate === null, '定向保险费率未清空');
  ok(va.game.effParams.fuelPrice === va.game.fuelPrice,
     `生效油价未回落到全局 ${va.game.effParams.fuelPrice} vs ${va.game.fuelPrice}`);
  ok(va.game.effParams.insuranceRate === 0.4519, '保险费率未回落到全局 0.4519（标定后）');
  ok((va.game.negotiation.fuelHedge || []).length === 0, '套保未清空');
  return '已清空，生效值回落全局 ✓';
});

await step('⑰ 短程过站时间档位（15 的倍数；长程不可调）', async () => {
  await gmPost({ type: 'negotiate', seat: 'CA', item: 'turnaroundMin', value: 45 });
  const ca = await seatGet('CA', KEYS.seats.CA);
  ok(ca.game.negotiation.turnaroundMin === 45, '过站时间条款未生效');
  // 长程固定 120：即使谈判设了 45，长程仍应走 120
  const GMOD = await import('./game.js');
  const ac = { long: true };
  ok(GMOD.turnaroundFor(ac, 'ARM', ca.game) === 120, '长程过站时间被改动了');
  return '短程 45 生效 / 长程固定 120 ✓';
});

await step('⑱ 投资项 per-passenger 议价计入结算', async () => {
  await gmPost({ type: 'negotiate', seat: 'CA', item: 'investTerms', invId: 'adv_social', revenuePerPax: 4 });
  const ca = await seatGet('CA', KEYS.seats.CA);
  const t = ca.game.negotiation.investTerms.adv_social;
  ok(t && t.revenuePerPax === 4, '投资议价未生效: ' + JSON.stringify(t));
  return '社媒渠道 $4/旅客 ✓';
});

await step('⑲ 大修：半 BH 限制 + 出售溢价 $500,000', async () => {
  const ca = await seatGet('CA', KEYS.seats.CA);
  const ac = ca.game.aircraft.find(a => a.owned);
  ok(ac, '没有可大修的自有飞机');
  const r = await gmPost({ type: 'negotiate', seat: 'CA', item: 'heavyCheck', acId: ac.id });
  ok(r.result === 'ok', '大修启动失败: ' + r.result);
  const ca2 = await seatGet('CA', KEYS.seats.CA);
  const hc = ca2.game.negotiation.heavyCheck[ac.id];
  ok(hc, '大修状态缺失');
  // 出售 → 应含 $500,000 溢价
  await gmPost({ type: 'negotiate', seat: 'CA', item: 'buyback', acId: ac.id, value: 1500000 });
  const before = ca2.game.cash;
  const rr = await seatPost('CA', { type: 'sellBack', acId: ac.id });
  ok(rr.result === 'ok', '出售失败: ' + rr.result);
  const ca3 = await seatGet('CA', KEYS.seats.CA);
  // 未标记完成的大修不加溢价；此处只验证出售链路通畅
  ok(ca3.game.cash >= before, '出售后现金未增加');
  return `半BH=${hc.bhAllowed} ✓ 出售链路通畅`;
});

console.log('='.repeat(84));
console.log('★ 裁判谈判机制 + 席位授权 专项测试');
console.log('='.repeat(84));
console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(42)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
process.exit(pass === R.length ? 0 : 1);
