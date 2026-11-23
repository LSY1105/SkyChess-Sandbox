---
name: SkyChess 教学沙盘
description: 暗色石墨底 + 金色强调的高密度航空经营控制台——克制的工程感，数据先于装饰
colors:
  primary: "#d8a33f"
  neutral-bg: "#15171a"
  neutral-surface: "#1b1e22"
  neutral-raised: "#212529"
  neutral-line: "#2b3036"
  neutral-hair: "rgba(255,255,255,0.07)"
  text-primary: "#e8eaed"
  text-secondary: "#b6bcc4"
  text-dim: "#8a929c"
  status-ok: "#4c9a5f"
  status-warn: "#c8952e"
  status-bad: "#d97068"
  seat-ca: "#e6a700"
  seat-ab: "#6b8e23"
  seat-va: "#2f6fa8"
  chart-blue: "#1f6feb"
  chart-green: "#2da44e"
  chart-red: "#cf222e"
  chart-purple: "#8957e5"
typography:
  display:
    fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.55
  headline:
    fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "20px"
  button-default:
    backgroundColor: "{colors.neutral-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "32px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#1a1408"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "32px"
  input:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
---

# Design System: SkyChess 教学沙盘

## Overview

**Creative North Star: "The Graphite Ledger"（石墨账本）**

这是一台**账页**，不是一块看板。学生坐在它面前逐项核对：这一季我开了哪条线、每班的旅客是多少、成本落在哪一栏、现金还剩多少——每个数字都要能被追问到出处。暗色石墨底（`#15171a`）是账本的黑，纸面被压到近乎全黑，只留细如发丝的白色分隔（`rgba(255,255,255,.07)`）；金色（`#d8a33f`）不是装饰色，是**唯一被允许发亮的东西**：当前选中、已生效、需要裁决的项。除此之外的界面一律安静——卡片、控件、表格都停在可读即可的亮度上，把注意力让给数字。

因此这个系统的美学是**克制的工程感**：密度优先、可审计优先、装饰为零。表格是主角（`tabular-nums` 等宽数字、右对齐、36px 行高），卡片只是表格的边框（1px 发丝描边 + 12px 圆角 + 极轻投影），页签是索引而不是装饰条。运动只承担一个职责：告诉你系统刚刚变了什么（hover 120ms 过渡、焦点环、进度条），不做表演。

一切视觉判断的最终裁判不是"好看"，而是**与原版 SkyChess 截图是否同构**——报表的六张 KPI 卡、成本分解图、需求图的语义色都按原版截图复刻，连英文标签都保留；本系统**不复刻**原版自身的缺陷（碳排放口径自相矛盾等），这类差异以课堂讨论点明示而非静默复制。

**Key Characteristics:**

- 暗色石墨三层底（页面 / 卡片面 / 控件面）+ 发丝描边分层，几乎不用阴影
- 金色是唯一强调色，稀缺即意义
- 高密度表格 + 等宽数字 + 右对齐金额，密度优先于留白
- 一切数值可追溯：标签、口径说明、证据分级标注随行
- 忠于原版截图的结构与语义，缺陷不复刻但明示

## Colors

暗色石墨上的**单强调色**体系：底色近乎无彩，只有金色与三个状态色允许发声。

### Primary
- **Airlane Amber（航线条琥珀）** (`#d8a33f`): 唯一强调色。用于主按钮底色、选中页签与当前行的边框、KPI 卡片描边、进度条填充、图表中的本方/总量主色。**绝不可**用于大面积填充。

### Neutral
- **Ledger Black（账本黑）** (`#15171a`): 页面底色，一切卡片之下。
- **Page Surface（页面面）** (`#1b1e22`): 卡片与顶栏底色。
- **Control Surface（控件面）** (`#212529`): 输入框、按钮、页签等可交互面。
- **Rule Line（界线）** (`#2b3036`): 输入与按钮的实边框、表头下边框。
- **Hairline（发丝线）** (`rgba(255,255,255,0.07)`): 卡片描边与行分隔——只用于分隔，从不用于装饰。
- **Ink（主字）** (`#e8eaed`): 正文与标题文字。
- **Ink Secondary（次字）** (`#b6bcc4`): 标签、控件文字。
- **Ink Dim（弱字）** (`#8a929c`): 小字说明、表头、轴刻度。

### Status
- **Ledger Green（账本绿）** (`#4c9a5f`): 达标、正向达成。
- **Caution Amber（警示琥珀）** (`#c8952e`): 未达标但未恶化、待留意项。
- **Write-off Red（核销红）** (`#d97068`): 亏损、失败、不可逆状态。
  > 2026-11-18 由 `#c1544c` 提亮：旧值对卡片底仅 **3.7:1**（AA 需 4.5），而「现金 -$2,575,774」这类**最该被读懂的负值**全用它。提亮后对三种底色分别 5.53 / 5.15 / 4.75（均达 AA）。

