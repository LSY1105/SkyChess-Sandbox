/* ============================================================
   课堂场景包 —— 裁判可一键套用的教学预设
   ------------------------------------------------------------
   为什么需要
   竞争教学沙盘要让不同班级/不同轮次面对**可区分的外生条件**，
   但每节课重新手填 8 个条款既慢又容易遗漏。
   场景包把"条款组合 + 事件排期 + 评分侧重"打包成可复现的预设。

   每个场景定义：
     id / name / desc        —— 标识与教学意图
     params                 —— 条款组合（直接落到各组 negotiation）
     events                 —— 事件排期（回合 → 事件 id）
     budgetLimit            —— 谈判额度
     focus                  —— 评分侧重提示（给裁判看）
   ============================================================ */

export const SCENARIOS = [
  {
    id: 'open-baseline',
    name: '基准·宽松',
    desc: '标准教学局：温和油价、无事件、谈判不限额。适合首轮熟悉机制。',
    params: { fuelPrice: null, carbonPrice: null, interestRate: null, connectingDemand: 2 },
    events: [],
    budgetLimit: null,
    focus: '重点：让学生体验"航线—机队—运价"三者的匹配关系',
  },
  {
    id: 'price-war',
    name: '价格战·紧张',
    desc: '油价高企、需求弹性放大、谈判额度收紧。适合讲定价策略与份额博弈。',
    params: { fuelPrice: 3.6, carbonPrice: 34, interestRate: 6.5, connectingDemand: 2 },
    events: [],
    budgetLimit: 4,
    focus: '重点：低票价换份额是否划算？参考真实纪要"LCC 不直接打折，靠投资管理调成本"',
  },
  {
    id: 'event-season',
    name: '事件季·冲击',
    desc: '第 3 回合起连续触发冰雹与网络攻击，检验各组的抗冲击能力。',
    params: { fuelPrice: 3.0, carbonPrice: 28, interestRate: 5.5, connectingDemand: 3 },
    events: [
      { turn: 2, id: 'hail', target: '*' },
      { turn: 3, id: 'cyber', target: '*' },
      { turn: 4, id: 'volcano', target: 'JOP' },
    ],
    budgetLimit: 6,
    focus: '重点：受损机豁免与替代机顶班；谁先恢复运力谁抢回份额',
  },
  {
    id: 'long-haul',
    name: '长程扩张',
    desc: '需求向远程市场倾斜，适合讲机队—航线匹配与 ETOPS 约束。',
    params: { fuelPrice: 3.2, carbonPrice: 26, interestRate: 5, connectingDemand: 3 },
    events: [],
    budgetLimit: 6,
    focus: '重点：大飞机配小航线必亏（参考真实纪要原话）；ETOPS 准入与机队能力耦合',
  },
  {
    id: 'freight-first',
    name: '货运优先',
    desc: '货运价值凸显：短程过站时间 45 分钟（保留货运），适合讲配平与辅营。',
    params: { fuelPrice: 3.0, turnaroundMin: 45, connectingDemand: 2 },
    events: [],
    budgetLimit: 6,
    focus: '重点：45 分钟过站不损失货运、30 分钟必须放弃货运的取舍',
  },
];

/** 按 id 取场景 */
export function getScenario(id) {
  return SCENARIOS.find(s => s.id === id) || null;
}
