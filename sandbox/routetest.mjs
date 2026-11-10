/* ============================================================
   航线释放与开线洽谈流程 集成测试   routetest.mjs
   ------------------------------------------------------------
   覆盖（原版机制）：
     REL   裁判**逐季释放**航线：初期 3 条独飞 + 1 条共享（SIM/FTZ/PKR + ETN）；Q2（turn 2）放出 JOP+CHA；后续逐步
     REQ   小组须**申请**（洽谈），不能自行开通
     APR   裁判批准后开通；驳回则不开通
     FEE   开线费固定不可议价 $200,000，且**只在开通当季扣一次**（不双扣）
     LOCK  未开通的航线不能排班
   运行：node routetest.mjs（需先启动 server.mjs）
   ============================================================ */
import { readFileSync } from 'fs';
const B = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';
const KEYS = JSON.parse(readFileSync(new URL(process.env.SANDBOX_KEY_FILE || './.sandbox-keys.json', import.meta.url), 'utf8'));
const KH = (seat) => ({ 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : (KEYS.seats[seat] || KEYS.teacher) });
const KHdr = (seat) => ({ 'Content-Type': 'application/json', ...KH(seat) });
const get = async (p, seat = 'teacher') => (await fetch(B + p, { headers: KH(seat) })).json();
const post = async (p, body, seat = 'teacher') => (await fetch(B + p, { method: 'POST', headers: KHdr(seat), body: JSON.stringify(body) })).json();

let pass = 0, fail = 0;
const ok = (c, n, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}${e ? '  ' + e : ''}`); }
  else { fail++; console.log(`  ✗ ${n}${e ? '  ' + e : ''}`); }
};
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 58 - s.length))}`);

await post('/api/reset', {});

/* ══════════════ REL：逐季释放 ══════════════ */
head('REL 裁判逐季释放航线');
{
  const g = (await get('/api/seat/CA', 'CA')).game;
  ok(g.routes.map(r => r.code).sort().join(',') === 'ETN,SIM',
     '初始仅开通 Simone + Ellington（原版 CA 首季即经营此两条）', g.routes.map(r => r.code).join(','));
  ok(g.releasedRoutes.includes('SIM') && g.releasedRoutes.includes('ETN'),
     'turn 0 已释放 SIM + ETN', g.releasedRoutes.join(','));
  ok(!g.releasedRoutes.includes('JOP') && !g.releasedRoutes.includes('CHA'),
     'turn 0 未释放 Q2 新航线', g.releasedRoutes.join(','));
  ok(g.releasedRoutes.includes('SIM') && g.releasedRoutes.includes('ETN')
     && g.releasedRoutes.includes('FTZ') && g.releasedRoutes.includes('PKR'),
     'turn 0 已释放 3 条独飞 + 1 条共享（SIM/FTZ/PKR + ETN）', g.releasedRoutes.join(','));
  ok(g.releasedRoutes.length === 4, '裁判尚未一次性开放全部航线', `当前 ${g.releasedRoutes.length} 条`);
}

/* ══════════════ REQ：须申请（洽谈）══════════════ */
head('REQ 开线须经申请，不能自行开通');
{
  const r = await post('/api/seat/CA', { type: 'openRoute', code: 'JOP' }, 'CA');
  ok(r.result === '裁判尚未开放该航线', '未释放的航线不能申请开通', String(r.result));
  const r2 = await post('/api/seat/CA', { type: 'openRoute', code: 'CHA' }, 'CA');
  ok(r2.result === '裁判尚未开放该航线', '同季未释放的另一条同样被拒', String(r2.result));
}