### Seat（席位三色 · 原版色）
- **CA 黄** (`#e6a700`) · **AB 绿** (`#6b8e23`) · **VA 蓝** (`#2f6fa8`): 贯穿表格色点、甘特图与需求图，是**身份**而非装饰——同一席位在任何图里都是同一色。

### Chart（图表语义色）
- **Series Blue** (`#1f6feb`) 需求/主序列 · **Series Green** (`#2da44e`) 峰时段/达成 · **Series Red** (`#cf222e`) 亏损序列 · **Series Purple** (`#8957e5`) 市场份额序列。需求图另有每市场一色（LEW `#76e3ea`、ARM `#ff7b72`、BZY `#f2cc60`…），仅用于区分曲线身份。

### Named Rules
**The One Voice Rule.** 金色只出现在当前选中、已生效或待裁决的元素上；一屏内不超过三处。任何"因为好看"的配色都要退回石墨。

**The Original Three Seats Rule.** 席位颜色只能用原版三色（黄 / 绿 / 蓝），不得自创第四色；席位色出现在身份位置（色点、图例、系列），不用于状态表达。

**The Fidelity-Cost Rule.** 原版三色与图表红在石墨底上**不达 AA**（AB 绿 4.4:1 / VA 蓝 3.2:1 / 图表红 3.1:1）——这是**已知且刻意保留**的代价（忠于原版截图），不得私自调亮；改为用形状/文字/图例补足识别。**状态色**（`--bad`）不在原版截图之列，可自由调整到 AA。

## Typography

**Display Font / Body Font:** 单一字族 `"Segoe UI", "Microsoft YaHei", system-ui, sans-serif`——没有衬线、没有等宽展示字。数字另用 `font-variant-numeric: tabular-nums` 对齐。

**Character:** 安静、密、可扫读；字重只到 600，不靠粗细制造层级，靠**尺寸与灰阶**分层。

### Hierarchy
- **Display** (600, 15px, 1.55): 顶栏产品名 `SkyChess 沙盘`，页面唯一一级标题。
- **Headline** (600, 13px, 1.4): 卡片标题（`航线与运价` / `报表` / `考核目标`），右侧可挂灰色括号说明。
- **Title** (600, 14px, 1.3): 顶栏指标数值、表格中的关键数字。
- **Body** (400, 14px, 1.55): 正文与表格内容（13px）、表单标签（12px）。
- **Label** (400, 11px, 1.5): 小字说明、图例、轴刻度、页签内提示。

### Named Rules
**The Ledger Number Rule.** 所有金额、比率、座位数、班次都用 `tabular-nums` 右对齐——纵向能直接比大小，是账本而不是图表。

**The Eleven-Pixel Floor Rule.** 11px 只给"补充说明"（口径、证据分级、图例），**永远不能**承载需要学员决策的数字；决策数字至少 13px。

## Layout

两列操作台布局：**左窄（`.92fr`）右宽（`1.08fr`）**，卡片间距统一 16px，页面内边距 `16px 24px 40px`。卡片内表格可横向滚动（`.card{overflow-x:auto}`），单元格不换行——宁可滚动也不裁切、不错行。固定高度滚动区 `.scroll` 上限 320px，让长表在卡片内消化而不撑爆页面。顶栏是粘性条（`position:sticky`），指标成组横排，多余指标收进 `details` 折叠。

响应式策略是**桌面优先、课堂投屏优先**：两列在窄屏会挤压但始终保持表格可读；不做移动端重排（课堂场景为笔记本与投影）。

## Elevation & Depth

**几乎全平面。** 深度由三层底色（页面 `#15171a` → 卡片 `#1b1e22` → 控件 `#212529`）加 1px 发丝描边表达，**不用投影堆叠**。唯一允许的投影是模态弹窗（FLIGHT INFORMATION，`0 8px 30px rgba(0,0,0,.5)`）——它需要切断背景、宣示"这是临时的一层"。卡片带一层**极轻投影**（`0 1px 2px rgba(0,0,0,.38)`）用于把卡片从深底上轻轻托起，属于"分组感"，不构成层级。

### Shadow Vocabulary
- **Card Lift（卡片微托）** (`box-shadow: 0 1px 2px rgba(0,0,0,0.38)`): 所有卡片，仅用于与背景分离。
- **Modal Cast（模态投影）** (`box-shadow: 0 8px 30px rgba(0,0,0,0.5)`): 仅模态弹窗（FLIGHT INFORMATION）。

### Named Rules
**The Flat-By-Default Rule.** 表面在静止时是平的。投影只在两处出现：卡片的一层微托，与模态弹窗的遮罩投影。任何第三种投影都要先回答"它在表达什么状态"。

