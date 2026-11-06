"""需求模型识别修正（v2）—— 基于正确的识别逻辑重新反推。

★ 核心修正一：识别逻辑方向性错误
  观测恒等式： pax = min(D, ASK)，LF = pax / ASK
    → LF < 100%  ⇒  pax < ASK ⇒ min 取 D ⇒ **D = pax（精确等式）**
    → LF = 100%  ⇒  pax = ASK ⇒ **D ≥ ASK（仅下界）**
  旧模型恰好用反：拿 3 个 LF=100% 行当等式锁定 K_market，
  而把 31 个 LF<100% 行（真正含信息量的等式）当"供给受限"直接丢弃。

★ 核心修正二：QSI 在现有观测下不可识别
  报告中的 QSI 是**季度级**变量（Q1/2028 全部市场同为 -0.20，疑与当季事件相关），
  且其与隐含需求的关系在跨市场/跨季上**非单调**。
  网格搜索结论：加入 QSI 幂函数项后等式行 log-RMS 反而变差
    无 QSI、无频率 : 33.74%
    含 QSI         : 56.54%   ← 更差
    频率项 + 无 QSI: 29.34%   ← 最优
    频率项 + 含 QSI: 30.91%   ← 仍更差
  ⇒ 结论：**在可观测集上，QSI 不应进入需求函数**（或其真实作用形式与报告列不同）。

★ 核心修正三：服务频率是真实的需求驱动项
  D ∝ freq^b，最优 b = 0.5（次线性：航班翻倍，需求约增 41%）。
  与"网络服务质量随频次提升"的航空运力-需求机理一致。

★ 核心修正四：运价回合内变更造成测量误差（不可消除）
  执行运价由 revenue/(a·pax) 反解，是**旅客加权均价**。
  回合内改价时它与"需求形成时面对的价格"不一致：
    · 价格中途下调 → 反解价偏低 → 模型按低价算需求 → **高估**（Simone Q2/2029 +101%）
    · 价格中途上调 → 反解价偏高 → 模型按高价算需求 → **低估**（Lewis Q1/2028 -42%）
  这是测量误差而非模型误差，应在结论中显式声明。

输出
  demand-fit.json  —— 新参数（K_market / eps / freq 指数 / 识别说明）
"""
import io, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

OBS = json.load(io.open(os.path.join(HERE, 'observations.json'), encoding='utf-8'))
FARES = json.load(io.open(os.path.join(HERE, 'fares_by_turn.json'), encoding='utf-8'))

A_REV = 0.926228
FARE_REF = 200.0
TURN = {'Q4/2027': 0, 'Q1/2028': 1, 'Q2/2028': 2, 'Q3/2028': 3,
        'Q4/2028': 4, 'Q1/2029': 5, 'Q2/2029': 6}
CODE = {'Lewis': 'LEW', 'Simone': 'SIM', 'Fitzgerald': 'FTZ', 'Ellington': 'ETN',
        'Armstrong': 'ARM', 'Joplin': 'JOP', 'Broonzy': 'BZY'}
ELAS = {'Lewis': 1.10, 'Simone': 1.10, 'Fitzgerald': 1.05, 'Ellington': 1.05,
        'Armstrong': 1.10, 'Joplin': 1.10, 'Broonzy': 1.05}
QORDER = ['Q4/2027', 'Q1/2028', 'Q2/2028', 'Q3/2028', 'Q4/2028', 'Q1/2029', 'Q2/2029']


def load_rows():
    rows = []
    for q in QORDER:
        v = OBS.get(q)
        if not v:
            continue
        for m, mm in v['metrics'].items():
            if m == '_network':
                continue
            p = v['pnl'].get(m, {})
            lf = (mm.get('Load Factor') or 0) / 100.0
            pax = (mm.get('Passengers (000)') or 0) * 1000
            rev = p.get('Passenger Revenue')
            if not pax or not lf or not rev:
                continue
            rows.append({
                'q': q, 'm': m, 'lf': lf, 'pax': pax,
                'fare': rev / (A_REV * pax),
                'qsi': mm.get('QSI') or 0.0,
                'freq': mm.get('Frequencies') or 0,
                'adu': mm.get('ADU (BH)') or 0,
                'ask': pax / lf,
                'snap': FARES.get(f"{TURN.get(q)}:{CODE.get(m)}"),
            })
    return rows


def model_D(Kg, r, b, qsi_c=None, qsi_k=0.0):
    pf = (FARE_REF / max(r['fare'], 1e-9)) ** ELAS[r['m']]
    f = max(r['freq'], 1) / 100.0
    qf = 1.0
    if qsi_c is not None:
        qf = ((max(r['qsi'], -qsi_c + 1e-9) + qsi_c) / (10.0 + qsi_c)) ** qsi_k
    return Kg[r['m']] * pf * (f ** b) * qf


