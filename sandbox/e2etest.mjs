/* ============================================================
   端到端与权限回归（2026-11-02 实测缺陷的护栏）
   覆盖：席位授权矩阵 / 席位登记白名单 / 空排班提交 / 前端渲染依赖字段
   ============================================================ */
import { readFileSync } from 'fs';
const B = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';
const KEYS = JSON.parse(readFileSync(new URL(process.env.SANDBOX_KEY_FILE || './.sandbox-keys.json', import.meta.url), 'utf8'));
const H = (seat) => ({ 'x-sandbox-key': seat === 'teacher' ? KEYS.teacher : KEYS.seats[seat] });
const Hd = (seat) => ({ 'Content-Type': 'application/json', ...H(seat) });
const get = async (p, seat) => { const r = await fetch(B + p, { headers: H(seat) }); return { st: r.status, b: await r.json() }; };
const post = async (p, body, seat) => { const r = await fetch(B + p, { method: 'POST', headers: Hd(seat), body: JSON.stringify(body) }); return { st: r.status, b: await r.json() }; };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

/* ⑧a 启动态：服务器初始化席位时也要广播全局参数（否则开局瞬间两端即不一致） */
{
  const gmb = (await get('/api/gm', 'teacher')).b.gm;
  const gs = (await get('/api/seat/CA', 'CA')).b.game;
  ok(gs.carbonPrice === gmb.carbonPrice, `启动态碳价一致（席位 ${gs.carbonPrice} vs 裁判 ${gmb.carbonPrice}）`);
  ok(gs.connectingDemand === gmb.connectingDemand, `启动态中转强度一致（席位 L${gs.connectingDemand} vs 裁判 L${gmb.connectingDemand}）`);
}

await post('/api/reset', {}, 'teacher');

/* ⑧b reset 之后、裁判尚未动过任何全局参数时，席位读数就必须与裁判端一致
   （11-17 缺陷：/api/reset 硬编码 gm.carbonPrice=22 旧口径 → 小组端读到 2577/L0，裁判端 22/L2）
   ★ 断言必须紧跟 reset：一旦调用 setFuel 等动作，applyGM 会广播并掩盖该缺陷 */
{
  const gmb = (await get('/api/gm', 'teacher')).b.gm;
  const gs = (await get('/api/seat/CA', 'CA')).b.game;
  ok(gs.carbonPrice === gmb.carbonPrice, `reset 后碳价与裁判端一致（席位 ${gs.carbonPrice} vs 裁判 ${gmb.carbonPrice}）`);
  ok(gs.connectingDemand === gmb.connectingDemand, `reset 后中转强度一致（席位 L${gs.connectingDemand} vs 裁判 L${gmb.connectingDemand}）`);
  ok(Array.isArray(gs.gmSync) && gs.gmSync.length === 0, 'gmSync 应为空（无待同步参数），实得 ' + JSON.stringify(gs.gmSync));
}

/* ① 授权矩阵 */
const a1 = await fetch(B + '/api/seat/CA');
ok(a1.status === 401, `无密钥读 CA → 401（实测 ${a1.status}）`);
const a2 = await get('/api/seat/AB', 'CA');
ok(a2.st === 401, `CA 密钥读 AB → 401（实测 ${a2.st}）`);
const a3 = await get('/api/seat/CA', 'teacher');
ok(a3.st === 200, `裁判密钥读 CA → 200（实测 ${a3.st}）`);
const a4 = await post('/api/gm', { type: 'setFuel', value: 2.4 }, 'CA');
ok(a4.st === 401, `小组密钥调裁判动作 → 401（实测 ${a4.st}）`);
const a5 = await post('/api/gm', { type: 'setFuel', value: 2.4 }, 'teacher');
ok(a5.st === 200, `裁判密钥调裁判动作 → 200（实测 ${a5.st}）`);

/* ② 未登记席位一律 403（不得凭空造组） */
const a6 = await get('/api/seat/ZZ9', 'teacher');
ok(a6.st === 403, `未登记席位 ZZ9 → 403（实测 ${a6.st}）`);
const gmSeats = (await get('/api/gm', 'teacher')).b.seats;
ok(!gmSeats.includes('ZZ9'), '未登记席位未进入裁判端席位列表');

/* ③ 裁判端显式创建小组席位 → 可访问、密钥返回 */
const CODE = 'T' + Date.now().toString(36).slice(-2).toUpperCase();   // 每次运行用新 3 位代码，避免与既有席位冲突
const r1 = await post('/api/gm', { type: 'createSeat', code: CODE }, 'teacher');
const key = r1.b.result;
ok(r1.st === 200 && typeof key === 'string' && key.length === 16, `createSeat → 返回 16 位密钥（${key}）`);
const r2 = await get('/api/seat/' + CODE, 'teacher');
ok(r2.st === 200 && r2.b.game.seat === CODE, '新建席位可访问');
const r3 = await get('/api/seat/' + CODE, 'CA');
ok(r3.st === 401, '其他小组不能访问新建席位');
const r4 = await post('/api/gm', { type: 'createSeat', code: CODE }, 'teacher');
ok(r4.b.result === 'seat exists', '重复创建同代码 → seat exists');

/* ④ 空排班提交必须被拒绝，且不推进回合 */
const before = (await get('/api/seat/AB', 'AB')).b.game;
const sub = await post('/api/seat/AB', { type: 'advance' }, 'AB');
ok(String(sub.b.result).includes('no flights'), `空排班提交被拒（${sub.b.result}）`);
const after = (await get('/api/seat/AB', 'AB')).b.game;
ok(after.turn === before.turn, `空排班提交后回合未推进（${before.turn} → ${after.turn}）`);