## Shapes

圆角分三档，边界永远用 1px 线而不是粗边：**卡片 12px**（`--rounded.lg`）、**控件 8px**（输入框、按钮、页签）、**进度条与色点 3–4px**（圆头矩形、圆形色点）。表格本身无圆角、只有 1px 发丝横线；席位色点是直径 7px 的实心圆，出现在表格行首。

## Components

### Buttons
- **Shape:** 8px 圆角，高 32px，内边距 `0 14px`，13px 文字。
- **Default:** 控件面 `#212529` + 实边 `#2b3036`；hover 转 `#2a2f35`。
- **Primary（`.pri`）:** 金色底 + 深墨字 `#1a1408` + 600 字重；hover 转 `#e2b04b`。每屏至多一处。
- **Ghost / Warn（`.warn`）:** 透明底、灰字；hover 转红边红字（用于"危险/撤销"）。
- **Hover / Focus:** 背景/边框/文字 120ms 过渡；`focus-visible` 用 2px 金色描边 + 2px 偏移，键盘可见。

### Inputs / Fields
- **Style:** 页面底 `#15171a` + 1px 实边 `#2b3036`，8px 圆角，高 32px，内边距 `0 10px`。
- **Focus:** 去掉默认 outline，边框转为金色 `#d8a33f`，**并补 2px 金色 outline + 1px 偏移**（11-23：只改 1px 边框的焦点态在投影上几乎看不见）。
- **Type:** 原生控件优先（`type="time"` / `type="number"` / `type="date"`），不用自定义选择器。

### Tables
- **Style:** 全宽、`border-collapse: collapse`、横向分隔线为 1px 发丝线；行高 36px；单元格 13px。
- **Header:** 11px、弱字色 `#8a929c`、`font-weight: 500`、不换行、底部一条实边 `#2b3036`。
- **Alignment:** 首列左对齐，**其余全部右对齐**；金额与比率用 `tabular-nums`。
- **State:** `tr:hover` 铺一层 `rgba(255,255,255,.02)`；席位列前置 7px 圆点色标。
- **Density:** 单元格 `white-space: nowrap`，卡片内横向滚动——宁可滚动不裁切。

### Cards / Containers
- **Corner Style:** 12px 圆角。
- **Background:** 页面面 `#1b1e22`。
- **Shadow Strategy:** Card Lift（极轻投影）+ 1px 发丝描边。
- **Border:** `1px solid rgba(255,255,255,0.07)`。
- **Internal Padding:** 20px；卡片内 `.row` 间距 12px。
- **整宽卡**：`.widecard` 跨两列（`grid-column: 1 / -1`），用于列数多的主表（见「整宽卡」）。

### Tabs
- **Style:** 一排等高按钮（32px），控件面底 + 1px 实边；选中态改用金色边框与金色文字。
- **Behavior:** 页签按钮**只创建一次**，之后仅切换 `.on` 类；轮询更新不得重建页签（否则点击落空）。

### 目录条（吸顶分组导航 · 11-23）

页面高度 5000px、卡片 20+ 张 → 顶层必须有**目录**。但「一排平铺 18 个锚点」在 1280px 屏上会横向溢出、后半截按钮被切掉，学生根本不知道后面还有什么。

**结构：两级**
```
#jumpBar (sticky, flex row)
└ .jb-nav (flex column)
  ├ .jb-groups   分组标签：组名 + 条目数（当前组 = 金色描边 + 金字）
  └ .jb-items    当前组的条目按钮（可换行，不裁切；非当前组 hidden）
```

- **分组来源**：卡片上的 `data-grp` 属性（裁判端 5 组 / 小组端 4 组）；未标注的归「全部」。
- **无障碍**：分组标签 = `role="tablist"` + 每个组 `role="tab"` + `aria-selected`；条目按钮 `aria-current` 标出最近一次跳转。
- **默认组**：DOM 顺序里的第一组；切换组只换下排可见项，**不重建 DOM**（避免轮询打断点击）。
- **吸顶位置**：跟随顶栏实际高度（`header.offsetHeight`），顶栏折行时也不会压住标题。
- **宽度**：条目行 `flex-wrap: wrap` —— 宁可换行，**不横向裁切**（这是旧锚点条的硬伤）。
- **顶栏瘦身**：小组端顶栏曾高 149px（时钟卡以「卡片」塞在 header 里，1280×720 投影占 20%）。现在时钟降级为**内联条**、「报表直达 + 席位切换」搬进目录条右侧 → 顶栏 69px 一行放得下。
- **吸顶跟随**：`top` 取 `header.offsetHeight` 并用 `ResizeObserver` 跟随；**每次调用都要同步**（集合未变直接 return 也会漏同步 → 顶栏变高后目录条钻到顶栏底下）。

