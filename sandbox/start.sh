#!/usr/bin/env bash
# ============================================================
# 启动 SkyChess 沙盘（多人 + 裁判面板）
#   1) node server.mjs   —— 完整版：多席位独立 + 教师面板（推荐）
#   2) python http.server —— 简化版：仅单机单页 index.html
# ============================================================
cd "$(dirname "$0")"
PORT="${1:-8765}"

if command -v node >/dev/null 2>&1; then
  echo "▶ 启动 SkyChess 沙盘服务端（多席位 + 裁判面板）"
  echo "  玩家面板   http://127.0.0.1:$PORT/player.html?seat=CA   （可换 AB / VA / 自定义）"
  echo "  裁判面板   http://127.0.0.1:$PORT/teacher.html"
  echo "  单机版     http://127.0.0.1:$PORT/"
  echo
  PORT=$PORT exec node server.mjs
else
  echo "⚠ 未检测到 node，回退到仅单机静态服务（无裁判面板）"
  python -m http.server "$PORT" --bind 127.0.0.1
fi
