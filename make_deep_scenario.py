"""深度采集场景生成器 —— 点开每个页面的每个 tab/子菜单。

覆盖:
  · 9 个报表 tab (Summary/Economics/Fuel/Route Metrics/Investments/
                    Flights/Route Demand/Network Economics/Route Economics)
  · Scheduler 4 个 tab (Flight List/Scheduler/Select Aircraft/Select Route)
  · Investment 3 个 tab (Airline/Fleet/Route Investments)
  · Fare Manager / Fare Matrix / Fleet Plans / 两个 Catalogue
  · 出发板 (玩家侧 + 全局侧)
  · 裁判消息列表 + 逐条展开

用法:
  python make_deep_scenario.py <target_id> <输出文件> [每步等待ms]
"""
import json, sys

BASE = 'https://www.skychess.com/play/airline/833'

LIMITS = {
    'max_events': 50000,
    'max_event_allocation_bytes': 64 * 1024 * 1024,
    'max_total_event_allocation_bytes': 1024 * 1024 * 1024,
    'max_network_transactions': 16384,
    'max_network_body_bytes': 128 * 1024 * 1024,
    'max_network_body_allocation_bytes': 512 * 1024 * 1024,
    'max_network_header_allocation_bytes': 16 * 1024 * 1024,
    'max_network_metadata_allocation_bytes': 32 * 1024 * 1024,
}

# ── 各页面的 tab 定义 ────────────────────────────────────────────
PAGES = [
    ('reports', BASE + '/reports', [
        'Summary', 'Economics', 'Fuel', 'Route Metrics', 'Investments',
        'Flights', 'Route Demand', 'Network Economics', 'Route Economics',
    ]),
    ('scheduler', BASE + '/scheduler', [
        'Flight List', 'Scheduler', 'Select Aircraft', 'Select Route',
    ]),
    ('investments', BASE + '/investments', [
        'Airline Investments', 'Fleet Investments', 'Route Investments',
    ]),
    ('fares', BASE + '/fares', []),
    ('fare-matrix', BASE + '/fare-matrix', []),
    ('fleets', BASE + '/fleets', []),
    ('cat-investments', BASE + '/catalogue/investments', []),
    ('cat-assets', BASE + '/catalogue/assets', []),
    ('dashboard', BASE, []),
    # 出发板
    ('liveboard-player', BASE + '/liveboard', []),
    ('liveboard-global', 'https://www.skychess.com/play/liveboard/285', []),
]


def build(tid, wait_ms=2200):
    acts, i = [], 1

    def step(action, **kw):
        nonlocal i
        a = {'action': action, 'step_id': f's{i:03d}'}
        a.update(kw)
        acts.append(a)
        i += 1

    for name, url, tabs in PAGES:
        step('goto', destination={'url': url}, wait_until='load')
        step('wait_for_timeout', duration_ms=wait_ms)
        for n, tab in enumerate(tabs, 1):
            step('click', locator={'kind': 'role', 'role': 'tab', 'name': tab})
            step('wait_for_timeout', duration_ms=wait_ms)

    # 裁判消息：打开列表并逐条展开
    step('goto', destination={'url': BASE}, wait_until='load')
    step('wait_for_timeout', duration_ms=wait_ms)
    step('click', locator={'kind': 'role', 'role': 'button', 'name': 'Read Messages'})
    step('wait_for_timeout', duration_ms=wait_ms + 800)
    for k in ('Q3/2028', 'Q2/2028'):
        step('click', locator={'kind': 'css',
                              'selector': f'button[aria-label*="{k}"] >> nth=0'})
        step('wait_for_timeout', duration_ms=wait_ms)

    return {
        'browser': {'mode': 'connect', 'cdp_endpoint': 'http://127.0.0.1:9222',
                    'target_id': tid},
        'start_url': {'url': BASE},
        'capture': {
            'after_each_step': ['accessibility', 'dom', 'url'],
            'at_end': ['url'],
            'events': ['network', 'console', 'page-errors', 'websockets'],
            'network': {'request_body': True, 'response_body': True,
                        'header_values': False},
            'limits': LIMITS,
        },
        'actions': acts,
    }


if __name__ == '__main__':
    tid = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'scenario-deep.json'
    wait = int(sys.argv[3]) if len(sys.argv) > 3 else 2200
    sc = build(tid, wait)
    json.dump(sc, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    tabs = sum(len(p[2]) for p in PAGES)
    print(f'深度场景: {len(sc["actions"])} 动作 / {len(PAGES)} 页面 / {tabs} 个 tab')