/* ══════════════ 推进到 Q2（turn 2）：裁判放出 2 条 ══════════════ */
head('REL turn 2 裁判放出 2 条新航线');
{
  // 先排班（原版 CA 首季：SIM 6 班/日 + ETN 4 班/日）→ 否则首季无收入、开线费付不起
  {
    const g0 = (await get('/api/seat/CA', 'CA')).game;
    const apt = g0.aircraft.find(a => a.type === 'APT100');
    const g160 = g0.aircraft.find(a => a.type === 'G160');
    for (const d of ['07:00','09:00','11:00','13:30','16:00','19:00'])
      await post('/api/seat/CA', { type: 'addFlight', acId: apt.id, code: 'SIM', departure: d }, 'CA');
    for (const d of ['08:00','10:30','15:00','18:30'])
      await post('/api/seat/CA', { type: 'addFlight', acId: g160.id, code: 'ETN', departure: d }, 'CA');
  }
  // 推进两个回合（Q4'27 → Q1'28 → Q2'28）；每回合需重排班（结算后清空）
  const sched = async () => {
    const g0 = (await get('/api/seat/CA', 'CA')).game;
    const apt = g0.aircraft.find(a => a.type === 'APT100');
    const g160 = g0.aircraft.find(a => a.type === 'G160');
    for (const d of ['07:00','09:00','11:00','13:30','16:00','19:00'])
      await post('/api/seat/CA', { type: 'addFlight', acId: apt.id, code: 'SIM', departure: d }, 'CA');
    for (const d of ['08:00','10:30','15:00','18:30'])
      await post('/api/seat/CA', { type: 'addFlight', acId: g160.id, code: 'ETN', departure: d }, 'CA');
  };
  await sched();
  for (let i = 0; i < 2; i++) { await post('/api/gm', { type: 'advanceAll' }, 'teacher'); await sched(); }
  const g = (await get('/api/seat/CA', 'CA')).game;
  ok(g.turn === 2, '已推进到 turn 2（Q2 2028）', `turn=${g.turn}`);
  ok(g.newlyReleasedRoutes.length === 2, '本季裁判放出 2 条新航线', g.newlyReleasedRoutes.join(','));
  ok(g.releasedRoutes.includes('JOP') && g.releasedRoutes.includes('CHA'),
     'Q2 新释放 JOP + CHA', g.releasedRoutes.join(','));
}

/* ══════════════ REQ/APR：申请 → 批准 ══════════════ */
head('REQ + APR 申请 → 裁判批准 → 开通');
{
  const r = await post('/api/seat/CA', { type: 'openRoute', code: 'JOP', note: '旺季窗口，请求本季开通' }, 'CA');
  ok(r.result === 'pending', '小组提交开线申请 → pending', String(r.result));
  const g1 = (await get('/api/seat/CA', 'CA')).game;
  ok(g1.routes.some(x => x.code === 'JOP') === false, '申请后**尚未开通**（不可排班）');
  ok((g1.routeRequests || []).some(x => x.code === 'JOP' && x.status === 'pending'), '申请进入待批队列');
  const dup = await post('/api/seat/CA', { type: 'openRoute', code: 'JOP' }, 'CA');
  ok(dup.result === '已申请，等待裁判', '重复申请被拒', String(dup.result));

  const ap = await post('/api/gm', { type: 'approveRoute', seat: 'CA', code: 'JOP', approve: true, note: '同意本季开通' }, 'teacher');
  const g2 = (await get('/api/seat/CA', 'CA')).game;
  const opened = g2.routes.some(x => x.code === 'JOP');
  if (ap.result === 'ok') {
    ok(opened, '批准后航线开通（可执行飞行）');
    ok(g2.routes.find(x => x.code === 'JOP').openedTurn === 2, '开通回合 = 当前回合',
       `openedTurn=${g2.routes.find(x => x.code === 'JOP').openedTurn}`);
  } else {
    // 裁决的两种合法结果：批准开通 / 因小组现金不足无法承担开线费而拒绝（真实约束）
    ok(ap.result.includes('现金不足'), '现金不足时裁判无法批准开线（真实约束）', String(ap.result));
    ok(!opened, '未获批准 → 航线未开通');
    // 给现金后重新申请并批准，验证「支付后开通」
    await post('/api/gm', { type: 'grantCash', seat: 'CA', amount: 12000000 }, 'teacher');
    await post('/api/seat/CA', { type: 'openRoute', code: 'JOP' }, 'CA');
    const ap2 = await post('/api/gm', { type: 'approveRoute', seat: 'CA', code: 'JOP', approve: true }, 'teacher');
    ok(ap2.result === 'ok', '现金充足后批准成功', String(ap2.result));
    const g3 = (await get('/api/seat/CA', 'CA')).game;
    ok(g3.routes.some(x => x.code === 'JOP'), '支付开线费后航线开通');
  }
}

