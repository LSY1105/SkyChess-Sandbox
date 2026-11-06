"""生成 SkyChess 全路由自动抓取场景（已解锁 capture.network.response_body）"""
import json, sys, os

BASE = 'https://www.skychess.com/play/airline/833'
# app.js 中的实际跳转代码：
#   gotoDepartureBoard: window.location="/play/airline/"+id+"/liveboard"   ← 玩家侧
#   gotoDepartureboard: window.open("/play/liveboard/"+game.id)          ← 裁判/全局侧
EXTRA_ROUTES = [
    'https://www.skychess.com/play/airline/833/liveboard',   # 玩家出发板
    'https://www.skychess.com/play/liveboard/285',           # 全局实时看板
]
ROUTES = [
    '', '/scheduler', '/schedules', '/fares', '/fare-matrix',
    '/fleets', '/investments', '/catalogue/investments',
    '/catalogue/assets', '/reports',
]


def build(tid, cdp='http://127.0.0.1:9222', wait_ms=3000, screenshot=False):
    """screenshot=True 需要浏览器窗口处于可见/前台状态，
    否则 Page.captureScreenshot 会超时并导致整个场景失败。
    默认关闭。"""
    acts = []
    i = 1
    for r in ROUTES + EXTRA_ROUTES:
        url = r if r.startswith('http') else BASE + r
        acts.append({
            'action': 'goto',
            'step_id': f'nav{i}',
            'destination': {'url': url},
            'wait_until': 'load',
        })
        i += 1
        acts.append({
            'action': 'wait_for_timeout',
            'step_id': f'wait{i}',
            'duration_ms': wait_ms,
        })
        i += 1

    after = ['dom', 'accessibility', 'url']
    if screenshot:
        after.append('screenshot')

    return {
        'browser': {'mode': 'connect', 'cdp_endpoint': cdp, 'target_id': tid},
        'start_url': {'url': BASE},
        'capture': {
            'after_each_step': after,
            'at_end': ['url', 'dom', 'accessibility'],
            'events': ['network', 'console', 'page-errors', 'websockets'],
            'network': {
                'request_body': True,
                'response_body': True,
                'header_values': False,
            },
            # 提高配额：默认 16MB 总事件配额会导致 ~240 条数据路径被丢弃
            # （fare-matrix 等大响应体被 max-total-event-allocation-bytes 截断）
            'limits': {
                'max_events': 50000,
                'max_event_allocation_bytes': 8 * 1024 * 1024,
                'max_total_event_allocation_bytes': 128 * 1024 * 1024,
                'max_network_transactions': 8192,
                'max_network_body_bytes': 8 * 1024 * 1024,
                'max_network_body_allocation_bytes': 32 * 1024 * 1024,
                'max_network_header_allocation_bytes': 4 * 1024 * 1024,
                'max_network_metadata_allocation_bytes': 8 * 1024 * 1024,
            },
        },
        'actions': acts,
    }


if __name__ == '__main__':
    tid = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'scenario-capture.json'
    wait = int(sys.argv[3]) if len(sys.argv) > 3 else 3000
    shot = os.environ.get('REA_SCREENSHOT') == '1'
    sc = build(tid, wait_ms=wait, screenshot=shot)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(sc, f, ensure_ascii=False, indent=1)
    print(f'已生成 {out}: {len(sc["actions"])} 个动作, '
          f'{len(ROUTES) + len(EXTRA_ROUTES)} 条路由, screenshot={shot}')