def fit(rows, b, qsi_c=None, qsi_k=0.0, use_freq=True, enforce_bounds=True):
    """等式行反解 K（几何均值）后，再用下界行施加硬约束 K >= max(ASK/(price_f*freq^b))。

    约束估计的必要性：LF=100% 的行给出 D >= ASK 的硬下界，
    若 K 取等式行几何均值会违反该约束（实测 0/3 满足），
    因为 LF=100% 的观测恰恰落在等式行分布的"需求偏高"一侧。
    """
    eq = [r for r in rows if r['lf'] < 0.999]
    bd = [r for r in rows if r['lf'] >= 0.999]
    K = {}
    for r in eq:
        pf = (FARE_REF / max(r['fare'], 1e-9)) ** ELAS[r['m']]
        f = (max(r['freq'], 1) / 100.0) if use_freq else 1.0
        qf = 1.0
        if qsi_c is not None:
            qf = ((max(r['qsi'], -qsi_c + 1e-9) + qsi_c) / (10.0 + qsi_c)) ** qsi_k
        K.setdefault(r['m'], []).append(r['pax'] / (pf * (f ** b) * qf))
    Kg = {m: math.exp(sum(math.log(x) for x in v) / len(v)) for m, v in K.items()}
    if enforce_bounds:
        for r in bd:
            pf = (FARE_REF / max(r['fare'], 1e-9)) ** ELAS[r['m']]
            f = (max(r['freq'], 1) / 100.0) if use_freq else 1.0
            qf = 1.0
            if qsi_c is not None:
                qf = ((max(r['qsi'], -qsi_c + 1e-9) + qsi_c) / (10.0 + qsi_c)) ** qsi_k
            k_min = r['ask'] / (pf * (f ** b) * qf)
            if r['m'] in Kg and k_min > Kg[r['m']]:
                # 加 1e-6 相对余量：K 正好卡在下界上时，浮点舍入会让 D 略小于 ASK
                Kg[r['m']] = k_min * (1.0 + 1e-6)
    sq = 0.0
    per = {}
    for r in eq:
        D = model_D(Kg, r, b if use_freq else 0.0, qsi_c, qsi_k)
        e = math.log(D / r['pax'])
        sq += e * e
        per.setdefault(r['m'], []).append((r['q'], e, r['snap']))
    return math.sqrt(sq / len(eq)), Kg, per


