#!/usr/bin/env bash
# ============================================================
#  SkyChess REA 自动抓取 — 一条命令完成全部工作
#  用法:  ./capture.sh [输出标签]
#  例:    ./capture.sh turn1        -> 生成 capture-turn1.json + state-turn1.json
# ============================================================
set -euo pipefail

LABEL="${1:-snap}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

NODE64="C:/Users/qjl10/AppData/Local/rea-node64/node-v22.23.3-win-x64/node.exe"
REA="C:/Users/qjl10/AppData/Local/pi-node/current/node_modules/rea-agents/scripts/rea.mjs"
CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
CDP="http://127.0.0.1:9222"
ORIGIN="https://www.skychess.com"

echo "==> [1/6] 检查 CDP 浏览器"
if ! curl -sf -m 8 "$CDP/json/version" >/dev/null; then
  echo "!! 未检测到 CDP 浏览器。请先启动带调试端口的 Chrome 并登录 SkyChess:"
  echo "   \"C:/Program Files/Google/Chrome/Application/chrome.exe\" \\"
  echo "     --remote-debugging-port=9222 --user-data-dir=\"$DIR/cdp-profile\" \\"
  echo "     \"$ORIGIN/login\""
  exit 1
fi

get_target() {
  "$NODE64" "$REA" list-browser-targets "$CDP" --allowed-origins "$ORIGIN" --format json 2>/dev/null \
    | python -c "import sys,json;d=json.load(sys.stdin);t=[x['target_id'] for x in d['normalized_result']['targets'] if x['type']=='page'];print(t[0] if t else '')"
}

echo "==> [2/6] 生成场景 (12 条路由 + DOM + 网络响应体 + 高配额)"
echo "==> [3/6] 执行自动抓取 (约 90-120 秒; 失败自动重试)"

CAP_OK=0
for ATTEMPT in 1 2 3; do
  TID="$(get_target)"
  if [ -z "$TID" ]; then
    echo "    [尝试 $ATTEMPT] 未找到 SkyChess 页面标签, 等待 5s"
    sleep 5; continue
  fi
  echo "    [尝试 $ATTEMPT] target=$TID"
  python make_scenario.py "$TID" "scenario-$LABEL.json" 2500 > /dev/null
  set +e
  "$NODE64" "$REA" capture-browser-scenario "scenario-$LABEL.json" --format json \
      > "capture-$LABEL.json" 2>&1
  set -e
  if grep -q '"normalized_result"' "capture-$LABEL.json" 2>/dev/null; then
    CAP_OK=1; echo "    抓取成功"; break
  fi
  CODE=$(python -c "
import json
try:
    d=json.load(open('capture-$LABEL.json',encoding='utf-8')); print(d.get('code','?'))
except Exception: print('parse_error')
")
  echo "    失败 (code=$CODE)"
  if [ "$CODE" = "execution_failure" ]; then
    echo "    -> Playwright 会话耗尽, 自动重启调试浏览器"
    taskkill //F //IM chrome.exe //T > /dev/null 2>&1 || true
    sleep 4
    "$CHROME" --remote-debugging-port=9222 --remote-allow-origins="$CDP" \
      --user-data-dir="$DIR/cdp-profile" --no-first-run --no-default-browser-check \
      --window-size=1600,1000 "$ORIGIN/login" > "$DIR/chrome.log" 2>&1 &
    sleep 12
  fi
  sleep 4
done

if [ "$CAP_OK" != "1" ]; then
  echo "!! 三次尝试均失败; 请确认调试 Chrome 已打开并登录"
  exit 1
fi

echo "==> [4/6] 解码并保存状态快照"
python save_state.py "capture-$LABEL.json" "state-$LABEL.json"

echo "==> [5/6] 导出无障碍树"
python export_a11y.py "capture-$LABEL.json" "$LABEL" 2>&1 | head -3

echo "==> [6/6] 生成数据摘要"
python extract_state.py > "summary-$LABEL.txt" 2>&1 || true
python extract_data.py  > "data-$LABEL.txt"    2>&1 || true

echo
echo "✔ 完成。产出文件:"
ls -la "capture-$LABEL.json" "state-$LABEL.json" "summary-$LABEL.txt" "data-$LABEL.txt" \
    2>/dev/null | awk '{printf "  %10s  %s\n", $5, $9}'
echo "  a11y/$LABEL/  ($(ls -1 "a11y/$LABEL" 2>/dev/null | wc -l) 份无障碍树)"

echo
echo "如需与基线对比:"
echo "  python compare_state.py state-baseline.json state-$LABEL.json"