### 整宽卡（widecard · 11-23）

表格是主角。列数多到在栏宽里放不下时（小组端「航线与运价」12 列 889px / 「航班排班」11 列 938px / 裁判端「各席位经营状况」11 列 1180px），**给它整宽**（`grid-column: 1 / -1`），而不是让用户横向拖。

- 判定口径：表格自然宽度 > 栏宽 × 1.2 → 提到整宽行，按「学员/裁判每回合必读」的顺序排在最前。
- 整宽卡仍用同一套卡片样式（12px 圆角 + 发丝描边），不搞第二种「大卡」外观。

### 待办角标（11-23）

裁判端有两张「等裁判动手」的卡：**小组提案审批**（待审批）与**谈判流转台**（待受理/还价/驳回）。原来裁判只能**打开卡**才知道有没有待办 —— 空的时候面板只有一句「该组暂无提案」。

- 角标挂在卡片标题里：`.pendBadge`（琥珀色小药丸，`待处理 N` / `待审批 N`）。
- **N > 0 才出现**，N = 0 时不打扰（不占标题空间、不制造噪音）。
- 计数口径与面板里的操作按钮**同口径**：待审批 = 三组 `proposals` 里 `status==='pending'`；待处理 = 申报单处于 `submitted / under_review / countered`（裁判能受理/还价/驳回的三种状态）。
- 计数取**三组合计**（不受当前查看的席位筛选影响）——裁判切换席位时角标不变，才知道别组也在等。

### 动作反馈（就地提示 · 11-23）

`alert()` 是 2018 年的做法：弹窗会挡住页面、必须手动关、关掉之后原因就不在眼前。项目规�� S7 早已写明「关键操作的结果**就地可见**，不要只靠弹窗」，11-23 起两端**全面落地**。

- **触发元素记忆**：全局 capture 阶段监听 click，记录最近点击的控件（`__lastActEl`）。
- **就地写入**：提示写在触发控件**旁边**（同一容器只留一条，可手动 × 关闭）——按钮在表格里就写进单元格，按钮在表单行就写进行内。
- **失败不重绘整页**：重绘会把刚写的提示冲掉 → 失败路径只刷新被拒清单与角标。
- **三档语气**：红=失败、绿=成功、灰=说明（如「最优运价 ≈ $xxx」）。颜色是语义，不是装饰。
- **被拒角标**：小组端顶栏「被拒 N」红色角标（0 时隐藏），点击跳到「上次操作的被拒原因」卡。裁判端在「各席位经营状况」表的「被拒操作」列看同一份数据。

### KPI Cards（报表 · Summary 六卡）
- **Style:** 3 列网格、8px 间距、1px 金色描边、8px 圆角、控件面底；内容居中：内联 SVG 图标（22–26px 金色描边）→ 标签（12px 弱字）→ 数值（20px / 600）。

### Signature Component — 席位色点（Seat Dot）
- **Style:** 7px 实心圆，行首内联，`margin-right: 8px`。
- **Purpose:** 在长表格里用 2px 的墨迹标出"这一行是谁的"，颜色即身份（CA 黄 / AB 绿 / VA 蓝），与甘特图、需求图共用同一套。

### Progress / 计时轨道
- **Style:** 6px 高的圆头轨道，暗轨 `#22262b`，填充为金色 `#d8a33f`；剩余不足 5 分钟时填充转红 `#cf222e`。

## Do's and Don'ts

### Do:
- **Do** 用金色标出"当前 / 已生效 / 待裁决"，并保持一屏不超过三处。
- **Do** 金额与比率右对齐 + `tabular-nums`；缺数据时写 `—`，绝不写 `NaN` / `undefined` / 空白。
- **Do** 在表格单元格里放决策数字（≥13px），把 11px 小字留给口径说明与证据分级。
- **Do** 需要"深一点"的面时换底色层（页面 → 卡片 → 控件），而不是加投影。
- **Do** 报表结构与文案对齐原版截图（含英文标签），差异在旁注说明口径。

### Don't:
- **Don't** 新增第二个强调色，或把金色铺成大面积底色——稀缺是它的全部意义。
- **Don't** 引入新的字体族、新的圆角档位或新的间距档位；本系统只有一套刻度。
- **Don't** 把 11px 用在需要学员做决策的数字上，也不要为了"好看"放大表格字号而牺牲列宽。
- **Don't** 复刻原版自身的缺陷（碳口径矛盾、Strike Price 显示与计费不一致），也不要在界面静默隐藏口径差异。
- **Don't** 在轮询刷新时整块重建 DOM（会替换页签、丢失输入焦点、造成整页闪动）——增量更新 + 数据指纹。
