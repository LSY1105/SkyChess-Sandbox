# 超大文件清单（GitHub 单文件上限 ~50MB，原件不入库）

| 文件 | 大小 | SHA-256 |
|---|---|---|
| `jsapp.json` | 52.6 MB | `7996bf1a16a3cb95f52de48255c57f798fd4f7f3afadf534c2f88838f1cf84d1` |

## 说明

`jsapp.json` 是 **SkyChess 官方前端的构建产物**（逆向分析的目标对象），
单文件 52.6 MB，**超过 GitHub blob / Contents API 的 50 MB 处理上限**，因此不入库。

## 如何重新获取

1. 站点仍在：`https://www.skychess.com` 的前端主 bundle，等价物可由
   `extract_*.py` 系列脚本从浏览器抓取（见 `extract_routes.py` / `extract_model.py`）。
2. 本机若保留了原始抓取：直接校验 SHA-256 与上表一致即可。

```bash
sha256sum jsapp.json
# 应输出：7996bf1a16a3cb95f52de48255c57f798fd4f7f3afadf534c2f88838f1cf84d1
```

## 已入库的等价产物（可直接使用，无需原件）

| 产物 | 内容 |
|---|---|
| `api-routes.txt` | 提取出的 57 条 API 路由模板（玩家 5 + 管理端 52） |
| `backend-inference.txt` | 后端技术栈与 ERD 推断结论 |
| `extract_routes.py` / `extract_model.py` | 提取脚本（可重跑） |
| `SkyChess-REA分析报告.md` 等 8 份报告 | 全部逆向结论 |
| `rebuild/` | 复建引擎（成本公式、需求模型、事件） |

> 逆向过程的证据链、结论与复现代码均已入库；唯一缺失的是第三方构建产物原件，
> 其 SHA-256 指纹已记录在上表，结论可复现性不受影响。
