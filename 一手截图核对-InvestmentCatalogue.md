# 一手截图核对 —— Investment Catalogue（VIEW INVESTMENTS）

## 一手依据
```
主截图/Investment Catalogue(VIEW INVESTMENTS).jpg（原图 2628×27314 长图）
裁切件：unslop/inv_cat/seg1..seg6.png（每段 900px 宽，可逐段读）
```

## 一、原版投资项卡片结构（seg1 一手读出）
```
┌ 照片 ────────────┬ 标题（大写） ──────────────────────┬ 价格区 ────────┐
│                 │ 说明段 1：这是什么                  │ Upfront cost   │
│                 │ 说明段 2：成本构成                  │ Annual cost    │
│                 │ PASSENGER COSTS & REVENUES 表      │                │
│                 │   列：Economy │ Premium Economy │ Business        │
│                 │   行：Cost per passenger / Revenue per passenger │
```
→ 关键结构 = **Upfront（一次性）+ Annual（年度）+ 按舱位分列的每客成本/收益**

## 二、沙盘结构对照 ✓ 完全一致
| 原版字段 | 沙盘字段 |
|---|---|
| Upfront cost | `upfront` |
| Annual cost | `annual` |
| Cost per passenger（E/PE/B） | `cabin:{E:{c,r}, PE:{c,r}, B:{c,r}}` + `costPerPax`/`revenuePerPax` |
| （效果） | `effect:{qsi}` |
→ 沙盘字段与原版卡片三段式**逐项对应** ✓

## 三、seg1 段（1–5 项）数值逐一核对 ✓
| # | 原版标题 | 原版 Upfront / Annual | 原版 per-pax（收益） | 沙盘项 | 沙盘 desc | 判定 |
|---|---|---|---|---|---|---|
| 1 | ADVERTISING (AGENTS, WEBSITE) | $0 / $150,000 | 全 $0 | adv_web | Upfront $0 / Annual $150,000 | ✓ |
| 2 | ADVERTISING (BILLBOARDS) | $0 / $250,000 | 全 $0 | adv_bill | Upfront $0 / Annual $250,000 | ✓ |
| 3 | ADVERTISING (PRINT) | $0 / $650,000 | 全 $0 | adv_print | Upfront $0 / Annual $650,000 | ✓ |
| 4 | ADVERTISING (SOCIAL MEDIA) | $0 / $350,000 | E $2.00 / PE $0 / B $2.00 | adv_social | Upfront $0 / Annual $350,000 | ✓ |
| 5 | ADVERTISING (TV AND CINEMA) | $0 / $500,000 | （续段） | adv_tv | Upfront $0 / Annual $500,000 | ✓ |

## 四、待核对（剩余 27 项）
```
seg2–seg6 已裁切就绪（unslop/inv_cat/seg2..seg6.png），下轮逐段读并核对：
  第 6–11 项（OTA / 代理人 / 客舱升级 ×4 / 电子报）
  第 12–17 项（额外行李 / 机上赠品 / 机上娱乐 ×2 / 机上网络 ×2）
  第 18–23 项（休息室 ×4 / 常旅客 / 超重行李）
  第 24–29 项（优先选座 / 优先登机 / 自助值机 / 在线订座 / 配餐 ×3）
  第 30–33 项（机上餐饮销售 ×2 / 差异化座位 / 在线订座相关）
```
### 待裁图中确认的疑点（缩略图初步印象，未逐项核对）
```
⚠ 原版第 30 项左右似有「WEIGHTED SEATING」（差异化/加权座位）
   → 沙盘 32 项中**没有**对应项 → 待 seg5/seg6 确认
⚠ 沙盘的 ota（在线旅行社）、agent_ch（代理人渠道）在 seg1 未出现
   → 需确认原版是否在 seg2 中（若无 → 属沙盘自造）
```
> 以上为缩略图印象，**未作结论**，须逐段读原图确认后再改数据。

