# AGENTS.md —— 在本仓库工作的任何 AI Agent 的入口

> 只放**指针**。事实、清单、历史全在下面文档，别复制进来。

## 先读这三份（不要从 36 篇文档里从头翻）

| 顺序 | 文档 | 读什么 |
|---|---|---|
| 1 | **项目同步文档.md** | **§0 一分钟摘要** → **§1.3 五条纪律** → 需要的章节。含架构/机制清单/已完成/待开发/已知债/历史坑（§10）。§8.3 明细在 `docs/附录A-8.3-交互与稳定性台账.md`（按需再开） |
| 2 | **真实机制对照.md** | 原版 SkyChess 真实机制 ↔ 沙盘实现状态。**任何数值或机制结论都要标证据分级** |
| 3 | **sandbox/README.md** | 代码结构、运行方式、API 速查 |

## 五条纪律（项目同步文档.md §1.3，改代码前必读）

1. 不把原版截图数值当常数 —— 那是"某航司·某季·某航班"观测值（§5 数值性质规范）
2. 改 `server.mjs` / `game.js` 后**必须重启 8765**，否则测到旧逻辑
3. 改内联 HTML/JS 后必须 `node --check` + 跑 `node runtests.mjs` 全绿
4. 裁判动作参数一律做有限值守卫（金额/价格类非有限数直接拒写）
5. 一切结论标注证据分级；别把推断说成事实

## 命令

```bash
cd sandbox && node server.mjs        # 起服务（8765）；改 server.mjs/game.js 后必须重启
cd sandbox && npm test               # 全量测试：21 个文件独立实例（逻辑 + 真实浏览器），标准入口
cd sandbox && node runtests.mjs      # = npm test（同上）
cd sandbox && node scripts/hitl-loop.mjs        # 人工复验清单（12 条常驻项 + 访问地址）
cd sandbox && node scripts/hitl-loop.mjs --record "第2轮：1-12 通过"   # 记台账到系统临时目录
```

## 提交前

1. **code-review**：Standards + Spec 双轴并行 review（standards 见 `CODING_STANDARDS.md`）
2. **备份**：GitHub 走 Database API（本机 443 不通，**不能用 git push**）—— 步骤见 项目同步文档.md §1.2
3. 更新 **项目同步文档.md**（§8.3 已完成清单 / §9 未闭环问题）

## 目录速查

```
sandbox/     运行代码（server.mjs · game.js · engine.js · data.js · reports.js · player.html · teacher.html）
sandbox/browsertest.mjs   真实浏览器护栏（Chrome CDP，零依赖）：可见性 / 可读性 / 截断 / 输入保留
sandbox/scripts/          人工复验清单（hitl-loop.mjs）
docs/        计划 / 规格 / 执行记录 / 台账（docs/superpowers/）
根目录 *.md  开发文档、机制对照、审计报告（36+ 篇，按需查）
```

## 已知坑（踩过就别再踩）

见 项目同步文档.md §10 —— 尤其：改 `server.mjs` 会**清空对局状态**（不持久化）；`git archive` 导出被 autocrlf 转成 CRLF（备份用 `git cat-file blob`）；导出/临时产物**放系统临时目录**，别落工作区（会被设计检测扫成假阳性）。
