/* ============================================================
   分季规则 / 碳成本口径 / 贷款系统 专项测试
   ------------------------------------------------------------
   覆盖：
     RUL  分季规则开启表（逐季递进）与裁判覆盖
     CARB 碳成本口径（按燃油量 × 每吨碳价，对齐原版两航线交叉验证）
     SAF  SAF 强制掺混的开启时点（2029-01-01 = turn 5）
     LOAN 贷款：12 年等额本金 + 季息（含息口径）、现金下限强制还贷
   方法：数值断言锚定一手材料（Reports-ECONOMICS / Route Economics 截图）
   运行：node ruletest.mjs
   ============================================================ */
import { GM, CARBON, LOAN, RULE_SCHEDULE, MARKETS } from './data.js';
import * as G from './game.js';

let pass = 0, fail = 0;
const ok = (c, n, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}${e ? '  ' + e : ''}`); }
  else { fail++; console.log(`  ✗ ${n}${e ? '  ' + e : ''}`); }
};
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 58 - s.length))}`);

/* ══════════════ RUL：分季规则开启 ══════════════ */
head('RUL 分季规则开启表');
{
  const at = (turn) => RULE_SCHEDULE.filter(r => r.turn <= turn).map(r => r.key);
  const t0 = at(0), t1 = at(1), t2 = at(2), t5 = at(5);
  ok(t0.includes('carbonCost') && t0.includes('loanSystem') && t0.includes('fuelHedge')
     && t0.includes('intelPurchase') && t0.includes('etops') && t0.includes('heavyCheck'),
     'turn 0（Q4 2027）已开：碳成本/贷款/套保/情报/ETOPS/大修', `共 ${t0.length} 条`);
  ok(t1.includes('turnaroundNeg') && t1.includes('cyberService') && t1.includes('leaseWet'),
     'turn 1（Q1 2028）新开：过站谈判/网安服务/湿租');
  ok(t2.includes('carbonTerms') && t2.includes('leaseDry') && t2.includes('newMarkets')
     && t2.includes('hangar') && t2.includes('themedOp'),
     'turn 2（Q2 2028）新开：碳条款/干租/新市场/机库/主题化');
  ok(!t2.includes('safMandate'), 'turn 2 尚未开放 SAF 强制掺混');
  ok(t5.includes('safMandate'), 'turn 5（Q1 2029）开放 SAF 强制掺混',
     '依据 flyte Q4 SAF：2029-01-01 起 5% uplift');
  ok(RULE_SCHEDULE.every(r => r.basis && /\[(证据|裁定|推断)\]/.test(r.basis)),
     '每条规则均标注依据来源', `${RULE_SCHEDULE.length} 条`);
}
{
  const g = G.newGame(1);
  const s0 = G.ruleStatus(g);
  ok(s0.filter(r => r.on).length === RULE_SCHEDULE.filter(r => r.turn === 0).length,
     'ruleStatus 与 schedule 一致');
  ok(!s0.find(r => r.key === 'safMandate').on, 'turn 0 时 SAF 为关闭态');
  g.turn = 5;
  ok(G.isRuleOn(g, 'safMandate'), 'turn 5 后 SAF 开启');
  g.ruleOverrides = { safMandate: 1 };
  ok(G.isRuleOn(g, 'safMandate'), '裁判覆盖：SAF 可提前到 turn 1');
  g.ruleOverrides = { safMandate: 9 };
  ok(!G.isRuleOn(g, 'safMandate'), '裁判覆盖：SAF 可延后到 turn 9');
}

/* ══════════════ CARB：碳成本口径 ══════════════ */
head('CARB 碳成本按燃油量计量');
{
  // 原版两航线交叉验证（Reports-ECONOMICS-ROUTE ECONOMICS）
  const SIM = { gal: 314325, carbon: 179358 };
  const ETN = { gal: 489750, carbon: 279485 };
  const perGalSIM = SIM.carbon / SIM.gal, perGalETN = ETN.carbon / ETN.gal;
  ok(Math.abs(perGalSIM - 0.5706) < 0.001, 'SIM 碳成本/加仑 = $0.5706', `实算 ${perGalSIM.toFixed(5)}`);
  ok(Math.abs(perGalETN - 0.5707) < 0.001, 'ETN 碳成本/加仑 = $0.5707', `实算 ${perGalETN.toFixed(5)}`);
  ok(Math.abs(perGalSIM - perGalETN) / perGalSIM < 0.001,
     '两航线独立一致（互证系数）', `相对差 ${(Math.abs(perGalSIM-perGalETN)/perGalSIM*100).toFixed(3)}%`);
  const implied = perGalSIM / CARBON.base_price_per_tonne;
  ok(Math.abs(implied - CARBON.t_per_gallon) / CARBON.t_per_gallon < 0.01,
     '换算系数 t/gal 与基准碳价自洽',
     `${implied.toExponential(4)} vs ${CARBON.t_per_gallon.toExponential(4)}`);
}
{
  const g = G.newGame(7);
  g.cash = 20_000_000;
  const ac = g.aircraft[1];
  g.schedules.push({ acId: ac.id, code: 'SIM', ac, seats: ac.seats, bh: 1.13,
                     cargoCap: ac.cargo ?? 0, departure: '09:00', flightNo: 'CA-1' });
  const r = G.computeTurn(g, G.currentPeriod(g));
  const carb = r.detail.SIM.cost['Carbon'];
  ok(carb > 0, '结算中碳成本 > 0（原版口径：按燃油量）', `$${Math.round(carb).toLocaleString()}`);
  ok(r.detail.SIM.cost['Sustainable Aviation Fuel'] === 0, 'turn 0 时 SAF = 0（未到强制令）');
  g.turn = 5;
  const r2 = G.computeTurn(g, G.currentPeriod(g));
  ok(r2.detail.SIM.cost['Sustainable Aviation Fuel'] > 0, 'turn 5 后 SAF 计入成本',
     `$${Math.round(r2.detail.SIM.cost['Sustainable Aviation Fuel']).toLocaleString()}`);
}

