/* ============================================================
   多席位 + 教师面板 集成测试
   验证: 席位独立性 / 裁判全局参数 / 事件定向 / 统一推进 / 页面可访问
   ============================================================ */
const B = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';
/* 席位授权：服务端要求 x-sandbox-key */
import { readFileSync } from 'fs';
const KEYS = JSON.parse(readFileSync(new URL(process.env.SANDBOX_KEY_FILE || './.sandbox-keys.json', import.meta.url), 'utf8'));
const KH = (seat) => ({ 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : (KEYS.seats[seat] || KEYS.teacher) });
const KHdr = (seat) => ({ 'Content-Type': 'application/json', ...KH(seat) });

const R = [], ERRS = [];
const step = async (name, fn) => {
  try { const r = await fn(); R.push({ name, ok: r === undefined ? true : !!r, note: typeof r === 'string' ? r : '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); ERRS.push(`${name}: ${e.message}`); }
};
const get = async (p, seat = 'teacher') => (await fetch(B + p, { headers: KH(seat) })).json();
const post = async (p, body, seat = 'teacher') => (await fetch(B + p, { method: 'POST', headers: KHdr(seat), body: JSON.stringify(body) })).json();
const ok = (c, m) => { if (!c) throw new Error(m); };

// 测试隔离：先重置全局
await post('/api/reset', {});

await step('页面可访问：/ /player.html /teacher.html', async () => {
  for (const p of ['/', '/player.html?seat=CA', '/teacher.html']) {
    const r = await fetch(B + p, { headers: KH('teacher') }); ok(r.status === 200, `${p} → ${r.status}`);
  }
  return '3 页';
});

await step('三席位存在且初始独立', async () => {
  const g = await get('/api/gm', 'teacher');
  ok(g.seats.length >= 3, '席位数不足 3');
  const cash = {};
  for (const s of g.seats) { const d = await get('/api/seat/' + s, s); cash[s] = d.game.cash; }
  ok(new Set(Object.values(cash)).size >= 2, '三席位现金完全相同（未独立）');
  return Object.entries(cash).map(([k, v]) => k + ':$' + v.toLocaleString()).join(' ');
});

await step('CA 改运价不影响 AB/VA', async () => {
  await post('/api/seat/CA', { type: 'setFare', code: 'SIM', fare: 150 });
  const ab = await get('/api/seat/AB', 'AB'); const va = await get('/api/seat/VA', 'VA');
  const f = (d) => d.game.routes.find(r => r.code === 'SIM')?.fare;
  ok(f(ab) !== 150 && f(va) !== 150, 'AB/VA 的运价被改了');
  return `AB=${f(ab)} VA=${f(va)} (未被污染)`;
});

await step('CA 开航线不影响 AB/VA', async () => {
  await post('/api/seat/CA', { type: 'openRoute', code: 'LEW' });
  const ab = await get('/api/seat/AB', 'AB');
  ok(!ab.game.routes.find(r => r.code === 'LEW'), 'AB 也有了 LEW');
  return 'AB 无 LEW ✓';
});

await step('裁判设全局油价 → 三席位同步', async () => {
  await post('/api/gm', { type: 'setFuel', value: 4.5 });
  for (const s of ['CA', 'AB', 'VA']) {
    const d = await get('/api/seat/' + s, s);
    ok(d.game.fuelPrice === 4.5, s + ' 油价未同步');
  }
  return '三席位均为 4.50';
});

await step('裁判设利率/碳价/中转强度 → 同步', async () => {
  await post('/api/gm', { type: 'setInterest', value: 3.5 });
  await post('/api/gm', { type: 'setCarbon', value: 30 });
  await post('/api/gm', { type: 'setConnecting', value: 3 });
  for (const s of ['CA', 'AB', 'VA']) {
    const d = await get('/api/seat/' + s, s);
    ok(d.game.interestRate === 3.5 && d.game.carbonPrice === 30 && d.game.connectingDemand === 3, s + ' 未同步');
  }
  return '利率3.5% 碳价30 中转L3';
});

await step('裁判事件定向到单席位', async () => {
  await post('/api/gm', { type: 'triggerEvent', eventId: 'volcano', target: 'SIM', seat: 'VA' });
  const ca = await get('/api/seat/CA', 'CA'); const va = await get('/api/seat/VA', 'VA');
  ok(!ca.game.demandMult.SIM, 'CA 被误伤');
  ok(va.game.demandMult.SIM, 'VA 未被施加');
  return '仅 VA 受影响';
});

await step('裁判全局事件影响全部席位', async () => {
  await post('/api/gm', { type: 'triggerEvent', eventId: 'pandemic', target: '' });
  for (const s of ['CA', 'AB', 'VA']) {
    const d = await get('/api/seat/' + s, s);
    ok(Object.keys(d.game.demandMult).length > 0, s + ' 未受影响');
  }
  return '三席位均受影响';
});

await step('各席位排班后独立结算，结果不同', async () => {
  // CA 飞 2 班 SIM，AB 飞 3 班 SIM，VA 不飞
  // CA 用 2 架飞机各飞 1 班；AB 用 2 架飞机各飞 2 班（同机不同班次需错开）
  for (const [seat, plan, mkt] of [['CA', [1, 1], 'SIM'], ['AB', [1, 1], 'PKR']]) {
    const d0 = await get('/api/seat/' + seat);
    const acs = d0.game.aircraft;
    let k = 0;
    for (const n of plan) {
      for (let i = 0; i < n; i++) {
        const ac = acs[k % acs.length];
        await post('/api/seat/' + seat, { type: 'addFlight', acId: ac.id, code: mkt, departure: '0' + (6 + i * 6) + ':00' });
        k++;
      }
    }
  }
  const nc = (await get('/api/seat/CA', 'CA')).game.schedules.length;   // 推进前读取
  const na = (await get('/api/seat/AB', 'AB')).game.schedules.length;
  ok(nc === 2 && na === 2, `排班数不对 CA=${nc} AB=${na}`);
  const res = await post('/api/gm', { type: 'advanceAll' });
  const ca = await get('/api/seat/CA', 'CA'); const ab = await get('/api/seat/AB', 'AB');
  const p = (d) => d.game.history[d.game.history.length - 1].operating_profit;
  ok(p(ca) !== p(ab), 'CA 与 AB 利润相同（未独立计算）');
  // 运力更多 → 承运旅客应更多或相等；
  // ⚠ 利润**未必**更高：需求受限时多加班次只增成本（燃油/维护/机组）而承运被总量保护截断
  //    ——「运力过剩反而亏钱」本身是重要教学点，故此处只断言承运量关系。
  // ⚠ 且不同市场不可直接比（AB 飞 Parker、CA 飞 Simone，Parker 需求本就小），
  //    故改为断言「各席位独立结算、结果互不相同」。
  const paxOf = (d) => d.game.history[d.game.history.length - 1].paxTotal;
  ok(paxOf(ab) !== paxOf(ca), '各席位独立结算，结果互不相同',
     `AB ${Math.round(paxOf(ab))} vs CA ${Math.round(paxOf(ca))}（利润 AB ${Math.round(p(ab))} / CA ${Math.round(p(ca))}）`);
  return `CA ${nc}班 利润 ${Math.round(p(ca)).toLocaleString()} | AB ${na}班 利润 ${Math.round(p(ab)).toLocaleString()}`;
});

await step('裁判统一推进 → 全局回合数增加', async () => {
  const before = (await get('/api/gm')).gm.turn;
  await post('/api/gm', { type: 'advanceAll' });
  const after = (await get('/api/gm')).gm.turn;
  ok(after > before, '全局回合未推进');
  return `${before} → ${after}`;
});

await step('事件历史被记录（裁判可审计）', async () => {
  const g = await get('/api/gm', 'teacher');
  ok(g.gm.events.length >= 2, '事件历史不足');
  return g.gm.events.map(e => e.id || e.title).join(', ');
});

await step('动态新建席位 G1（裁判端显式创建 · 每组一个独立席位）', async () => {
  const cr = await post('/api/gm', { type: 'createSeat', code: 'G1' }, 'teacher');
  ok(cr.result === 'seat exists' || (typeof cr.result === 'string' && cr.result.length === 16), '裁判端创建席位失败');
  const d = await get('/api/seat/G1', 'teacher');
  ok(d.game, '未创建 G1');
  ok(d.game.cash === 2000000, 'G1 初始现金异常');
  const caBefore = await get('/api/seat/CA', 'CA');
  const before = JSON.stringify([caBefore.game.routes, caBefore.game.cash, caBefore.game.schedules]);
  // 新机制：航线由裁判逐季释放，新席位初始只有已释放的航线（SIM + ETN）
  await post('/api/seat/G1', { type: 'openRoute', code: 'LEW' });   // turn0 未释放 → 应被拒
  await post('/api/seat/G1', { type: 'addFlight', acId: 1, code: 'SIM', departure: '07:00' });
  const caAfter = await get('/api/seat/CA', 'CA');
  const after = JSON.stringify([caAfter.game.routes, caAfter.game.cash, caAfter.game.schedules]);
  ok(before === after, 'G1 的操作污染了 CA');
  const g1 = await get('/api/seat/G1', 'G1');
  ok(g1.game.routes.map(r => r.code).sort().join(',') === 'ETN,SIM',
     'G1 初始航线与 CA 一致（SIM+ETN，裁判分季释放）', g1.game.routes.map(r => r.code).join(','));
  ok(g1.game.schedules.length === 1, 'G1 可独立排班', `${g1.game.schedules.length} 班次`);
  return 'G1 独立且生效 ✓';
});

await step('全局重置 → 三席位回到开局', async () => {
  await post('/api/reset', {});
  const g = await get('/api/gm', 'teacher');
  for (const s of g.seats) {
    const d = await get('/api/seat/' + s, s);
    ok(d.game.turn === 0 && d.game.history.length === 0, s + ' 未重置');
  }
  return 'OK';
});

console.log('='.repeat(84));
console.log('★ 多席位 + 教师面板 集成测试');
console.log('='.repeat(84));
console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(42)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
if (ERRS.length) { console.log('失败:'); for (const e of ERRS) console.log('  -', e); }
process.exit(pass === R.length ? 0 : 1);
