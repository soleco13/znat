#!/bin/bash
# Демонстрация у слабого ведущего: CPU учителя = $CPU, его сеть — shape.py $SHAPE (по умолчанию share: вход 2 Мбит/с, выход 1 Мбит/с).
H=$(cd "$(dirname "$0")" && pwd); cd "$H"; CPU=${CPU:-0.5}; NAME=${NAME:-s21-share}
docker update --cpus=$CPU ux-teacher; WHO=${WHO:-ux-teacher} >/dev/null
rm -f ctl/start-shape
./stand.sh run s21-share.mjs $NAME > /dev/null 2>&1 &
DRV=$!
until [ -f ctl/start-shape ] || ! kill -0 $DRV 2>/dev/null; do sleep 0.5; done
PID=$(docker inspect -f "{{.State.Pid}}" $WHO)
python3 ../../kontur-research-2026-10-14/harness/shape.py $PID ${SHAPE:-share} ${TARGETS:-172.31.0.1/32,95.213.143.106/32} > ../data/$NAME.shape.log 2>&1 &
SH=$!
wait $DRV; kill $SH 2>/dev/null; python3 ../../kontur-research-2026-10-14/harness/shape.py $PID clear >/dev/null 2>&1
docker update --cpus=0 ux-teacher >/dev/null 2>&1
grep -E "CHECK|CHECKS" ../data/$NAME/driver.log | tail -6
