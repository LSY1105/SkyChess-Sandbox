"""从 capture-*.json 导出每一步的无障碍树到 a11y/<label>/ 目录。"""
import json, os, sys, base64

CAP = sys.argv[1] if len(sys.argv) > 1 else 'capture-full.json'
LABEL = sys.argv[2] if len(sys.argv) > 2 else 'run'
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'a11y', LABEL)

lines = [l for l in open(CAP, encoding='utf-8')
         if l.strip() and not l.startswith('{"rea_progress"')]
if not lines:
    print('无结果'); sys.exit(1)
d = json.loads(lines[-1])
if 'normalized_result' not in d:
    print('捕获失败:', d.get('code')); sys.exit(1)

n = d['normalized_result']
os.makedirs(OUT, exist_ok=True)

# 建立 step_index -> 目标 URL
url_by_step = {}
for e in n['events']['items']:
    if e.get('kind') == 'response':
        u = (e.get('url') or {}).get('url', '')
        if 'skychess.com/play' in u and e.get('resource_type') == 'document':
            url_by_step[e['step_index']] = u

count = 0
for i, s in enumerate(n['steps']):
    a = (s.get('artifacts') or {}).get('accessibility') or {}
    v = a.get('value') or {}
    text = v.get('text') if isinstance(v, dict) else None
    if not text:
        continue
    tgt = url_by_step.get(s['step_index'], '')
    short = tgt.replace('https://www.skychess.com/play/airline/833', '').rstrip('/') \
               or '(dashboard)'
    short = short.replace('/', '_')
    fn = os.path.join(OUT, f'step-{i:02d}-{s["step_id"]}-{short}.yaml')
    open(fn, 'w', encoding='utf-8').write(text)
    count += 1

print(f'已导出 {count} 份无障碍树 -> a11y/{LABEL}/')
for f in sorted(os.listdir(OUT))[:14]:
    print('   ', f)