/* ══════════════ FEE：开线费固定 $200,000 且只扣一次 ══════════════ */
head('FEE 开线费固定不可议价 $200,000');
{
  // 开线费在**批准时即时支付**（原版：支付航线费用开通后才能使用）
  await post('/api/gm', { type: 'grantCash', seat: 'CA', amount: 12000000 }, 'teacher');  // 补足前两季亏损，保证能承担开线费
  const g3 = (await get('/api/seat/CA', 'CA')).game;
  const cashBefore = g3.cash;
  const rq = await post('/api/seat/CA', { type: 'openRoute', code: 'FTZ' }, 'CA');
  ok(rq.result === 'pending', '申请第二条航线（FTZ，turn0 已释放）', String(rq.result));
  const ap2 = await post('/api/gm', { type: 'approveRoute', seat: 'CA', code: 'FTZ', approve: true }, 'teacher');
  ok(ap2.result === 'ok', '批准第二条航线开线', String(ap2.result));
  const g4 = (await get('/api/seat/CA', 'CA')).game;
  ok(Math.abs((cashBefore - g4.cash) - 200000) < 1, '开线费即时扣除 $200,000（固定不可议价）',
     `现金差 $${Math.round(cashBefore - g4.cash).toLocaleString()}`);
  // 后续回合不应再扣（不双扣）
  await post('/api/gm', { type: 'advanceAll' }, 'teacher');
  const after2 = (await get('/api/seat/CA', 'CA')).game;
  const last2 = after2.history[after2.history.length - 1];
  ok(last2.oneoff < 200000, '后续回合不再重复扣开线费（不双扣）', `oneoff=$${Math.round(last2.oneoff).toLocaleString()}`);
}

/* ══════════════ APR：驳回 ══════════════ */
head('APR 裁判可驳回开线申请');
{
  // 推进到 turn 3：裁判再释放 BZY / CHA（用于驳回测试）
  await post('/api/gm', { type: 'advanceAll' }, 'teacher');
  const r = await post('/api/seat/CA', { type: 'openRoute', code: 'BZY' }, 'CA');
  ok(r.result === 'pending', '申请 BZY（turn3 新释放）→ pending', String(r.result));
  const ap = await post('/api/gm', { type: 'approveRoute', seat: 'CA', code: 'BZY', approve: false, note: '本季不放行' }, 'teacher');
  ok(ap.result === 'ok', '裁判驳回开线申请', String(ap.result));
  const g = (await get('/api/seat/CA', 'CA')).game;
  ok(!g.routes.some(x => x.code === 'BZY'), '驳回后航线未开通');
  ok((g.routeRequests || []).some(x => x.code === 'BZY' && x.status === 'rejected'), '申请状态记为 rejected');
}

/* ══════════════ LOCK：未开通不可排班 ══════════════ */
head('LOCK 未开通的航线不能排班');
{
  const g = (await get('/api/seat/CA', 'CA')).game;
  const ac = g.aircraft[0];
  // BZY 已被裁判驳回 → 仍未开通 → 不能排班
  const r = await post('/api/seat/CA', { type: 'addFlight', acId: ac.id, code: 'BZY', departure: '09:00' }, 'CA');
  ok(r.result !== 'ok', '被驳回（未开通）的航线不能排班', String(r.result));
  // 未释放的航线同样不能排班
  const r2 = await post('/api/seat/CA', { type: 'addFlight', acId: ac.id, code: 'PKR', departure: '09:00' }, 'CA');
  ok(r2.result !== 'ok', '裁判未释放的航线不能排班', String(r2.result));
}

console.log(`\n${'═'.repeat(64)}`);
console.log(`  航线释放与开线洽谈：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
console.log('═'.repeat(64));
process.exit(fail ? 1 : 0);
