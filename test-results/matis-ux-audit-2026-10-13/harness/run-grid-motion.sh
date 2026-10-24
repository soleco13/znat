#!/bin/bash
# Сетка камер: 3 браузера + синтетические ученики по одному раз в 8 с (до $N).
H=$(cd "$(dirname "$0")" && pwd); cd "$H"; NAME=${NAME:-s39-grid-motion}; N=${N:-6}
LID=7df1a7ae-fa77-4ab4-acb7-db7943e9188d; CODE=758e82a0bbca21932a07183e3f35a90f630d8f7a1ce8c3a21f575af8fadb8ca2
TEACHER=6e81c5b6-964a-4e1e-8577-3e05e1d18f49
rm -f ctl/start-shape
./stand.sh run s39-grid-motion.mjs $NAME > /dev/null 2>&1 &
DRV=$!
until [ -f ctl/start-shape ] || ! kill -0 $DRV 2>/dev/null; do sleep 0.5; done
OUT=../data/$NAME
for k in $(seq 1 $N); do
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy taskset -c 0,6 /root/loadtest/gen/matis-loadgen \
    -base http://127.0.0.1:3100 -lesson $LID -code $CODE -teacher-id $TEACHER -students 1 -student-video=true -mode discussion \
    -talk-pct 0 -record=false -screen=false -duration 70s -media /root/loadtest/media -tag G$k -out $OUT/gen$k.jsonl > $OUT/gen$k.log 2>&1 &
  sleep 8
done
wait $DRV
pkill -f "matis-loadgen.*-tag G" 2>/dev/null
grep -E "CHECK|CHECKS" $OUT/driver.log | cut -c1-220
