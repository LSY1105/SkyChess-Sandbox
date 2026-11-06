"""从 API 响应反推数据库实体、外键关系与 Laravel 模型命名。"""
import json, re
from collections import defaultdict

d = json.load(open('state-baseline.json', encoding='utf-8'))['snapshots']
blob = json.dumps(d, ensure_ascii=False)

# 1) 外键 -> 实体推断
FK = {
    'airline_id': 'airlines', 'game_id': 'games', 'aircraft_id': 'aircraft',
    'airline_turn_id': 'airline_quarters', 'airline_turn_aircraft_id': 'airline_turn_aircraft',
    'airline_turn_market_id': 'airline_turn_markets', 'airline_aircraft_id': 'airline_aircraft',
    'game_market_id': 'game_markets', 'market_id': 'markets', 'turn_id': 'quarters',
    'market_demand_curve_id': 'market_demand_curves', 'market_transfer_model_id': 'market_transfer_models',
    'payload_range_id': 'payload_ranges', 'imageable_id': '(polymorphic)',
    'investment_id': 'investments', 'logo_id': 'logos', 'asset_id': 'assets',
}
present = sorted(k for k in FK if f'"{k}"' in blob)

# 2) Laravel 模型类名（若泄漏）
models = sorted(set(re.findall(r'"App\\\\([A-Za-z]+)"', blob)))

# 3) 推断的实体及其字段（按响应中的对象名）
ENT = {
    'games': None, 'airlines': None, 'quarters': None, 'airline_quarters': None,
    'markets': None, 'game_markets': None, 'airline_turn_markets': None,
    'aircraft': None, 'airline_aircraft': None, 'airline_turn_aircraft': None,
    'players': None, 'payload_ranges': None, 'investments': None,
}

print('=' * 76)
print('后端技术栈判定')
print('=' * 76)
print('  语言/框架   : PHP / Laravel (Eloquent ORM)')
print('  命名空间     : App\\            <- 由 imageable_type 泄漏证实')
print('  反向代理     : Cloudflare       <- Server/CF-RAY/cf-cache-status 响应头')
print('  认证         : Cookie Session + XSRF-TOKEN (Laravel EncryptCookies)')
print('  模板引擎     : Blade            <- 报表页服务端渲染，页面 0 XHR')
if models:
    print('  已泄漏模型类 :', ', '.join('App\\' + m for m in models))

print()
print('=' * 76)
print('外键关系图 (由 API 响应中的 *_id 字段反推)')
print('=' * 76)
for k in present:
    print('  %-30s -> %s' % (k, FK[k]))

print()
print('=' * 76)
print('时间戳 / 生命周期字段')
print('=' * 76)
ts = sorted(set(re.findall(r'"([a-z_]*(?:_at|_from|_to|_years|_turn))"', blob)))
print(' ', ', '.join(ts))

print()
print('=' * 76)
print('推定的数据模型 (ERD)')
print('=' * 76)
print("""
  games (id=285)
    ├──< quarters            (turn 0..5, year/quarter/open/fare_lock_active)
    ├──< game_markets        (game_id + market_id, from_turn, initial_size, fuel_prices[])
    ├──< gameinvestments ─┐
    ├──< gameaircraft     ─┤ 对局实体(裁判配置)
    ├──< gameassets       ─┘
    └──< airlines         (id=833/AB/VA, starting_cash, attack_ransom, logo_id)
              │
              ├──< airline_aircraft      (nickname, total_price, spares, acquired_at_turn/age)
              │          └──> aircraft   (机型目录: fuel_burn, dmc_cycle, seats_*, payload_range_id)
              │                    └──> payload_ranges
              ├──< airline_quarters      (id=5205, airline_id, turn_id)  「一个回合的快照」
              │          ├──< airline_turn_aircraft (seats, interest_rate, ...)
              │          ├──< airline_turn_markets  (fare, fees, peak_*, business/premium_modifier)
              │          │        └──> game_markets ──> markets
              │          │                    ├──> market_demand_curves   (仅外键 id=3)
              │          │                    └──> market_transfer_models(仅外键 id=1)
              │          └──< investments
              └──< players (roles[])

  多态表: images (imageable_id, imageable_type='App\\Market', image_type, location_*)
""")

print('=' * 76)
print('关键结论')
print('=' * 76)
print('  1. airlineturns 是「回合快照」—— 每回合冻结一份机队/航线/投资状态')
print('  2. 市场默认参数 (market) 与玩家设置 (airlineturn_market) 是两层数据')
print('  3. 需求曲线/转移模型只有外键,表内容在服务端,玩家侧不可见')
print('  4. 财务计算全部服务端权威,客户端仅 7 个派生值预演')