## 六、seg2 段（第 6–10 项）数值逐一核对 ✓
| # | 原版标题 | 原版 Upfront / Annual | 原版 per-pax 收益 | 沙盘项 | 沙盘数值 | 判定 |
|---|---|---|---|---|---|---|
| 6 | CABIN UPGRADE (GALAXY) | $3,700,000 / $0 | 全 $0 | cab_galaxy | 3700000 / 0 | ✓ |
| 7 | CABIN UPGRADE (LOW COST) | $1,375,000 / $0 | 全 $0 | cab_lowcost | 1375000 / 0 | ✓ |
| 8 | CABIN UPGRADE (NEW SEATS) | $2,550,000 / $0 | 全 $0 | cab_new | 2550000 / 0 | ✓ |
| 9 | CABIN UPGRADE (REFRESH) | $2,150,000 / $0 | 全 $0 | cab_refresh | 2150000 / 0 | ✓ |
| 10 | E-NEWSLETTERS | $0 / $75,000 | E $0.50 / PE $2.00 / B $3.00 | enews | 0 / 75000；cabin E .5 / PE 2 / B 3 | ✓ |

### ★ 原版 seg2 的一个机制细节（沙盘已具备）
```
第 7 项 CABIN UPGRADE (LOW COST) 卡片底部有**黄色提示框**：
  「Please note: To invest in Cabin Upgrade (Low Cost) you will need to
    speak to your GM to negotiate the terms.」
→ 该项**不能直接买**，须先与裁判谈定条款
→ 沙盘对应实现：
  · data.js  desc 已注明「须与 GM 谈判条款方可投资」
  · server  g.negotiation.investTerms[invId] —— 投资条款谈判台账 ✓
→ 一致 ✓
```

### 其他原版细节（沙盘已记录在 desc）
```
· 第 6 项「Impact is deferred by one Quarter」（影响延迟一季度）→ 沙盘 desc 已注明 ✓
· 第 8/9 项「Impact is deferred by one Quarter」→ 沙盘 desc 已注明 ✓
· 第 10 项原版正文提到「Modest revenue generation ... advertising revenues from third parties」
  → 沙盘已把该口径补进 cabin 收益（E .5 / PE 2 / B 3）✓
```

## 五、本轮原则
```
只对**已逐项读出**的内容下结论；不凭缩略印象改数据。
已确认：结构一致 + **前 10 项**（广告×5 + 客舱升级×4 + 电子报）数值一致。
未确认：其余 23 项（seg3–seg6 已就绪，下轮继续）。
```


---

## 七、★ 客舱座位改造机制（原版投资项的座位效果）—— 已实现

### 用户补充的一手事实
```
原版可以针对**飞机座位**进行改造：
 · 低成本航空 → 座位数改多 → 拉更多旅客
 · 全服务航空 → 高端座位改造 → 增加 VIP 旅客承载
```
### 与一手截图的对应
```
主截图 Investment Catalogue(VIEW INVESTMENTS).jpg（与「德比大学」目录下同名文件 md5 一致）
 CABIN UPGRADE (LOW COST)：「…a modest increase in seat count with negligible impact on
                         aircraft weight」→ **座位数增加** ✓ 对应低成本航空
 CABIN UPGRADE (GALAXY)：「installation of the new 'Galaxy' cabin … overhead bin capacity has been
                         increased」→ 高端化体验 → 对应全服务航空的 VIP 承载
 CABIN UPGRADE (NEW SEATS) / (REFRESH)：均注明「Impact is deferred by one Quarter」→ **延迟一季度**
```
### 沙盘实现
```
data.js  三项投资加 effect.seatMod：
  cab_lowcost  { eco:+10 }              低成本型：经济舱 +10（可拉更多旅客）
  cab_galaxy   { biz:+8, eco:-4 }       银河级：公务舱 +8（VIP 承载↑）、经济舱 −4
  cab_new      { prem:+6 }              全新座椅：超经舱 +6
  cab_refresh  （无座位变更，仅翻新）
game.js  applyCabinSeatMods(g)：在 computeTurn 开头调用
  · 生效时点 = openedTurn + 1（**延迟一个季度**，按原版说明）
  · 幂等：基准取自 AIRCRAFT 机型原值，**不随季累加**
  · 写回 ac.eco / ac.prem / ac.biz / ac.seats → 容量、收入、载重平衡、需求分配全部自动生效
★ 座位增量无一手材料 → 标【推断·待验证】
```
### 验收（新增 cabinmodtest.mjs，5/5）
```
① 基线：未购置 → 座位结构为机型原值（APT100 Y100/T100）
② 低成本型：经济舱 +10，总座位 100 → 110
③ 延迟一季度：T0 不生效 → T1 生效
④ 银河级：公务舱 +8、经济舱 −4 → VIP 承载↑
⑤ 幂等：连续多季调用不累加
```
