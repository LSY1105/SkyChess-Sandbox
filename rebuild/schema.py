"""SkyChess 重建 —— 数据模式层（从捕获数据反推的 ERD）。

数据来源: state-baseline.json (Evidence ev_6e72b73c...)
后端: PHP/Laravel + Eloquent, 命名空间 App\\, MySQL
"""

from dataclasses import dataclass, field
from typing import Optional, List
import json


@dataclass
class Aircraft:                      # App\Aircraft —— 机型目录
    id: int
    name: str
    seats: int
    seats_standard: int
    seats_business: int
    seats_premium: int
    total_price: float
    mtow: int
    structural_payload: int
    maximum_cargo_payload: float
    cargo_volume: float
    fuel_burn: float                 # 每飞行小时耗油量
    flight_speed: float              # km/h
    dmc_cycle: float                 # 周期维护成本
    dmc_fh: float                    # 飞行小时维护成本
    cabin_crew: int
    additional_cabin_crew: int
    payload_range_id: int

    @classmethod
    def from_json(cls, d: dict) -> 'Aircraft':
        num = lambda k, dflt=0.0: float(d[k]) if d.get(k) is not None else dflt
        return cls(
            id=d.get('id', 0), name=d.get('name', ''),
            seats=int(num('seats')), seats_standard=int(num('seats_standard')),
            seats_business=int(num('seats_business')),
            seats_premium=int(num('seats_premium')),
            total_price=num('total_price'), mtow=int(num('mtow')),
            structural_payload=int(num('structural_payload')),
            maximum_cargo_payload=num('maximum_cargo_payload'),
            cargo_volume=num('cargo_volume'), fuel_burn=num('fuel_burn'),
            flight_speed=num('flight_speed'), dmc_cycle=num('dmc_cycle'),
            dmc_fh=num('dmc_fh'), cabin_crew=int(num('cabin_crew')),
            additional_cabin_crew=int(num('additional_cabin_crew')),
            payload_range_id=int(num('payload_range_id')))


@dataclass
class Market:                        # App\Market —— 市场主数据
    id: int
    name: str
    code: str
    market_type: int
    market_demand_curve_id: int       # 仅外键，表内容服务端不可见
    market_transfer_model_id: int    # 仅外键
    inelasticity: float
    elasticity: float
    unit_p: float
    unit_q: float
    sector_length: float             # km
    population_growth: float
    gdp_growth: float
    population_demand: float
    gdp_demand: float
    k_factor: float
    size: float
    market_cargo_demand: float
    market_cargo_yield: float
    peak_revenue: float
    peak_landing: float
    peak_handling: float
    peak_traffic: float
    landing_fee: float
    handling_fee: float
    traffic_handling_fee: float
    cargo_handling_fee: float
    business_modifier: float
    business_handling: float
    premium_modifier: float
    premium_handling: float

    @classmethod
    def from_json(cls, d: dict) -> 'Market':
        f = {k: (float(v) if isinstance(v, (str, int)) and
                 k not in ('id', 'market_type', 'market_demand_curve_id',
                           'market_transfer_model_id') else v)
             for k, v in d.items()}
        return cls(**f)


@dataclass
class AirlineTurnMarket:              # 玩家在某航线的设置（覆盖市场默认值）
    """注意: 与 Market 是两层数据。
       business_modifier: market=1.20 vs airlineturn_market=1.80
       —— 玩家可覆盖，但覆盖规则在前端代码中未找到。
    """
    id: int
    airline_turn_id: int
    game_market_id: int
    fare: float
    landing_fee: float
    handling_fee: float
    traffic_handling_fee: float
    cargo_handling_fee: float
    peak_revenue: float
    peak_landing: float
    peak_handling: float
    peak_traffic: float
    business_modifier: float
    premium_modifier: float
    premium_handling: float
    business_handling: float
    gamemarket: dict = field(default_factory=dict)

    @classmethod
    def from_json(cls, d: dict) -> 'AirlineTurnMarket':
        keys = ('id', 'airline_turn_id', 'game_market_id', 'fare',
                'landing_fee', 'handling_fee', 'traffic_handling_fee',
                'cargo_handling_fee', 'peak_revenue', 'peak_landing',
                'peak_handling', 'peak_traffic', 'business_modifier',
                'premium_modifier', 'premium_handling', 'business_handling')
        return cls(**{k: float(d[k]) for k in keys},
                   gamemarket=d.get('gamemarket', {}))


