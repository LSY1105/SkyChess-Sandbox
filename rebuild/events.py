"""SkyChess 事件系统 —— 从游戏内新闻 PDF 反推。

来源: Downloads/ABDM/Documents/flyte_*.pdf (Flyte Magazine 官方新闻稿)
      以及 Market Intelligence Report 中的风险预警章节

情报报告预警的风险全部兑现:
  风险清单                          实际事件              结果
  能源价格冲击(最高可能性)          —                    油价按市场级独立施加
  数据欺诈/网络攻击(第二位)          Q2 cyber (AB)        AB 收益管理系统被勒索
  环境 (佐格山火山)                 Q2 volcano           Ellington 需求受损 3 个月
  进一步疾病大流行(最大风险)         —                    未发生
  国际间冲突                        —                    未上升
"""
from dataclasses import dataclass, field
from typing import Optional

TURNS_PER_QUARTER = 1


@dataclass
class GameEvent:
    id: str
    quarter: str                 # 事件所属季度
    press_date: str
    title: str
    scope: str                   # airline / market / global
    target: str                  # 受影响对象
    summary: str
    # 量化后果（PDF 明确给出或可推导）
    effects: dict = field(default_factory=dict)
    evidence: str = ''


# ── 已发生的三个事件（PDF 原文） ─────────────────────────────────────
EVENTS = [
    GameEvent(
        id='q2-volcano',
        quarter='Q2 2028', press_date='2028-04-01',
        title='Volcano Eruption Causes Flight Chaos',
        scope='market', target='ETN',
        summary=(
            '佐格山（Ellington 附近活火山）昨夜无预警喷发。居民已安全撤离，'
            '无即时生命威胁，但商业园区严重受损，海滩被熔岩与火山灰污染。'
            'Ellington 的商务与休闲活动将长期受干扰。'),
        effects={
            'duration_turns': 3,        # "over the next three months"
            'demand_multiplier': None,  # 数值未知，需 EXP 观测
            'scope': 'all airlines serving ETN',
        },
        evidence='pdfs/flyte_Q2_volcano.txt',
    ),
    GameEvent(
        id='q2-cyber',
        quarter='Q2 2028', press_date='2028-04-01',
        title='Hackers Target Air Ballistic',
        scope='airline', target='AB',
        summary=(
            'Air Ballistic 遭网络攻击，乘客个人信息（含密码与信用卡数据）'
            '加密成功，另被窃取超过 30GB 源码，收入管理系统（Revenue Management）'
            '沦陷。乘客不满。Red Queen Consulting 声称此前已预警。'
            '有消息称该航司正被勒索。'),
        effects={
            'revenue_management_compromised': True,
            'ransom_demanded': True,
            'attack_ransom_field': 2_000_000,   # 与 airline.attack_ransom 对应
            'qsi_impact': 'negative',
        },
        evidence='pdfs/flyte_Q2_cyber_AB.txt',
    ),
    GameEvent(
        id='q3-hailstorm',
        quarter='Q3 2028', press_date='2028-07-01',
        title='Major Hailstorm Hits Hub Airport — Aircraft Damaged',
        scope='airline', target='CA:APT100',
        summary=(
            '巨型冰雹袭击枢纽机场，损毁建筑、车辆及露天停放的飞机，无人受伤。'
            '「投资了机库的航司免于最严重损坏」。'
            'Capital Airways 的 APT100 露天停放，机翼、机身、发动机罩受损，'
            '需大修，停飞约六周。'),
        effects={
            'grounded_weeks': 6,
            'daily_utilisation_cap': 4.0,     # 小时/日
            'duration_turns': 3,              # "for the next three months"
            'hangar_protection': True,        # 资产防护机制
        },
        evidence='pdfs/flyte_Q3_hailstorm_CA.txt',
    ),
    GameEvent(
        id='q4-saf-mandate',
        quarter='Q4/2028', press_date='2028-10-01',
        title='Airlines Brace For SAF Mandates',
        scope='global', target='ALL AIRLINES',
        summary=(
            '政府规定自 2029-01-01 起，5% 的燃油加注量必须为可持续航空燃料(SAF)。'
            '该强制令基于燃料供应商对充足供应的保证。'
            '航司抗议 SAF 价格约为常规航空燃油的 2.5 倍，难以负担；'
            '供应商则称低产量决定了其定价。政府首席科学顾问 Dr. Henry Greenleaf 表示，'
            '对航司实施 SAF 强制令是保持 2050 年净零排放目标的关键，'
            '并相信更多航司会被鼓励投资可持续项目以抵消增加的成本。'),
        effects={
            'mandate_pct_of_uplift': 5.0,
            'effective_date': '2029-01-01',
            'saf_price_multiple': 2.5,
            'observed_saf_cost_q4_2028': 2_000_000,   # 现金流 "SAF project"
            'observed_saf_cost_q1_2029': 1_030_860,   # 损益表 "Sustainable Aviation Fuel"
            'observed_carbon_q1_2029':   870_503,
        },
        evidence='_extracted/flyte_Q4_SAF.txt',
    ),
]

