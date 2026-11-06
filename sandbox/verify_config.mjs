import * as G from './game.js';
import * as E from './engine.js';
import { MARKETS } from './data.js';
/* 原版 CA Q4/2027 真实配置：
   APT100 飞 SIM 6 班/日 ($120)，G160 飞 ETN 4 班/日 ($250)
   SIM 独占（无对手）；ETN 全网 720 班、CA 360 班、份额 48.40% */
const mk = (depList, fares) => {
  const g = G.newGame(20261021);
  g.cash = 2_000_000;
  g.noCashSweep = true;
  const apt = g.aircraft.find(a => a.type === 'APT100');
  const g160 = g.aircraft.find(a => a.type === 'G160');
  g.routes = [{ code: 'SIM', fare: 120, openedTurn: 0, etopsPaid: false },
              { code: 'ETN', fare: 250, openedTurn: 0, etopsPaid: false }];
  for (const d of depList.SIM) g.schedules.push({ acId: apt.id, code: 'SIM', ac: apt, seats: apt.seats, bh: 1.13, cargoCap: apt.cargo, departure: d, flightNo: 'CA-S' + d });
  for (const d of depList.ETN) g.schedules.push({ acId: g160.id, code: 'ETN', ac: g160, seats: g160.seats, bh: 1.88, cargoCap: g160.cargo, departure: d, flightNo: 'CA-E' + d });
  return g;
};
// 真实班次：SIM 6 班/日（09:00 早峰 + 其他），ETN 4 班/日
const dep = { SIM: ['07:00','09:00','11:00','13:30','16:00','19:00'], ETN: ['08:00','10:30','15:00','18:30'] };
const g = mk(dep);
/* 按原版真实份额设定竞争分配：
   SIM 玩家独占（Route Share 100%）；ETN 玩家 48.40%，其余为对手 */
const Dsim = E.demand('Simone', 120, 540, 1);
const Detn = E.demand('Ellington', 250, 720, 1);
g.__alloc = {
  SIM: { totalDemand: Dsim, marketFreq: 540, marketFare: 120,
         shares: { player: 1 }, alloc: { player: Dsim } },
  ETN: { totalDemand: Detn, marketFreq: 720, marketFare: 250,
         shares: { player: 0.484, rival: 0.516 },
         alloc: { player: Detn * 0.484, rival: Detn * 0.516 } },
};
const r = G.computeTurn(g, G.currentPeriod(g));
const s = r.detail.SIM, e = r.detail.ETN;
console.log('═══ 真实首季配置下的沙盘产出 vs 原版 ═══');
console.log(`SIM  班次/季 ${s.freq}（真实 540）｜ASK ${(s.ask/1e6).toFixed(1)}MM（真实 28.4）`
  + `｜旅客 ${Math.round(s.pax).toLocaleString()}（真实 29,300）｜LF ${(s.lf*100).toFixed(1)}%（真实 54.3%）`);
console.log(`ETN  班次/季 ${e.freq}（真实 720 全网/360 玩家）｜ASK ${(e.ask/1e6).toFixed(1)}MM（真实 65.8）`
  + `｜旅客 ${Math.round(e.pax).toLocaleString()}（真实玩家 32,600）｜LF ${(e.lf*100).toFixed(1)}%（真实 56.9%）`);
console.log(`网络 ASK ${(r.askTotal/1e6).toFixed(1)}MM（真实 94.2）｜旅客 ${Math.round(r.paxTotal).toLocaleString()}（真实 61,900）｜LF ${(r.load_factor*100).toFixed(1)}%（真实 56.1%）`);
