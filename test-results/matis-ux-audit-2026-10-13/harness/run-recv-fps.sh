#!/bin/bash
# Облегчённый приём у учителя (CPU учителя = $CPU) — сколько кадр/с камеры ученика он получает.
# S1_CORES=2 — ученик как слабый MacBook (камера 15 кадр/с).
H=$(cd "$(dirname "$0")" && pwd); cd "$H"; CPU=${CPU:-0.4}; NAME=${NAME:-s37-recv-fps}
docker update --cpus=$CPU ux-teacher >/dev/null
./stand.sh run s37-recv-fps.mjs $NAME S1_CORES=${S1_CORES:-} S1_FPS=${S1_FPS:-} > /dev/null 2>&1
docker update --cpus=0 ux-teacher >/dev/null 2>&1
grep -E "MARK" ../data/$NAME/driver.log | cut -c1-260
