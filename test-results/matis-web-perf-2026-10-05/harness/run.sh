#!/bin/bash
# Usage: PROFILE=slow4g PAGES=landing,login ./run.sh
H=$(cd "$(dirname "$0")" && pwd)
docker run --rm --name perf-driver-$RANDOM --network e2e-net -v "$H":/w -w /w -e NODE_TLS_REJECT_UNAUTHORIZED=0 -e NODE_NO_WARNINGS=1 \
  -e OUT=/w/results -e CDP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' perf-chrome):9223 \
  -e LID="${LID:-add87950-752e-43b0-85c3-7628bbc079d5}" -e JOIN_PATH="${JOIN_PATH:-/j/0b0315665c2061b3dd9d6e9713a9b97e8cd3d13b57941c95fecda8ddec5200dc}" \
  -e MAT_ID="${MAT_ID:-d39b26cd-633e-411f-ba45-3c191804db32}" -e T_EMAIL=e2e-teacher2@school.dev \
  -e T_PW="$(cat /root/znat/test-results/matis-client-network-resilience-2026-10-04/harness/.secrets/e2e-teacher.pw)" \
  -e PROFILE="${PROFILE:-none}" -e PAGES="${PAGES:-landing,login,classroom,student,material,editor}" -e CPU="${CPU:-1}" -e BOARD="${BOARD:-1}" -e FASTJOIN="${FASTJOIN:-0}" \
  node:22-bookworm-slim node perf.mjs
