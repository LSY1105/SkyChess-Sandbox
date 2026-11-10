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
