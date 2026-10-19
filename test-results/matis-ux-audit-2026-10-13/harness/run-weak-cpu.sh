#!/bin/bash
# Слабый ПК ученика при хорошей сети: s1 = $CPU ядер (по умолчанию 0,35), $SECS с замеров.
H=$(cd "$(dirname "$0")" && pwd); cd "$H"; CPU=${CPU:-0.35}; NAME=${NAME:-s33-weak-cpu}
docker update --cpus=0 ux-s1 >/dev/null 2>&1
rm -f ctl/start-shape
./stand.sh run s33-weak-cpu.mjs $NAME SECS=${SECS:-300} DIP=${DIP:-0} CUT_DELAY=${CUT_DELAY:-0} > /dev/null 2>&1 &
DRV=$!
# Вход — на полном CPU (как у Елены: перегрузка наступает уже на уроке), потом урезаем.
until [ -f ctl/start-shape ] || ! kill -0 $DRV 2>/dev/null; do sleep 0.5; done
docker update --cpus=$CPU ux-s1 >/dev/null
wait $DRV
docker update --cpus=0 ux-s1 >/dev/null 2>&1
grep -E "CHECK|FAIL" ../data/$NAME/driver.log | tail -4