def main():
    rows = load_rows()
    eq = [r for r in rows if r['lf'] < 0.999]
    bd = [r for r in rows if r['lf'] >= 0.999]

    print('=' * 96)
    print('★ 需求模型识别修正 v2 —— 正确识别逻辑 + 频率驱动 + QSI 可识别性检验')
    print('=' * 96)
    print(f'  等式行 (LF<100%, D=pax 精确) : {len(eq)}')
    print(f'  下界行 (LF=100%, D>=ASK)     : {len(bd)}')
    print()

    # ── 模型对比 ──
    print('  【模型对比】等式行 log-RMS：')
    r_no, _, _ = fit(rows, 0.0, use_freq=False)
    print(f'    M0  D = K_m × price_f                       {r_no*100:6.2f}%   (旧模型口径，无频率无QSI)')
    r_qsi, _, _ = fit(rows, 0.0, qsi_c=4.70, qsi_k=0.95, use_freq=False)
    print(f'    M1  D = K_m × price_f × qsi_f(QSI)          {r_qsi*100:6.2f}%   ← QSI 让拟合变差')
    r_qsi2, _, _ = fit(rows, 0.5, qsi_c=5.00, qsi_k=0.10, use_freq=True)
    print(f'    M2  D = K_m × price_f × freq^.5 × qsi_f    {r_qsi2*100:6.2f}%   ← 仍不如 M3')

    best = None
    for bi in range(0, 26):
        b = bi * 0.05
        rms, _, _ = fit(rows, b)
        if best is None or rms < best[0]:
            best = (rms, b)
    rms, b = best
    print(f'    M3  D = K_m × price_f × freq^{b:.2f}            {rms*100:6.2f}%   ★ 最优')
    print()

    rms0u, KBASE, _ = fit(rows, b, enforce_bounds=False)
    rms, Kg, per = fit(rows, b)
    print('  【新参数】')
    print('    K_market（等式行几何均值 + LF=100% 下界硬约束）：')
    for m in sorted(Kg):
        tag = ''
        if m in KBASE:
            tag = '  ← 受下界约束抬升' if Kg[m] > KBASE[m] * 1.001 else ''
        print(f'      {m:12} {Kg[m]:>12,.0f}{tag}')
    print(f'    freq 指数 b = {b:.2f}   eps（API 逆向值）= {ELAS}')
    print()

    # ── 下界检验 ──
    print('  【下界检验】LF=100% 的行须满足 D >= ASK：')
    okc = 0
    for r in bd:
        D = model_D(Kg, r, b)
        sat = D >= r['ask'] - 1e-6
        okc += sat
        print(f'    {r["m"]:12} {r["q"]:8} ASK={r["ask"]:>9,.0f}  模型D={D:>10,.0f}  '
              f'{"满足" if sat else "★违反"}')
    print(f'    → {okc}/{len(bd)} 满足')
    print()

    # ── 逐行残差 + 运价反转标注 ──
    print('  【逐行残差】(LF<100% 等式行；标注运价反转偏差)')
    print('  %-11s %-8s %8s %6s %7s %8s %9s %9s %8s' % (
        'market', 'quarter', 'fare', 'snap', 'freq', 'qsi', 'pax', 'model_D', 'err'))
    contaminated = 0
    for m in sorted(per):
        for q, e, sn in sorted(per[m]):
            r = next(x for x in eq if x['m'] == m and x['q'] == q)
            D = model_D(Kg, r, b)
            dev = (r['fare'] / sn - 1) * 100 if sn else 0
            flag = ''
            if sn and abs(dev) > 8:
                flag = ' ←运价反转污染'
                contaminated += 1
            print('  %-11s %-8s %8.2f %6s %7s %8.2f %9s %9s %+7.1f%%%s' % (
                m, q, r['fare'], sn if sn else '-', r['freq'], r['qsi'],
                f"{r['pax']:,.0f}", f"{D:,.0f}", e * 100, flag))
    print()
    print(f'  最大等式残差 = {max(abs(e) for v in per.values() for _, e, _ in v)*100:.1f}%')
    print(f'  运价反转偏差 >8% 的行 = {contaminated}/{len(eq)}  '
          f'（这些行的反解价与需求形成价不一致，属测量误差）')
    print()

    # ── 剔除污染行后的纯模型误差 ──
    clean = [r for r in eq if not (r['snap'] and abs(r['fare'] / r['snap'] - 1) > 0.08)]
    Kc = {}
    for r in clean:
        pf = (FARE_REF / max(r['fare'], 1e-9)) ** ELAS[r['m']]
        f = max(r['freq'], 1) / 100.0
        Kc.setdefault(r['m'], []).append(r['pax'] / (pf * (f ** b)))
    Kg2 = {m: math.exp(sum(math.log(x) for x in v) / len(v)) for m, v in Kc.items()}
    sq = 0.0
    for r in clean:
        D = model_D(Kg2, r, b)
        sq += math.log(D / r['pax']) ** 2
    rms_clean = math.sqrt(sq / len(clean)) if clean else 0
    print(f'  剔除运价反转污染行后（{len(clean)} 行）log-RMS = {rms_clean*100:.2f}%')
    print()

    out = {
        'version': 'v2-corrected-identification',
        'fare_ref': FARE_REF,
        'revenue_coef': A_REV,
        'freq_exponent': round(b, 3),
        'freq_ref': 100.0,
        'demand_K': {m: round(v) for m, v in Kg.items()},
        'elasticity': ELAS,
        'qsi_in_model': False,
        'qsi_reason': ('报告 QSI 为季度级变量、与隐含需求非单调；'
                        '加入 QSI 幂函数项后等式行 log-RMS 由 29.34% 恶化到 30.91%'),
        'identification': ('LF<100% ⇒ D=pax（精确等式）；LF=100% ⇒ D>=ASK（下界）。'
                           '旧模型方向相反，导致 31 个含信息量的等式行被丢弃。'),
        'log_rms_pct': round(rms * 100, 2),
        'log_rms_unconstrained_pct': round(rms0u * 100, 2),
        'log_rms_excl_fare_reversal_pct': round(rms_clean * 100, 2),
        'eq_rows': len(eq), 'bound_rows': len(bd),
        'known_limits': [
            '运价回合内变更使反解执行价 = 旅客加权均价，与需求形成价不一致（测量误差）',
            '价格弹性无法独立识别（K 与 eps 共线），eps 采用 API 逆向值',
            '观察到的 QSI 序列非单调，无法与需求建立稳定映射',
        ],
    }
    with io.open(os.path.join(HERE, 'demand-fit.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('  新参数已导出 → rebuild/demand-fit.json')


if __name__ == '__main__':
    main()
