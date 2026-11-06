import { readFileSync } from 'fs';
import * as D from './data.js';
import * as E from './engine.js';
const B = JSON.parse(readFileSync('../rebuild/baseline_real.json', 'utf8'));
const F = JSON.parse(readFileSync('../rebuild/q2_2029_flights.json', 'utf8'));
const DAYS = 90, REF = 200, FREQ = 100;
const K = {};
/* ── GEE（McGee）：锚点 = 原版 VA Q2 2028「独飞 McGee，fare 825，pretax 6.40M，margin 40.2%」 ── */
{
  const rev = 6400000 / 0.402;                 // 收入
  const paxSeason = rev / 825;                 // 旅客 = 收入/票价
  const seatPerFlight = 147;                   // VA 的 G160/G200 级 147 座
  const flightsPerDay = 2;                     // 独飞需 2 班/日（复盘：LF 66%、独飞 100% 份额）
  const lf = 0.66;
  const Dmarket = paxSeason;                   // 独飞 → 市场总需求 = 我方旅客
  const freq = flightsPerDay * DAYS;
  const eps = D.MARKETS.GEE.elasticity;
  const Kgee = Dmarket / (Math.pow(REF / 825, eps) * Math.pow(freq / FREQ, 0.5));
  K.McGee = Math.round(Kgee);
  console.log(`GEE: 原版 VA 收入 $${Math.round(rev).toLocaleString()} → 旅客 ${Math.round(paxSeason).toLocaleString()}/季（${Math.round(paxSeason/DAYS)} 人/日）`);
  console.log(`    校验：${seatPerFlight} 座 × ${flightsPerDay} 班/日 × 90 × LF ${(lf*100).toFixed(0)}% = ${Math.round(seatPerFlight*flightsPerDay*DAYS*lf).toLocaleString()} 座位-旅`);
  console.log(`    → K_McGee = ${K.McGee}（eps ${eps}，全网频次 ${freq}）`);
}
/* ── ARM（Armstrong）：锚点 = 原版 CA Q3 2028 notes「Armstrong LF 100%」 ── */
{
  const seats = 159 * 1 * DAYS;                 // CA 1 班/日 × 159 座 × 90（独占，LF 100%）
  const Dmarket = seats;
  const freq = 3 * DAYS;                       // Q2'29 全网 3 班/日（CA 2 + VA 1）
  const eps = D.MARKETS.ARM.elasticity;
  const Karm = Dmarket / (Math.pow(REF / 550, eps) * Math.pow(freq / FREQ, 0.5));
  K.Armstrong = Math.round(Karm);
  console.log(`ARM: 独占 LF 100% → 市场季需求 ${Dmarket.toLocaleString()}（CA 1 班/日 × 159 座 × 90）`);
  console.log(`    → K_Armstrong = ${K.Armstrong}（现值 ${E.DEMAND_K.Armstrong}，eps ${eps}，freq ${freq}）`);
}
/* ── BZY（Broonzy）：无原版锚点 → 以 GEE 锚点按「同长程、需求规模相近」类比 ── */
{
  const ratio = (D.MARKETS.GEE.cargo_demand / D.MARKETS.BZY.cargo_demand) || 1;
  K.Broonzy = Math.round(K.McGee * (1 / ratio) * 0.85);   // 0.85：航段更短带来的需求折减（保守假设）
  console.log(`BZY: 无一手锚点 → 以 GEE 锚点类比（货量比 ${ratio.toFixed(2)}、航段折减 0.85）→ K_Broonzy = ${K.Broonzy}（现值 ${E.DEMAND_K.Broonzy}）`);
}
/* ── 代入沙盘验证：Q2'29 各长程市场的承运与 LF ── */
console.log('\n=== 代入验证（Q2 2029 实际航班配置）===');
for (const code of ['GEE','BZY','ARM']) {
  const m = D.MARKETS[code];
  const f = F.markets[code];
  const rows = [];
  for (const seat of ['CA','AB','VA']) {
    const fl = f[seat] || [];
    if (!fl.length) continue;
    const freq = fl.length * DAYS;
    const Dm = E.demand(m.name, fl[0].fare, freq, 1);
    const seatSum = fl.reduce((a,b)=>a+b.seats,0) * DAYS;
    rows.push(`${seat}: ${fl.length}班/日 票价$${fl[0].fare} 座位${seatSum} → 需求池 ${Math.round(Dm).toLocaleString()} → 若独飞LF ${(Math.min(1,Dm/seatSum)*100).toFixed(0)}%`);
  }
  console.log(` ${code}(${m.name}): K=${K[code === 'GEE' ? 'McGee' : code === 'BZY' ? 'Broonzy' : 'Armstrong']} → ` + rows.join(' | '));
}
writeFileSync('../rebuild/longhaul_k.json', JSON.stringify({ generatedAt: new Date().toISOString(), K, tag: '【模拟产出·单点反解】', basis: {
  GEE: '原版 VA Q2 2028 route_detail MCG：fare 825 / pretax 6.40M / margin 40.2%（独飞，LF 66%）',
  ARM: '原版 CA Q3 2028 notes：Armstrong LF 100%（独占）',
  BZY: '无一手锚点 → 以 GEE 类比（货量比 + 航段折减 0.85），不确定度最大',
}}, null, 2));
console.log('\n已写入 ../rebuild/longhaul_k.json');
