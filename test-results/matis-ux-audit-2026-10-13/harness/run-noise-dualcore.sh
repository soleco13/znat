#!/bin/bash
# RNNoise на двухъядерном ученике: s1 видит 2 ядра, CPU s1 = $CPU ядер (2 — MacBook Юли, 0.5 — ПК Елены).
H=$(cd "$(dirname "$0")" && pwd); cd "$H"; CPU=${CPU:-2}; NAME=${NAME:-s34-noise-dualcore}
docker update --cpus=$CPU ux-s1 >/dev/null
./stand.sh run s34-noise-dualcore.mjs $NAME EXPECT_FALLBACK=${EXPECT_FALLBACK:-0} > /dev/null 2>&1
docker update --cpus=0 ux-s1 >/dev/null 2>&1
grep -E "CHECK|CHECKS" ../data/$NAME/driver.log | tail -8
