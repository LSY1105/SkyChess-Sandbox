import { readFileSync, writeFileSync } from 'fs';
const r = JSON.parse(readFileSync('replay_out/report.json', 'utf8'));
let md = '# 多季回测记录（7 季 · 2027Q4–2029Q2）\n\n**场景**：' + r.scenario + '\n\n';
md += '**套保报价方（3 家，条件各异）**\n\n| id | 供给方 | 产品 | 锁价 | 走廊 | 覆盖 | 期限 | 一次性 | 季费 | 变动/加仑 | 预付 | 最低量 | 信用保护 | 杠杆 | 条件 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const q of r.hedgeQuotes) md += '| ' + q.id + ' | ' + q.supplier + ' | ' + q.product + ' | ' + q.strike + ' | ' + (q.floor ?? '-') + ' | ' + (q.share * 100) + '% | ' + q.quarters + ' | $' + q.upfront.toLocaleString() + ' | $' + q.fixedFeePerQuarter.toLocaleString() + ' | $' + q.varPerGal + ' | ' + (q.prepayRate * 100) + '% | ' + (q.minGallons ? q.minGallons.toLocaleString() : '-') + ' | ' + (q.creditSupport ? '是' : '否') + ' | ' + q.leverage + ' | ' + q.terms + ' |\n';
md += '\n**比价情景**：' + r.hedgeScenarios.map(s => s.label + '（权重 ' + s.weight + '）').join('；') + '\n';
for (const s of r.seasons) {
  md += '\n## 第 ' + s.turn + ' 季 ' + (s.seats.CA.period || '') + '\n\n**输入**\n- 开启规则（' + s.inputs.rules.length + '）：' + s.inputs.rules.join(', ') + '\n- 释放航线：' + (s.inputs.routes.join(', ') || '无') + '\n- 触发事件：' + (s.inputs.events.map(e => e.eventId + '→' + (e.target || e.seat || 'global') + '（' + e.result + '）').join(', ') || '无') + '\n';
  if (s.inputs.hedge.length) { md += '- 套保比价选型：\n'; for (const h of s.inputs.hedge) md += '  - ' + h.seat + ' 选 **' + h.pick + '**｜比价（期望 $/加仑）' + h.ranking + '｜现货 $' + h.unhedged + '｜' + h.result + '\n'; }
  if (s.inputs.buys.length) md += '- 购买增值服务：' + s.inputs.buys.map(b => b.seat + ':' + b.id).join(', ') + '\n';
  if (s.inputs.proposals.length) md += '- 提案与开线申请：' + s.inputs.proposals.map(p => p.seat + ':' + (p.kind === 'openRoute' ? '开线 ' + p.code : p.kind) + '（' + p.result + '）').join(', ') + '\n';
  if (s.inputs.grants && s.inputs.grants.length) md += '- 裁判注资：' + s.inputs.grants.map(x => x.seat + ' $' + x.amount.toLocaleString() + '（注资前 $' + x.cashBefore.toLocaleString() + '）').join(', ') + '\n';
  md += '\n**关键输出**\n\n| 席位 | 现金 | 航线 | 收入 | 营业利润 | 旅客 | LF | 市场份额 | 贷款余额 | 投资数 |\n|---|---|---|---|---|---|---|---|---|---|\n';
  for (const x of r.seats) { const v = s.seats[x];
    md += '| ' + x + ' | $' + v.cash.toLocaleString() + ' | ' + v.routes.join('+') + ' | ' + (v.revenue != null ? v.revenue.toLocaleString() : '-') + ' | ' + (v.operating_profit != null ? v.operating_profit.toLocaleString() : '-') + ' | ' + (v.pax ?? '-') + ' | ' + (v.load_factor ?? '-') + ' | ' + (v.share ?? '-') + ' | $' + v.loan_balance.toLocaleString() + ' | ' + v.investments + ' |\n'; }
  md += '\n**运行日志（裁判端）**\n\n'; for (const l of s.gmLog) md += '- ' + l + '\n';
}
const st = { covered: 0, failed: 0, unverified: 0 }; const bc = {};
for (const c of r.coverage) { st[c.state]++; bc[c.cat] = bc[c.cat] || { covered: 0, failed: 0, unverified: 0 }; bc[c.cat][c.state]++; }
md += '\n## 功能覆盖清单\n\n合计 ' + r.coverage.length + '｜覆盖 ' + st.covered + '｜失败 ' + st.failed + '｜未验证 ' + st.unverified + '\n\n| 类别 | 覆盖 | 失败 | 未验证 |\n|---|---|---|---|\n';
for (const [k, v] of Object.entries(bc)) md += '| ' + k + ' | ' + v.covered + ' | ' + v.failed + ' | ' + v.unverified + ' |\n';
md += '\n### 失败项\n\n| 类别 | 功能 | 说明 |\n|---|---|---|\n';
for (const c of r.coverage.filter(x => x.state === 'failed')) md += '| ' + c.cat + ' | ' + c.name + ' | ' + c.note + ' |\n';
const uv = r.coverage.filter(x => x.state === 'unverified');
md += '\n### 未验证项\n\n' + (uv.length ? uv.map(c => '- [' + c.cat + '] ' + c.name + '：' + c.note).join('\n') : '（无）');
md += '\n\n## 市场份额趋势\n\n| 季 | CA | AB | VA |\n|---|---|---|---|\n';
for (const x of r.shareTrend) md += '| T' + x.turn + ' | ' + (x.shares.CA ?? '-') + ' | ' + (x.shares.AB ?? '-') + ' | ' + (x.shares.VA ?? '-') + ' |\n';
writeFileSync('replay_out/回测记录.md', md);
console.log('回测记录已生成', md.split('\n').length, '行');
