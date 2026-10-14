#!/bin/bash
# Матис в условиях Елены: CPU ученика s1 = $CPU ядер, сеть s1 — shape.py elena.
H=$(cd "$(dirname "$0")" && pwd); cd "$H"; CPU=${CPU:-1.2}; NAME=${NAME:-s20-elena}
docker update --cpus=$CPU ux-s1 >/dev/null
rm -f ctl/start-shape
./stand.sh run s20-elena.mjs $NAME > /dev/null 2>&1 &
DRV=$!
until [ -f ctl/start-shape ] || ! kill -0 $DRV 2>/dev/null; do sleep 0.5; done
PID=$(docker inspect -f '{{.State.Pid}}' ux-s1)
python3 ../../kontur-research-2026-10-14/harness/shape.py $PID ${SHAPE:-elena} ${TARGETS:-172.31.0.1/32,95.213.143.106/32} > ../data/$NAME.shape.log 2>&1
wait $DRV
docker update --cpus=0 ux-s1 >/dev/null 2>&1
grep -E "CHECK|CHECKS" ../data/$NAME/driver.log | tail -4
