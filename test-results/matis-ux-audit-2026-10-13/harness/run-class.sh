#!/bin/bash
# T3: класс на 30 (s25-class.mjs). CPU ученика s1 = $CPU ядра; 27 синтетических учеников.
H=$(cd "$(dirname "$0")" && pwd); cd "$H"; CPU=${CPU:-0.5}; NAME=${NAME:-s25-class}; N=${STUDENTS:-27}
LID=7df1a7ae-fa77-4ab4-acb7-db7943e9188d; CODE=758e82a0bbca21932a07183e3f35a90f630d8f7a1ce8c3a21f575af8fadb8ca2
TEACHER=6e81c5b6-964a-4e1e-8577-3e05e1d18f49
docker update --cpus=$CPU ux-s1 >/dev/null
rm -f ctl/start-shape
./stand.sh run s25-class.mjs $NAME > /dev/null 2>&1 &
DRV=$!
until [ -f ctl/start-shape ] || ! kill -0 $DRV 2>/dev/null; do sleep 0.5; done
OUT=../data/$NAME
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy taskset -c 0,6 /root/loadtest/gen/matis-loadgen \
  -base http://127.0.0.1:3100 -lesson $LID -code $CODE -teacher-id $TEACHER -students $N -student-video=true -mode discussion \
  -talk-pct 10 -record=false -screen=false -duration 560s -media /root/loadtest/media -tag T3 -out $OUT/gen.jsonl > $OUT/gen.log 2>&1 &
GEN=$!
( while kill -0 $DRV 2>/dev/null; do docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' lk-test ux-teacher ux-s1 ux-s2 | sed "s/^/$(date +%s) /"; sleep 5; done ) > $OUT/cpu.log 2>&1 &
wait $DRV; kill $GEN 2>/dev/null
docker update --cpus=0 ux-s1 >/dev/null 2>&1
grep -E "CHECK|CHECKS" $OUT/driver.log | tail -5
