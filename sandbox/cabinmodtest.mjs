/* ============================================================
   客舱座位改造专项测试
   一手依据：原版 Investment Catalogue —— Cabin Upgrade (Low Cost)「a modest increase in seat count」；
             New Seats / Refresh「Impact is deferred by one Quarter」
   验收：
     ① 购置「客舱升级（低成本型）」→ 下一季度生效 → 经济舱座位增加、总座位增加
     ② 购置「客舱升级（银河级）」→ 公务舱座位增加、经济舱减少 → VIP 承载↑
     ③ 未购置 → 座位结构不变
     ④ 幂等：连续结算多季不累加
   ============================================================ */
import { newGame, applyCabinSeatMods, computeTurn } from './game.js';

const R = [], ERRS = [];
const step = async (name, fn) => {
  try { const r = await fn(); R.push({ name, ok: true, note: typeof r === 'string' ? r : '' }); }
  catch (e) { R.push({ name, ok: false, note: e.message }); ERRS.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const seatsOf = (g) => g.aircraft.map(a => `${a.type}:Y${a.eco}/W${a.prem}/J${a.biz}/T${a.seats}`).join(' ');

await step('基线：未购置 → 座位结构为机型原值', () => {
  const g = newGame('CA');
  applyCabinSeatMods(g);
  const a = g.aircraft[0];
  ok(a.eco === 100 && a.prem === 0 && a.biz === 0, '基线座位异常: ' + seatsOf(g));
  return seatsOf(g);
});

await step('低成本型：经济舱 +10，总座位 100 → 110', () => {
  const g = newGame('CA');
  g.investments.push({ id: 'cab_lowcost', openedTurn: 0 });
  g.turn = 1;                                  // 延迟一个季度 → 第 2 回合生效
  applyCabinSeatMods(g);
  const a = g.aircraft[0];
  ok(a.eco === 110, '经济舱座位未增加: ' + a.eco);
  ok(a.seats === 110, '总座位未更新: ' + a.seats);
  return seatsOf(g);
});

await step('延迟一个季度：投资当季不生效，下一季生效', () => {
  const g = newGame('CA');
  g.investments.push({ id: 'cab_lowcost', openedTurn: 0 });
  g.turn = 0;
  applyCabinSeatMods(g);
  ok(g.aircraft[0].eco === 100, '投资当季不应生效: ' + g.aircraft[0].eco);
  g.turn = 1;
  applyCabinSeatMods(g);
  ok(g.aircraft[0].eco === 110, '下一季应生效: ' + g.aircraft[0].eco);
  return 'T0 不变 → T1 生效';
});

await step('银河级：公务舱 +8、经济舱 −4 → VIP 承载↑', () => {
  const g = newGame('CA');
  const ac = g.aircraft.find(a => a.type === 'G130 J') || g.aircraft[0];
  const baseBiz = ac.biz || 0, baseEco = ac.eco || 0;   // ★ 先存基准（apply 会就地改对象）
  g.investments.push({ id: 'cab_galaxy', openedTurn: 0 });
  g.turn = 1;
  applyCabinSeatMods(g);
  const t = g.aircraft.find(a => a.type === ac.type);
  ok(t.biz >= baseBiz + 8, '公务舱未增加: ' + t.biz + ' (基准 ' + baseBiz + ')');
  ok(t.eco <= baseEco, '经济舱未减少: ' + t.eco + ' (基准 ' + baseEco + ')');
  return seatsOf(g);
});

await step('幂等：连续多季调用不累加', () => {
  const g = newGame('CA');
  g.investments.push({ id: 'cab_lowcost', openedTurn: 0 });
  g.turn = 1; applyCabinSeatMods(g);
  const once = g.aircraft[0].eco;
  g.turn = 2; applyCabinSeatMods(g);
  g.turn = 3; applyCabinSeatMods(g);
  ok(g.aircraft[0].eco === once, '座位被累加: ' + g.aircraft[0].eco + ' vs ' + once);
  return '稳定 ' + once;
});

console.log();
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(46)} ${r.note}`);
const pass = R.filter(r => r.ok).length;
console.log();
console.log('='.repeat(84));
console.log(`★ ${pass}/${R.length} 通过`);
if (ERRS.length) { console.log('失败:'); for (const e of ERRS) console.log('  - ' + e); }
process.exit(pass === R.length ? 0 : 1);
