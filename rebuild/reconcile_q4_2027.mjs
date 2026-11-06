import { readFileSync } from 'fs';
const G = await import('./game.js'); const E = await import('./engine.js'); const D = await import('./data.js');
const g = G.newGame(20261021); g.cash = 2_000_000; g.noCashSweep = true;
const apt = g.aircraft.find(a=>a.type==='APT100'), g160 = g.aircraft.find(a=>a.type==='G160');
g.routes = [{code:'SIM',fare:120,openedTurn:0,etopsPaid:false},{code:'ETN',fare:250,openedTurn:0,etopsPaid:false}];
for (const d of ['07:00','09:00','11:00','13:30','16:00','19:00']) g.schedules.push({acId:apt.id,code:'SIM',ac:apt,seats:apt.seats,bh:1.13,cargoCap:apt.cargo,departure:d,flightNo:'S'+d});
for (const d of ['08:00','10:30','15:00','18:30']) g.schedules.push({acId:g160.id,code:'ETN',ac:g160,seats:g160.seats,bh:1.88,cargoCap:g160.cargo,departure:d,flightNo:'E'+d});
g.__alloc = {
  SIM:{totalDemand:E.demand('Simone',120,540,1),marketFreq:540,marketFare:120,shares:{player:1},alloc:{player:E.demand('Simone',120,540,1)}},
  ETN:{totalDemand:E.demand('Ellington',250,720,1),marketFreq:720,marketFare:250,shares:{player:0.484,rival:0.516},alloc:{player:E.demand('Ellington',250,720,1)*0.484,rival:E.demand('Ellington',250,720,1)*0.516}}};
const rep = G.computeTurn(g, G.currentPeriod(g));
const agg = {};
agg['C:Flight Crew']=(agg['C:Flight Crew']||0)+E.F06_FIXED;
agg['C:Maintenance']=(agg['C:Maintenance']||0)+E.F07_FIXED;
agg['C:Fuel']=(agg['C:Fuel']||0)+E.F08_FIXED;
for (const code of Object.keys(rep.detail)) {
  const d = rep.detail[code];
  for (const [k,v] of Object.entries(d.rev)) agg['REV:'+k]=(agg['REV:'+k]||0)+v;
  for (const [k,v] of Object.entries(d.cost)) agg['C:'+k]=(agg['C:'+k]||0)+v;
}
const B = JSON.parse(readFileSync('../rebuild/baseline_real.json','utf8')).global_baseline_q4_2027.operating_costs_statement;
const rows=[]; const push=(n,r,s)=>rows.push([n,r,s]);
push('客运收入', B.revenues['Passenger Revenue'], agg['REV:Passenger Revenue']);
push('货邮收入', B.revenues['Cargo Revenue'], agg['REV:Cargo Revenue']);
push('辅营收入', B.revenues['Ancillary Revenue'], agg['REV:Ancillary Revenue']);
push('总收入', B.revenues['TOTAL REVENUE'], rep.revenue);
for (const k of Object.keys(B.direct_cash_operating_costs)) if (!k.startsWith('DIRECT')) push('  '+k, B.direct_cash_operating_costs[k], agg['C:'+k]);
for (const k of Object.keys(B.indirect_operating_costs)) if (!k.startsWith('INDIRECT')) push('  '+k, B.indirect_operating_costs[k], agg['C:'+k]);
push('总营业成本', B.totals['TOTAL OPERATING COSTS'], rep.cost);
push('经营利润', B.totals['OPERATING PROFIT/LOSS'], rep.operating_profit);
push('折旧(自有)', B.total_ownership_costs['Depreciation on Owned Assets'], (rep.operating_profit!=null)?(E.quarterlyDepreciation(g.aircraft.filter(a=>a.owned).reduce((a,x)=>a+x.price,0))):null);
push('保险', B.total_ownership_costs['Insurance'], (g.aircraft.filter(a=>a.owned).reduce((a,x)=>a+x.price,0))*D.GM.insurance_rate/100/4);
push('税前利润(仅扣利息)', B.totals['PROFIT/LOSS BEFORE TAX'], rep.operating_profit - (rep.net_finance_charges||0));
console.log('项目'.padEnd(24), '原版'.padStart(12), '沙盘'.padStart(12), '差额'.padStart(12), '偏差%'.padStart(8));
for (const [n,r,s] of rows) {
  const d = Math.round(s-r), p = (d/Math.abs(r)*100);
  console.log(String(n).padEnd(24), Math.round(r).toLocaleString().padStart(12), Math.round(s).toLocaleString().padStart(12), ((d>=0?'+':'')+d.toLocaleString()).padStart(12), (p>=0?'+':'')+p.toFixed(1)+'%');
}
console.log('\n旅客', Math.round(rep.paxTotal), '| LF', (rep.load_factor*100).toFixed(1)+'%');
