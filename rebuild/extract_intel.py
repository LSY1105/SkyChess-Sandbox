"""从游戏内情报 PDF 原文提取各市场情报条目（付费情报的可解锁内容）。

★ 为什么做这个
  逆向结论：**关键参数本身不下发** ——
    · 需求曲线表（market_demand_curve_id 1/2/3）与转移模型（id=1）从不出现在玩家 API
    · gdp_demand 在三个市场恒为 1.50（默认值），而情报报告给的是 1.3/1.4/1.5
    · API 字段不可直接信任
  ⇒ 情报报告是**付费道具**，沙盘必须实现"未购买 → 参数不可见"的机制。

★ 本脚本产出
  每个市场：gdp_demand（GDP弹性系数）、pop_elasticity、gdp_growth、
            季节性描述、日潜在运量、货运需求与收益、指导价、情报原文摘录
  —— 这些正是付费情报应当解锁的内容。
"""
import io, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
PDF = os.path.join(REPO, 'pdfs', 'SkyChess_Market_Intelligence_Report_gene.txt')

# 市场英文名 → 中文名/关键词（PDF 用中文城市名）
MARKET_KEYS = {
    'Lewis':       ['路易斯'],
    'Simone':      ['西蒙尼'],
    'Fitzgerald':  ['菲兹杰拉德'],
    'Ellington':   ['艾灵顿'],
    'Armstrong':   ['阿姆斯特朗'],
    'Broonzy':     ['布鲁'],
    'Joplin':      ['鱼类加工厂'],   # 情报报告中该市场以产业特征描述
    'Parker':      ['帕克'],
    'McGee':       ['麦基'],
    'Charles City':['查尔斯'],
}


def main():
    raw = io.open(PDF, encoding='utf-8', errors='replace').read()
    # 按页切分，保留段落
    pages = re.split(r'--- p\d+ ---', raw)
    lines = []
    for pg in pages:
        for l in pg.split('\n'):
            l = l.strip()
            if l:
                lines.append(l)

    # 标题行 = 同时含英文市场名与中文名的行；按标题切段，避免串位
    heads = []
    for i, l in enumerate(lines):
        for name in MARKET_KEYS:
            if name in l and any(k in l for k in MARKET_KEYS[name]):
                heads.append((i, name)); break
    heads.sort()

    out = {}
    for h, (hi_idx, name) in enumerate(heads):
        lo = hi_idx
        hi = heads[h + 1][0] if h + 1 < len(heads) else min(len(lines), hi_idx + 60)
        seg = lines[lo:hi]
        txt = ' '.join(seg)
        e = {'name': name}

        def grab(pat, cast=float):
            m = re.search(pat, txt)
            if not m:
                return None
            try:
                return cast(m.group(1))
            except Exception:
                return None

        e['gdp_growth_pct_q'] = grab(r'GDP\s*增长\s*([\d.]+)%')
        e['pop_elasticity'] = grab(r'人口弹性系数\s*([\d.]+)')
        e['gdp_elasticity'] = grab(r'GDP\s*弹性系数\s*([\d.]+)')
        e['daily_pax_low'] = grab(r'每日单程潜在运量为?\s*([\d]+)')
        e['daily_pax_high'] = grab(r'每日单程潜在运量为?\s*\d+\s*至\s*([\d]+)')
        e['cargo_tonnes_day'] = grab(r'货物需求[^。]{0,12}?每天(?:大概)?只有?\s*([\d.]+)\s*吨')
        e['cargo_yield_per_tkm'] = grab(r'货物收益[^。]{0,20}?每吨公里\s*([\d.]+)')
        e['guide_fare'] = grab(r'单程机票指导价格[^。]{0,8}?([\d]+)\s*美元')
        # 季节性
        m = re.search(r'([^。]{0,40}季节[^。]{0,60}。)', txt)
        e['seasonal_note'] = m.group(1).strip() if m else None
        # 摘录
        e['excerpt'] = txt[:400]
        out[name] = e

    print('=' * 92)
    print('★ 情报 PDF 提取结果（付费情报的可解锁内容）')
    print('=' * 92)
    print('  %-13s %8s %8s %9s %9s %8s %7s' % (
        'market', 'gdpDem', 'popEl', 'gdpGrowth', 'dailyPax', 'cargo/d', 'guide'))
    for name in MARKET_KEYS:
        if name not in out:
            print(f'  {name:13} (未定位)')
            continue
        e = out[name]
        dp = (f"{e['daily_pax_low']}-{e['daily_pax_high']}"
              if e.get('daily_pax_low') and e.get('daily_pax_high')
              else (str(e.get('daily_pax_low')) if e.get('daily_pax_low') else '-'))
        print('  %-13s %8s %8s %9s %9s %8s %7s' % (
            name, e.get('gdp_elasticity'), e.get('pop_elasticity'),
            e.get('gdp_growth_pct_q'), dp, e.get('cargo_tonnes_day'), e.get('guide_fare')))
    print()

    got = len(out)
    print(f'  提取到 {got}/{len(MARKET_KEYS)} 个市场')
    withg = [n for n, e in out.items() if e.get('gdp_elasticity')]
    print(f'  其中拿到 GDP弹性系数（= gdp_demand 情报值）的 {len(withg)} 个：'
          + ', '.join(f"{n}={out[n]['gdp_elasticity']}" for n in withg))
    print('  ★ 对照：玩家 API 的 gdp_demand 恒为 1.50（默认值）—— 买情报才能拿到真值')
    print()

    outp = os.path.join(HERE, 'market-intel-extracted.json')
    with io.open(outp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('  → rebuild/market-intel-extracted.json')


if __name__ == '__main__':
    main()