/* ══════════════ LOAN：贷款系统 ══════════════ */
head('LOAN 贷款：等额本金 + 季息（含息口径）');
{
  const g = G.newGame(9);
  const l = g.loans[0];
  ok(Math.abs(l.quarterlyInterest - 892838) < 1,
     '首季利息 = $892,838（与原版 CA Q4/2027 实测完全一致）',
     `实算 $${Math.round(l.quarterlyInterest).toLocaleString()}`);
  ok(Math.abs(l.quarterlyPrincipal - GM.start_loan / LOAN.quarters) < 1e-6,
     '等额本金 = 总本金 / 48 季', `$${Math.round(l.quarterlyPrincipal).toLocaleString()}/季`);
  ok(Math.abs(l.quarterlyRepay - (l.quarterlyPrincipal + l.quarterlyInterest)) < 1e-6,
     '还款额含利息（验证结论）', `$${Math.round(l.quarterlyRepay).toLocaleString()}`);
  ok(l.quartersLeft === 48 && l.rate === 5.0, '12 年期 / 年利率 5%');
}
{
  // 起始机队按官方目录价入账
  const g = G.newGame(9);
  const tot = g.aircraft.reduce((a, x) => a + x.price, 0);
  ok(tot === GM.start_fleet_cost, '起始机队按官方目录价入账',
     `$${(tot / 1e6).toFixed(2)}M（APT100 40 + G160 95.04）`);
  ok(g.aircraft.length === 2 && g.aircraft[0].type === 'APT100' && g.aircraft[1].type === 'G160',
     '起始机队构成与原版 CA 一致（G160 + APT100）');
}
{
  // 强制还贷：现金充裕 → 压到初始股本 $2,000,000
  const g = G.newGame(11);
  g.cash = 50_000_000;
  const bal0 = g.loans[0].balance;
  const r = G.computeTurn(g, G.currentPeriod(g));
  ok(r.loan_sweep > 0, '现金充裕时发生超额强制还贷', `$${Math.round(r.loan_sweep).toLocaleString()}`);
  ok(r.cash_end >= LOAN.cash_floor - 1 && r.cash_end < LOAN.cash_floor + 50_000,
     '期末现金被压回 $2,000,000 附近', `$${Math.round(r.cash_end).toLocaleString()}`);
  ok(g.loans[0].balance < bal0, '贷款余额随强制还贷下降',
     `$${Math.round(g.loans[0].balance).toLocaleString()}`);
  // 现金不足时不触发
  const g2 = G.newGame(11);
  g2.cash = 100_000;
  const r2 = G.computeTurn(g2, G.currentPeriod(g2));
  ok(r2.loan_sweep === 0, '现金不足时不触发强制还贷');
}
{
  // 利息与本金在报表中只列一次（不复刻原版第 4 处呈现缺陷）
  const g = G.newGame(13);
  g.cash = 20_000_000;
  const r = G.computeTurn(g, G.currentPeriod(g));
  ok(r.net_finance_charges > 0, '损益：净财务费用（利息）单列', `$${Math.round(r.net_finance_charges).toLocaleString()}`);
  ok(Math.abs(r.financing + r.loan_principal) < 1e-6,
     '融资现金流只含本金（利息不重复列示）', `financing=$${Math.round(r.financing).toLocaleString()}`);
}

/* ══════════════ 距离口径 ══════════════ */
head('DIST 市场距离与 YIELD');
{
  ok(MARKETS.SIM.sector_km === 525, 'Simone 525km（Fare Manager 实证）');
  ok(MARKETS.ETN.sector_km === 1150, 'Ellington 1150km（Fare Manager 实证）');
  ok(MARKETS.FTZ.sector_km === 784, 'Fitzgerald 784km（VA 复盘实证）');
  ok(MARKETS.GEE.sector_km === 5265, 'McGee 5265km（VA 复盘实证）');
  ok(MARKETS.BZY.sector_km === 4473, 'Broonzy 4473km（VA 复盘实证；原沙盘误为 2100）');
  const y1 = 120 / MARKETS.SIM.sector_km, y2 = 250 / MARKETS.ETN.sector_km;
  ok(Math.abs(y1 - 0.23) < 0.005 && Math.abs(y2 - 0.22) < 0.005,
     'YIELD = 票价 ÷ 航段km（原版 Fare Manager 显示值复现）', `SIM ${y1.toFixed(4)}→$0.23, ETN ${y2.toFixed(4)}→$0.22`);
}

/* ══════════════ 汇总 ══════════════ */
console.log(`\n${'═'.repeat(64)}`);
console.log(`  规则/碳成本/贷款专项：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
console.log('═'.repeat(64));
process.exit(fail ? 1 : 0);