@dataclass
class TurnEconomics:                 # turns.economics —— 每回合实际生效参数
    id: int
    turn_id: int
    fuel_price: Optional[float]      # 回合级生效油价 (str -> float)
    carbon_price: Optional[float]

    @classmethod
    def from_json(cls, d: dict) -> 'TurnEconomics':
        f = lambda v: float(v) if v is not None else None
        return cls(id=d['id'], turn_id=d['turn_id'],
                   fuel_price=f(d.get('fuel_price')),
                   carbon_price=f(d.get('carbon_price')))


@dataclass
class TurnMarket:                    # turns.markets —— 逐回合逐市场的解析结果
    """★ 需求模型的核心证据。

    服务端在每回合对每个市场解析出三个价格层级:
      - fuel_price            该市场本回合的油价 (部分市场有独立油价冲击)
      - elasticity_resolved   解析后的价格弹性  [已反推公式]
      - inelasticity_resolved 解析后的收入弹性  [已反推公式]

    已反推(仅 2 个取值点，需实验补证):
      elasticity_resolved   = -(1 + 0.05 * elasticity)
        e=1 -> -1.05 (观测) ; e=2 -> -1.10 (观测)
      inelasticity_resolved = -(0.6 * inelasticity - 0.3)
        i=1 -> -0.30 (观测) ; i=2 -> -0.90 (观测)
    """
    id: int
    game_market_id: int
    turn_id: int
    fuel_price: Optional[float]
    elasticity: int
    inelasticity: int
    elasticity_resolved: float
    inelasticity_resolved: float
    gamemarket: dict = field(default_factory=dict)

    @classmethod
    def from_json(cls, d: dict) -> 'TurnMarket':
        f = lambda v: float(v) if v is not None else None
        return cls(id=d['id'], game_market_id=d['game_market_id'],
                   turn_id=d['turn_id'], fuel_price=f(d.get('fuel_price')),
                   elasticity=d['elasticity'], inelasticity=d['inelasticity'],
                   elasticity_resolved=float(d['elasticity_resolved']),
                   inelasticity_resolved=float(d['inelasticity_resolved']),
                   gamemarket=d.get('gamemarket', {}))


@dataclass
class Quarter:                       # games.turns —— 一局中的回合
    id: int
    game_id: int
    turn: int
    quarter: int                     # 1..4
    year: int
    open: int                        # 0=未开放 1=进行中
    open_minutes: int
    opened_at: Optional[str]
    fare_lock_active: int
    economics: Optional[TurnEconomics] = None
    markets: List[TurnMarket] = field(default_factory=list)

    @classmethod
    def from_json(cls, d: dict) -> 'Quarter':
        ec = TurnEconomics.from_json(d['economics']) if d.get('economics') else None
        mk = [TurnMarket.from_json(m) for m in (d.get('markets') or [])]
        return cls(id=d['id'], game_id=d['game_id'], turn=d['turn'],
                   quarter=d['quarter'], year=int(d['year']), open=d['open'],
                   open_minutes=d['open_minutes'], opened_at=d.get('opened_at'),
                   fare_lock_active=d['fare_lock_active'],
                   economics=ec, markets=mk)


