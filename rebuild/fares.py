import json, glob, os

INTEL = {'LEW': 'Lewis', 'SIM': 'Simone', 'FTZ': 'Fitzgerald', 'ETN': 'Ellington',
         'PKR': 'Parker', 'ARM': 'Armstrong', 'JOP': 'Joplin', 'CHA': 'Charles City',
         'BZY': 'Broonzy', 'GEE': 'McGee'}
GUIDE = {'LEW': 110, 'ARM': 650, 'JOP': 170, 'CHA': 220, 'BZY': 700, 'GEE': 825}
QN = {'Q1/2028': 1, 'Q2/2028': 2, 'Q3/2028': 3}

os.chdir(os.path.dirname(os.path.abspath(__file__)))

latest = sorted(glob.glob('../state-watch-*.json'), key=os.path.getmtime)[-1]
FILES = {'Q1/2028': '../state-turn1.json',
         'Q2/2028': '../state-turn2.json',
         'Q3/2028': latest}

hist = {}
for q, path in FILES.items():
    snap = json.load(open(path, encoding='utf-8'))['snapshots']
    airline = snap['/play/api/airline/833']['payload']['airline']
    hist[q] = {}
    for t in airline.get('turns', []):
        tno = t.get("turn") if not isinstance(t.get("turn"), dict) else t.get("turn", {}).get("turn")
        for m in (t.get('markets') or []):
            gm = (m.get('gamemarket') or {}).get('market') or {}
            code = gm.get('code')
            if code and tno is not None:
                hist[q]['%d:%s' % (tno, code)] = m.get('fare')

qs = list(FILES)
codes = sorted({k.split(':')[1] for q in hist for k in hist[q]})

print('=' * 82)
print('各季度玩家运价 (API 权威) + 情报报告指导价对照')
print('=' * 82)
print('%-6s' % '市场' + ''.join('%12s' % q for q in qs) + '   指导价')
for c in codes:
    line = '%-6s' % c
    for q in qs:
        v = hist[q].get('%d:%s' % (QN[q], c))
        try:
            line += '%12s' % (('%.0f' % float(v)) if v is not None else '-')
        except (TypeError, ValueError):
            line += '%12s' % '-'
    g = GUIDE.get(c)
    line += '   %6s   %s' % (('%.0f' % g) if g else '-', INTEL.get(c, c))
    print(line)

json.dump(hist, open('fare-history.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('\n已保存 fare-history.json')