# 一手截图核对 —— 三家排班（DAILY SCHEDULE）

## 一手依据
```
六季度完结/屏幕截图_22-10-2026_222037_www.skychess.com.jpg（Q2 2029）
★ 关键：**玩家视角**（右上角「CA RR 20 OCT 26 CHINA EASTERN」= 登录 CA）
  但页面显示 **CA / AB / VA 三家全部航班**
结构：
  · 行 = 每架飞机，标签格式 `APT100 (CA:Starter)` / `G160XLR P3 (CA:005)` / `APT100 (AB:012)`
  · 列 = 时刻 07:00 → 23:00（每小时一格）
  · 块 = 航班，块内写**航线名**（Simone / Fitzgerald / Joplin / Armstrong / Ellington / McGee / Parker / Charles City / Broonzy）
  · **深色 = 去程，淡色 = 回程**（成对出现）
  · 配色按席位分组：CA 黄 / AB 橄榄绿 / VA 蓝
  · 部分窄块只显示文字（不显示条）
```
→ 结论：**原版让每个玩家看到三家全部排班**，这是竞争博弈的信息面。

## 沙盘核对结果
| 项 | 原版 | 沙盘（改前） | 判定 |
|---|---|---|---|
| 裁判端三家同屏 | ✓ | ✓ 已有「三家日程甘特图」 | ✓ |
| **学员端三家同屏** | ✓ | **✗ 只有本组** | **本轮补齐** |
| 行标签 | `APT100 (CA:Starter)` | `CA 首都 · APT100` | **本轮对齐** |
| 块内文字 | 市场英文名 | 航线代码（SIM/ETN） | **本轮对齐** |
| 深去/浅回 | ✓ | ✓ | ✓ |
| 席位分组色 | CA黄/AB绿/VA蓝 | ✓（上轮已统一） | ✓ |

## 本轮改动
```
1. server.mjs  serialize 新增 peerSchedules
   → 各组 aircraft + schedules（只读·公开）
   → 依据：原版玩家端可见三家排班
2. player.html  新增「三家排班」卡片（#ganttAll），排在「航班排班」之后、「航线需求图」之前
   → 本组用完整 game，其余两组用 peerSchedules
3. reports.js  renderGantt
   · 行标签 → `${机型} (${席位}:${编号})`（Starter 机型保留 Starter 字样）
   · 块内文字 → 市场英文名（原版 Simone/Fitzgerald…）
   → 裁判端同步受益（同一函数）
```
## 实测
```
CA SIM 09:00 / CA ETN 14:00 / AB ETN 08:00 / VA ETN 10:00
→ peerSchedules 下发正确（三组 schedules 完整）
→ 小组端截图确认：APT100 (CA:1) / G160 (CA:2) / G160 (AB:2) / G160 (VA:2)
  CA 黄 / AB 绿 / VA 蓝，块内 Simone / Ellington / McGee，深去浅回 ✓
→ 无 JS 错误 ✓
```