@dataclass
class Game:
    id: int
    title: str
    about: str
    game_status: int
    max_turns: int
    base_year: int
    max_bh: int                      # 每回合最大可用飞行小时
    open_minutes: int
    board_refresh_rate: int
    board_utc_offset: int
    board_show_departures: int
    board_players: int
    target_cash: float
    peak_pricing: int
    connecting_demand: int
    fuel_prices: list
    currentturn: int
    yearsplayed: float
    turns: List[Quarter] = field(default_factory=list)
    # 额外观测字段（保留）
    operational_status: int = 0
    airlinecolours: list = field(default_factory=list)

    @classmethod
    def from_json(cls, d: dict) -> 'Game':
        turns = [Quarter.from_json(t) for t in d.get('turns', [])]
        known = {f.name for f in __import__('dataclasses').fields(cls)}
        base = {k: v for k, v in d.items() if k in known and k != 'turns'}
        base['base_year'] = int(base['base_year'])
        base['yearsplayed'] = float(base['yearsplayed'])
        base['target_cash'] = float(base['target_cash'])
        base['airlinecolours'] = d.get('airlinecolours', [])
        return cls(turns=turns, **base)


@dataclass
class Airline:
    id: int
    name: str
    code: str
    game_id: int
    colour: str
    hex: str
    logo_id: int
    starting_cash: float
    operational_status: int
    attack_ransom: float             # 机制未知 [UNKNOWN]

    @classmethod
    def from_json(cls, d: dict) -> 'Airline':
        return cls(id=d['id'], name=d['name'], code=d['code'],
                   game_id=d['game_id'], colour=d['colour'], hex=d['hex'],
                   logo_id=d['logo_id'],
                   starting_cash=float(d['starting_cash']),
                   operational_status=d['operational_status'],
                   attack_ransom=float(d['attack_ransom']))


@dataclass
class AirlineAircraft:                # 玩家持有的一架飞机
    id: int
    airline_id: int
    aircraft_id: int
    nickname: str
    total_price: float
    total_finance: float
    spares: float                    # 备件百分比
    acquired_at_turn: int
    acquired_at_age: float
    available_from_turn: int
    leased_at_turn: Optional[int]
    leased_to_turn: Optional[int]
    left_at_turn: Optional[int]
    availability: bool
    aircraft: Aircraft = None

    @classmethod
    def from_json(cls, d: dict) -> 'AirlineAircraft':
        num = lambda k, dflt=0.0: float(d[k]) if d.get(k) is not None else dflt
        return cls(id=d.get('id', 0), airline_id=d.get('airline_id', 0),
                   aircraft_id=d.get('aircraft_id', 0),
                   nickname=d.get('nickname', ''),
                   total_price=num('total_price'),
                   total_finance=num('total_finance'), spares=num('spares'),
                   acquired_at_turn=int(num('acquired_at_turn')),
                   acquired_at_age=num('acquired_at_age'),
                   available_from_turn=int(num('available_from_turn')),
                   leased_at_turn=d.get('leased_at_turn'),
                   leased_to_turn=d.get('leased_to_turn'),
                   left_at_turn=d.get('left_at_turn'),
                   availability=d.get('availability', True),
                   aircraft=Aircraft.from_json(d.get('aircraft', {})))


@dataclass
class Flight:                        # 时刻表中的一班
    destination: str
    airlineColour: str
    flightNumber: str
    departure: str                   # "09:00:00"
    utilization: float               # 每航段日利用小时 (ADU 的分量)
    turnaround: int                  # 分钟


@dataclass
class ScheduleEntry:
    name: str
    aaid: int                        # airline_turn_aircraft_id
    flights: List[Flight] = field(default_factory=list)


