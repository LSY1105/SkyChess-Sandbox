/* ============================================================
   提案治理 + 事件豁免 + 替代机顶班 专项测试
   ------------------------------------------------------------
   核心治理原则（用户明确要求）：
     小组**只能发起**提案；凡涉及别组数据、市场规则或罚则豁免的事项，
     **必须由裁判在裁判端确认或修改后**才生效 —— 小组不得自行修改。
   ============================================================ */
import { readFileSync } from 'fs';

const B = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';
const KEYS = JSON.parse(readFileSync(new URL(process.env.SANDBOX_KEY_FILE || './.sandbox-keys.json', import.meta.url), 'utf8'));
const H = (seat) => ({ 'Content-Type': 'application/json', 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : KEYS.seats[seat] });
const gmPost = (b) => fetch(B + '/api/gm', { method: 'POST', headers: H('teacher'), body: JSON.stringify(b) }).then(r => r.json());
const seatPost = (s, b) => fetch(B + '/api/seat/' + s, { method: 'POST', headers: H(s), body: JSON.stringify(b) }).then(r => r.json());
const seatGet = (s) => fetch(B + '/api/seat/' + s, { headers: { 'x-sandbox-key': KEYS.seats[s] } }).then(r => r.json());

const R = [];
const step = async (name, fn) => {
  try { const r = await fn(); R.push({ name, ok: true, note: r || '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

await fetch(B + '/api/reset', { method: 'POST', headers: H('teacher') });

await step('① 小组发起提案 → 进入待审批状态', async () => {
  const ca = await seatGet('CA');
  const ac = ca.game.aircraft.find(a => a.owned);
  const r = await seatPost('CA', { type: 'propose', kind: 'heavy_check', payload: { acId: ac.id }, note: 'G160 准备大修后出售' });
  ok(r.result === 'ok', '发起失败: ' + r.result);
  const ca2 = await seatGet('CA');
  const pr = ca2.game.proposals.find(p => p.kind === 'heavy_check');
  ok(pr && pr.status === 'pending', '提案状态不对: ' + JSON.stringify(pr));
  return `proposal ${pr.id} status=pending`;
});

await step('② 未获裁判批准 → 运营状态【未改变】', async () => {
  const ca = await seatGet('CA');
  const hc = ca.game.negotiation.heavyCheck || {};
  ok(Object.keys(hc).length === 0, '大修在未批准前就生效了: ' + JSON.stringify(hc));
  return 'heavyCheck 仍为空 ✓';
});

await step('③ 裁判批准 → 提案才真正生效', async () => {
  const ca = await seatGet('CA');
  const pr = ca.game.proposals.find(p => p.kind === 'heavy_check');
  const r = await gmPost({ type: 'resolveProposal', seat: 'CA', id: pr.id, action: 'approve', note: '同意' });
  ok(r.result === 'ok', '审批失败: ' + r.result);
  const ca2 = await seatGet('CA');
  const hc = ca2.game.negotiation.heavyCheck || {};
  ok(Object.keys(hc).length === 1, '批准后大修仍未生效: ' + JSON.stringify(hc));
  return `大修已生效（BH 上限 ${Object.values(hc)[0].bhAllowed}）`;
});

await step('④ 裁判驳回 → 不生效', async () => {
  const ca = await seatGet('CA');
  const r = await seatPost('CA', { type: 'propose', kind: 'cabin_extra_crew', payload: { acId: 1 }, note: '申请额外乘务员' });
  ok(r.result === 'ok', '发起失败');
  const ca2 = await seatGet('CA');
  const pr = ca2.game.proposals.find(p => p.kind === 'cabin_extra_crew');
  await gmPost({ type: 'resolveProposal', seat: 'CA', id: pr.id, action: 'reject', note: '不批' });
  const ca3 = await seatGet('CA');
  const crew = ca3.game.negotiation.cabinExtraCrew || {};
  ok(!crew[pr.payload.acId], '驳回后仍生效');
  return '已驳回且未生效 ✓';
});

await step('⑤ 跨组转让：小组发起后【别组数据不得改变】', async () => {
  const ca = await seatGet('CA');
  const ac = ca.game.aircraft.find(a => a.owned);
  const before = await seatGet('AB');
  const abCountBefore = before.game.aircraft.length;
  const abCashBefore = before.game.cash;
  await seatPost('CA', { type: 'propose', kind: 'sell_to_group',
    payload: { acId: ac.id, toSeat: 'AB', price: 1500000 }, note: '转让给 AB' });
  const during = await seatGet('AB');
  ok(during.game.aircraft.length === abCountBefore, '发起后 AB 机队就变了');
  ok(during.game.cash === abCashBefore, '发起后 AB 现金就变了');
  return `发起后 AB 仍为 ${abCountBefore} 架 / $${Math.round(abCashBefore).toLocaleString()} ✓`;
});

await step('⑥ 裁判改价后批准 → 按【裁判改后的价】转让', async () => {
  const ca = await seatGet('CA');
  const pr = ca.game.proposals.find(p => p.kind === 'sell_to_group');
  // 裁判把 150 万改成 100 万
  const r = await gmPost({ type: 'resolveProposal', seat: 'CA', id: pr.id, action: 'approve',
    modify: { price: 1000000 }, note: '压到 100 万' });
  ok(r.result === 'ok', '审批失败: ' + r.result);
  const ab = await seatGet('AB');
  const added = ab.game.aircraft.find(a => a.price === 1000000);
  ok(added, 'AB 未收到飞机');
  const caAfter = await seatGet('CA');
  ok(caAfter.game.cash >= 1000000, '卖方未收到 100 万');
  return `AB 收到 ${added.type}（价 $${added.price.toLocaleString()}，按裁判改后价而非原报价 150 万）`;
});

await step('⑦ 裁判批准时目标组付不起 → 拒绝执行', async () => {
  const ca = await seatGet('CA');
  const ac = ca.game.aircraft.find(a => a.owned);
  await seatPost('CA', { type: 'propose', kind: 'sell_to_group',
    payload: { acId: ac.id, toSeat: 'AB', price: 999999999 }, note: '天价' });
  const ca2 = await seatGet('CA');
  const pr = ca2.game.proposals.find(p => p.kind === 'sell_to_group' && p.status === 'pending');
  const r = await gmPost({ type: 'resolveProposal', seat: 'CA', id: pr.id, action: 'approve' });
  ok(String(r.result).includes('现金不足'), '未拦截: ' + r.result);
  return String(r.result);
});

await step('⑧ 事件豁免 + 替代机顶班', async () => {
  await fetch(B + '/api/reset', { method: 'POST', headers: H('teacher') });   // 独立场景
  const ca = await seatGet('CA');
  const own = ca.game.aircraft;
  ok(own.length >= 2, '需要至少两架飞机');
  const victim = own[0].id, repl = own[1].id;
  await seatPost('CA', { type: 'propose', kind: 'event_exemption',
    payload: { acId: victim, replacementAcId: repl }, note: '冰雹受损，申请豁免并由另一架顶班' });
  const ca2 = await seatGet('CA');
  const pr = ca2.game.proposals.find(p => p.kind === 'event_exemption');
  await gmPost({ type: 'resolveProposal', seat: 'CA', id: pr.id, action: 'approve' });
  const ca3 = await seatGet('CA');
  const ex = ca3.game.negotiation.exemptions || {};
  ok(ex[victim], '豁免未生效');
  ok(ex[victim].replacementAcId === repl, '替代机未指定');
  return `${victim} 豁免，替代机 ${repl} ✓`;
});

await step('⑨ 大飞机配小航线预警（真实教学点）', async () => {
  const GMOD = await import('./game.js');
  const g = { negotiation: { intel: { LEW: { price: 1 } } }, aircraft: [] };
  // Lewis 日潜在运量 150–200（真实情报值），G250 272 座 → 供给远超需求
  const ac = { type: 'G250', seats: 272, long: true };
  const w = GMOD.fleetRouteWarning(g, ac, 'LEW');
  ok(w, '未产生预警');
  ok(w.ratio > 1.5, `预警比值 ${w.ratio} 偏低`);
  // 小机型（100 座）在同一市场不应预警
  const w2 = GMOD.fleetRouteWarning(g, { type: 'APT100', seats: 100, long: false }, 'LEW');
  ok(!w2, '小机型不应预警');
  return `G250 272座/Lewis 日需求~175人 → 供给 ${w.ratio.toFixed(1)} 倍，预警 ✓`;
});

await step('⑩ 提案全程进入谈判记录（可审计）', async () => {
  const g = await fetch(B + '/api/gm', { headers: H('teacher') }).then(r => r.json());
  const log = g.gm.negotiationLog || [];
  const prop = log.filter(r => String(r.item).includes('提案审批'));
  ok(prop.length >= 3, `提案审批记录仅 ${prop.length} 条`);
  return `${prop.length} 条提案审批记录 ✓`;
});

console.log('='.repeat(84));
console.log('★ 提案治理 + 事件豁免 + 替代机顶班 专项测试');
console.log('='.repeat(84));
console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(44)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
process.exit(pass === R.length ? 0 : 1);
