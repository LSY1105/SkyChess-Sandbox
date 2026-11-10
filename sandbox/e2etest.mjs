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

await post('/api/reset', {}, 'teacher');

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

console.log('\n' + '═'.repeat(60));
console.log(`端到端与权限回归：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
process.exit(fail ? 1 : 0);
