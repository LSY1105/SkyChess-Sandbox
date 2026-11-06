import re, glob

path = glob.glob('web-scripts/files/origins/*/js/app.js')[0]
src = open(path, encoding='utf-8', errors='replace').read()

# SkyChess 专有字段（来自领域字段统计），vendor 不会用这些
FIELDS = [
    'lease_rate', 'lease_rate_bh', 'lease_type', 'residual_value', 'depreciation_years',
    'annual_depreciation', 'total_depreciation', 'years_depreciated', 'salb_lease_rate',
    'salb_leased_to_turn', 'salb_lease_type', 'minimum_bh', 'max_bh', 'flight_crew_max_bh',
    'seats_standard', 'seats_business', 'seats_premium', 'cargo_capacity',
    'maximum_cargo_payload', 'structural_payload', 'fuel_burn', 'fuel_price', 'fuel_density',
    'landing_fee', 'handling_fee', 'traffic_handling_fee', 'cargo_handling_fee',
    'joining_fee', 'carbon_price', 'strike_price', 'uplift', 'interest_rate',
    'effective_funding_rate', 'sector_length', 'connecting_demand', 'peak_pricing',
    'peak_revenue', 'average_load_factor', 'market_cargo_demand', 'market_cargo_yield',
    'cost_pax', 'cost_ac', 'business_cost_pax', 'premium_cost_pax', 'cost_annual',
    'total_price', 'sell_price', 'sh_turnaround', 'lh_turnaround', 'bypass_slot_check',
    'interpolate_range', 'average_load', 'total_departures', 'departures_per_board',
]
VENDOR = re.compile(r'(navigator|document\.|window\.|getElementById|classList|'
                    r'Bootstrap|Popper|scrollTop|offsetWidth|viewport|'
                    r'JSON\.stringify|Array\.isArray|getComputedStyle)', re.I)

print('=' * 78)
print('SkyChess 应用层计算语句（含专有领域字段 + 算术，排除 vendor）')
print('=' * 78)

results = {}
for f in FIELDS:
    for m in re.finditer(re.escape(f), src):
        s0 = m.start()
        # 取所在语句
        left = max(0, src.rfind(';', 0, s0) + 1)
        right = src.find(';', s0)
        if right == -1:
            right = min(len(src), s0 + 400)
        stmt = src[left:right].strip()
        if len(stmt) < 25 or len(stmt) > 460:
            continue
        if VENDOR.search(stmt):
            continue
        if not re.search(r'[*/%]|\+\s*[A-Za-z_$(0-9"]|-[A-Za-z_$(0-9"]|Math\.|toFixed', stmt):
            continue
        key = re.sub(r'\b[a-zA-Z_$][\w$]{2,}\b', 'X', stmt)[:80]
        results.setdefault(key, (f, stmt))

print(f'命中 {len(results)} 条去重后的计算语句\n')
for i, (k, (f, stmt)) in enumerate(list(results.items())[:45], 1):
    print(f'[{i:2}] ({f})')
    print(f'     {stmt[:330]}')
    print()