#!/usr/bin/env bash
# 静默周期采集：每 10 分钟抓一次，直到 turn 关闭
cd "C:/Users/qjl10/Desktop/学习/德比大学/rea-skychess"
NODE64="C:/Users/qjl10/AppData/Local/rea-node64/node-v22.23.3-win-x64/node.exe"
REA="C:/Users/qjl10/AppData/Local/pi-node/current/node_modules/rea-agents/scripts/rea.mjs"
LIM='{"max_events":50000,"max_event_allocation_bytes":33554432,"max_total_event_allocation_bytes":536870912,"max_network_transactions":8192,"max_network_body_bytes":67108864,"max_network_body_allocation_bytes":268435456,"max_network_header_allocation_bytes":8388608,"max_network_metadata_allocation_bytes":16777216}'
ROUTES=("https://www.skychess.com/play/airline/833" \
        "https://www.skychess.com/play/airline/833/scheduler" \
        "https://www.skychess.com/play/airline/833/reports" \
        "https://www.skychess.com/play/liveboard/285")
for i in $(seq 1 40); do
  TID=$(curl -s -m 8 http://127.0.0.1:9222/json/list 2>/dev/null | python -c "
import sys,json
try:
    for t in json.load(sys.stdin):
        if t['type']=='page' and 'skychess' in t['url']: print(t['id']); break
except: pass" 2>/dev/null)
  if [ -n "$TID" ]; then
    python - "$TID" "$LIM" <<'PY'
import json,sys
tid,lim=sys.argv[1],json.loads(sys.argv[2])
R=["https://www.skychess.com/play/airline/833","https://www.skychess.com/play/airline/833/scheduler",
   "https://www.skychess.com/play/airline/833/schedules","https://www.skychess.com/play/airline/833/fares",
   "https://www.skychess.com/play/airline/833/investments","https://www.skychess.com/play/airline/833/reports",
   "https://www.skychess.com/play/liveboard/285"]
acts=[]
for i,u in enumerate(R,1):
    acts.append({'action':'goto','step_id':f'n{i}','destination':{'url':u},'wait_until':'load'})
    acts.append({'action':'wait_for_timeout','step_id':f'w{i}','duration_ms':2500})
sc={'browser':{'mode':'connect','cdp_endpoint':'http://127.0.0.1:9222','target_id':tid},
    'start_url':{'url':R[0]},
    'capture':{'after_each_step':['accessibility','url'],'events':['network'],
               'network':{'request_body':True,'response_body':True,'header_values':False},'limits':lim},
    'actions':acts}
json.dump(sc,open('scenario-watch.json','w',encoding='utf-8'),ensure_ascii=False)
PY
    LABEL="watch-$(date +%H%M)"
    timeout 400 "$NODE64" "$REA" capture-browser-scenario scenario-watch.json --format json \
        > "capture-$LABEL.json" 2>&1 || true
    if grep -q '"normalized_result"' "capture-$LABEL.json" 2>/dev/null; then
      python save_state.py "capture-$LABEL.json" "state-$LABEL.json" >/dev/null 2>&1 || true
      python export_a11y.py "capture-$LABEL.json" "$LABEL" >/dev/null 2>&1 || true
      echo "[$LABEL] OK $(date +%H:%M:%S)"
    else
      echo "[$LABEL] FAIL $(date +%H:%M:%S)"
    fi
  else
    echo "[$(date +%H:%M:%S)] 无 SkyChess 标签页，跳过"
  fi
  sleep 540
done