# ── 情报报告预警但尚未发生的风险 ──────────────────────────────────────
PENDING_RISKS = [
    ('pandemic',   '进一步的疾病大流行',       '最大风险', None),
    ('energy',     '能源价格冲击',             '最高可能性', '油价已按市场级独立冲击，但未有极端事件'),
    ('geopolitical','国际间冲突',               '无上升迹象', None),
    ('cyber',      '数据欺诈/盗窃 + 网络攻击', '第二位',    '已于 Q2 兑现(AB)'),
    ('environment','环境: 佐格山火山',         '大风险',    '已于 Q2 兑现'),
]

# ── 资产防护 ────────────────────────────────────────────────────────
# 事件报告原文: "Airlines that have invested in hangars were spared
#               the worst of the damage."
# 资产目录中 Hangar single aisle $1,935,000 / twin aisle $4,192,500
ASSET_PROTECTION = {
    'hangar':       {'single': 1_935_000, 'twin': 4_192_500,
                     'protects': True, 'note': '防止露天停放损坏'},
    'hotel':        {'price': 17_304_625, 'protects': False,
                     'note': '收益性资产'},
    'simulator':    {'single': 14_000_000, 'twin': 16_000_000,
                     'protects': False, 'note': '可对外销售时长'},
    'spare_engine': {'APT100': 7_000_000, 'APT300': 22_000_000,
                     'G250': 23_000_000, 'G130/G160': 10_000_000,
                     'G200/G200LR': 15_000_000,
                     'protects': True, 'note': '可靠性风险对冲'},
}


def events_for_quarter(quarter: str):
    return [e for e in EVENTS if e.quarter == quarter]


def active_effects(current_turn: int, event_quarter_turn: int,
                   duration_turns: int):
    """事件效果是否仍然生效"""
    return current_turn < event_quarter_turn + duration_turns


def summarise():
    lines = ['SkyChess 事件系统（来源: Flyte Magazine 游戏内新闻稿）', '=' * 70]
    for e in EVENTS:
        lines.append(f'\n[{e.id}] {e.title}')
        lines.append(f'  季度   : {e.quarter}   发布: {e.press_date}')
        lines.append(f'  影响对象: {e.target}  (范围: {e.scope})')
        lines.append(f'  摘要   : {e.summary}')
        lines.append('  量化后果:')
        for k, v in e.effects.items():
            lines.append(f'     {k:34} = {v}')
        lines.append(f'  证据   : {e.evidence}')
    lines.append('\n' + '=' * 70)
    lines.append('情报报告预警 vs 实际兑现')
    for rid, name, level, note in PENDING_RISKS:
        lines.append(f'  {rid:14} {name:24} [{level:8}] {note or "未发生"}')
    return '\n'.join(lines)


if __name__ == '__main__':
    print(summarise())