# ════════════════════════════════════════════════════════════════════
# 投资与资产目录（来自 a11y 树，Evidence ev_6e72b73c...）
# ════════════════════════════════════════════════════════════════════
INVESTMENT_CATALOGUE = [
    # (名称, 成本, 收益, 类别)
    ('Advertising (Agents, Website)',        0,        150_000),
    ('Advertising (Billboards)',             0,        250_000),
    ('Advertising (Print)',                  0,        650_000),
    ('Advertising (Social Media)',           0,        350_000),
    ('Advertising (TV and Cinema)',          0,        500_000),
    ('Cabin Upgrade (Galaxy)',               3_700_000,   0),
    ('Cabin Upgrade (Low Cost)',             1_375_000,   0),
    ('Cabin Upgrade (New Seats)',            2_550_000,   0),
    ('Cabin Upgrade (Refresh)',              2_150_000,   0),
    ('eNewsletters',                         0,         75_000),
    ('Extra Bags',                           0,             0),
    ('Giveaways',                            0,         20_000),
    ('IFE (Basic Video)',                    1_450_000, 175_000),
    ('IFE (Enhanced Video)',                 1_600_000, 190_000),
    ('In Flight Connectivity (WiFi)',        1_450_000, 150_000),
    ('In Flight Connectivity Hi-Connex',     330_000,  120_000),
    # ... 共 126 项，完整列表见 experiments/report-open.json
]

ASSET_CATALOGUE = [
    # (名称, 价格, 说明摘要)
    ('Hangar single aisle',    1_935_000,  '两机库，含供暖/隔热/电动门/安保/办公室，交期 6 个月'),
    ('Hangar twin aisle',      4_192_500,  '同上，双通道'),
    ('Hotel',                 17_304_625,  '中端，115 间房，平均 325 平方英尺/间'),
    ('Simulator single aisle',14_000_000,  '含技术支持包/备件包/可用性保证，可对外销售模拟机时长'),
    ('Simulator twin aisle',  16_000_000,  '同上'),
    ('Spare engine APT100',    7_000_000,  '含支持包与快速更换发动机套件'),
    ('Spare engine APT300',   22_000_000,  '同上'),
    ('Spare engine G250',     23_000_000,  '同上'),
    ('Spare engine G130 & G160',10_000_000,'价格适用于 G130 或 G160'),
    ('Spare engine G200 & G200LR',15_000_000,'同上'),
]

# 机队财务默认值（Dashboard 显示，CA 全部机型一致）
FLEET_FINANCE_DEFAULTS = {
    'residual_value_pct': 10.0,
    'loan_years': 12,
    'loan_rate_pct': 5.0,
    'depreciation_years': 15,
    'insurance_rate_pct': 0.5,
}


def load_from_baseline(path='data/state-baseline.json'):
    """从捕获的基线快照构造完整世界状态。

    注意: /play/api/airline/833 的 airline 对象是精简版(16 键)，
    完整字段(含 starting_cash)出现在 /schedules 的深层嵌套里。
    """
    d = json.load(open(path, encoding='utf-8'))['snapshots']

    root = d['/play/api/airline/833']['payload']
    # airlineturn_id 随回合变化（5205/5364...），按前缀匹配
    def ep(prefix):
        ks = [k for k in d if k.startswith(prefix)]
        return d[ks[0]]['payload'] if ks else {}

    sched = ep('/play/api/airline/833/schedules/')
    # 完整 airline（含 starting_cash）藏在 aircraft[].airlineaircraft.airline 里
    deep_airline = root['airline']['aircraft'][0]['airline']
    game = Game.from_json(root['airline']['game'])
    airline = Airline.from_json(deep_airline)

    fleet = [AirlineAircraft.from_json(a)
             for a in root['airline']['aircraft']]

    sch = ep('/play/api/airline/833/scheduler/')
    at_markets = [AirlineTurnMarket.from_json(m)
                  for m in sch['airlineturn']['markets']]

    schedule = [ScheduleEntry(name=a['name'], aaid=a['aaid'],
                              flights=[Flight(**f) for f in a['flights']])
                for a in sched['schedule']['aircraft']]

    return {
        'game': game,
        'airline': airline,
        'fleet': fleet,
        'routes': at_markets,
        'schedule': schedule,
        'turn_economics': [t.economics for t in game.turns],
        'turn_markets': [t.markets for t in game.turns],
    }