/* ⑤ 前端渲染依赖字段必须随 serialize 下发（allocateMarkets 崩溃根因） */
const g = (await get('/api/seat/CA', 'CA')).b.game;
ok(Array.isArray(g.competitors), 'serialize 含 competitors');
ok(g.groundUntil && typeof g.groundUntil === 'object', 'serialize 含 groundUntil');
ok(g.demandMult && typeof g.demandMult === 'object', 'serialize 含 demandMult');
ok(typeof g.qsi === 'number', 'serialize 含 qsi');

/* ⑥ 加航班后依赖字段仍在（前端刷新不崩） */
const ac = g.aircraft[0];
await post('/api/seat/CA', { type: 'addFlight', acId: ac.id, code: 'SIM', departure: '06:00' }, 'CA');
const g2 = (await get('/api/seat/CA', 'CA')).b.game;
ok(Array.isArray(g2.competitors) && !!g2.groundUntil && !!g2.demandMult, '加航班后依赖字段仍在');
ok(g2.schedules.length === 1, '加航班生效');
/* ⑦ 跨组写入隔离：CA 不能改 AB 的运价 */
const abBefore = (await get('/api/seat/AB', 'AB')).b.game;
await post('/api/seat/AB', { type: 'setFare', code: 'PKR', fare: 300 }, 'CA');
const abAfter = (await get('/api/seat/AB', 'AB')).b.game;
ok(abBefore.routes.find(r => r.code === 'PKR').fare === abAfter.routes.find(r => r.code === 'PKR').fare, '跨组写入被拒（AB 运价未变）');

/* ⑧ 裁判端「经营模式设定」必须能生效并回显
   （2026-11-17 实测缺陷：/api/gm 未下发 seatStyles → 裁判端读到 undefined → 下拉恒显「混合型」） */
const st0 = (await get('/api/gm', 'teacher')).b.seatStyles;
ok(st0 && st0.CA === 'LCC', `裁判端 /api/gm 下发 seatStyles（CA=${st0 && st0.CA}）`);
const stSet = await post('/api/gm', { type: 'setSeatStyle', seat: 'CA', style: 'FSC' }, 'teacher');
ok(stSet.b.result === 'ok', 'setSeatStyle → ok');
const st1 = (await get('/api/gm', 'teacher')).b.seatStyles;
ok(st1 && st1.CA === 'FSC', `setSeatStyle 后回显生效（CA=${st1 && st1.CA}）`);


/* ⑨ 裁判注资（grantCash）—— 小组现金为负时唯一能救场的动作 */
{
  const c0 = (await get('/api/seat/CA', 'CA')).b.game.cash;
  const gr = await post('/api/gm', { type: 'grantCash', seat: 'CA', amount: 500000 }, 'teacher');
  ok(gr.b.result === 'ok', 'grantCash → ok（实得 ' + gr.b.result + '）');
  const c1 = (await get('/api/seat/CA', 'CA')).b.game.cash;
  ok(Math.abs(c1 - (c0 + 500000)) < 1, `注资 $500,000 生效（${c0} → ${c1}）`);
}

/* ⑩ 投资双闸门：裁判「开放 / 关闭」+「议定条款」→ 小组端投资可达 */
{
  /* 原版注明「须与 GM 谈妥条款方可投资」→ 未议定前默认未开放 */
  const inv0 = await post('/api/seat/CA', { type: 'invest', id: 'cab_lowcost' }, 'CA');
  ok(/未开放/.test(String(inv0.b.result)), `未议定条款时该项应被拒（${inv0.b.result}）`);
  /* 议定条款 → 写入 investTerms（每客成本 / 收益） */
  const neg = await post('/api/gm', { type: 'negotiate', seat: 'CA', item: 'investTerms',
    invId: 'cab_lowcost', costPerPax: 1.5, revenuePerPax: 2 }, 'teacher');
  ok(neg.b.result === 'ok', '议定投资条款 → ok（实得 ' + neg.b.result + '）');
  const g = (await get('/api/seat/CA', 'CA')).b.game;
  const t = g.negotiation.investTerms.cab_lowcost;
  ok(t && t.costPerPax === 1.5 && t.revenuePerPax === 2, 'investTerms 写入成本/收益（实得 ' + JSON.stringify(t) + '）');
  /* 关闭 → 立即被拒；开放 → 放行并入账 */
  await post('/api/gm', { type: 'negotiate', seat: 'CA', item: 'investTerms', invId: 'adv_web', open: false }, 'teacher');
  const i2 = await post('/api/seat/CA', { type: 'invest', id: 'adv_web' }, 'CA');
  ok(/未开放/.test(String(i2.b.result)), `关闭后投资被拒（${i2.b.result}）`);
  await post('/api/gm', { type: 'negotiate', seat: 'CA', item: 'investTerms', invId: 'adv_web', open: true }, 'teacher');
  const i3 = await post('/api/seat/CA', { type: 'invest', id: 'adv_web' }, 'CA');
  ok(i3.b.result === 'ok', `开放后可投资（${i3.b.result}）`);
  const g3 = (await get('/api/seat/CA', 'CA')).b.game;
  ok(g3.investments.some(x => x.id === 'adv_web'), '投资记录已入账');
}

console.log('\n' + '═'.repeat(60));
console.log(`端到端与权限回归：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
process.exit(fail ? 1 : 0);
