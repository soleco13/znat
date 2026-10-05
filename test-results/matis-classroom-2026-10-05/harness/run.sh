#!/bin/bash
# Usage: run.sh <name> [ENV...]  — PHASES, STUDENTS, SOAK_MIN, CUT_SEC через env.
set -u
H=$(cd "$(dirname "$0")" && pwd)
NAME=$1; OUT=$H/results/$NAME
mkdir -p "$OUT"; chmod -R 777 "$OUT"
cd /root/znat
LK_KEY=$(grep ^LIVEKIT_API_KEY= .env | cut -d= -f2-); LK_SECRET=$(grep ^LIVEKIT_API_SECRET= .env | cut -d= -f2-)
docker network create e2e-net >/dev/null 2>&1
GW=$(docker network inspect e2e-net -f '{{(index .IPAM.Config 0).Gateway}}')
SUBNET=$(docker network inspect e2e-net -f '{{(index .IPAM.Config 0).Subnet}}')
docker rm -f cls-teacher cls-teacher-fwd cls-driver >/dev/null 2>&1
docker run -d --name cls-teacher --network e2e-net --shm-size=2g -v "$H/../media":/media:ro --entrypoint google-chrome livekit/egress:v1.14.1 \
  --headless=new --no-sandbox --remote-debugging-port=9222 --ignore-certificate-errors --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
  --auto-select-desktop-capture-source=Entire --use-file-for-fake-audio-capture=/media/teacher.wav --autoplay-policy=no-user-gesture-required \
  --enable-precise-memory-info --window-size=1920,1080 --lang=ru-RU --user-data-dir=/tmp/prof about:blank >/dev/null
docker run -d --name cls-teacher-fwd --network container:cls-teacher alpine/socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/dev/null
sleep 4
SB_ENV=""
for k in $(seq 1 ${SB:-0}); do
  docker rm -f cls-s$k cls-s$k-fwd >/dev/null 2>&1
  docker run -d --name cls-s$k --network e2e-net --shm-size=1g -v "$H/../media":/media:ro --entrypoint google-chrome livekit/egress:v1.14.1 \
    --headless=new --no-sandbox --remote-debugging-port=9222 --ignore-certificate-errors --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
    --use-file-for-fake-audio-capture=/media/teacher.wav --autoplay-policy=no-user-gesture-required --enable-precise-memory-info --window-size=1366,768 --lang=ru-RU --user-data-dir=/tmp/prof about:blank >/dev/null
  docker run -d --name cls-s$k-fwd --network container:cls-s$k alpine/socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/dev/null
done
sleep 3
for k in $(seq 1 ${SB:-0}); do SB_ENV="$SB_ENV -e S${k}_CDP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cls-s$k):9223"; done
TIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cls-teacher)
"$H/host-sampler.sh" "$OUT/host.jsonl" &
START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$START_UTC" > "$OUT/start_utc"
# Рубильник сети учеников (массовое переподключение): только трафик к серверу урока
# (публичный IP + LiveKit на шлюзе), CDP учителя по e2e-net не трогаем.
(
  while [ ! -f "$OUT/done" ]; do
    if [ -f "$OUT/ctl.cut" ] && [ ! -f "$OUT/ctl.cut.done" ]; then
      read -r _ sec < "$OUT/ctl.cut"
      DPID=$(docker inspect -f '{{.State.Pid}}' cls-driver)
      nsenter -t "$DPID" -n sh -c "iptables -N CLSCUT 2>/dev/null; iptables -F CLSCUT; iptables -A CLSCUT -d 213.21.241.28 -j DROP; iptables -A CLSCUT -s 213.21.241.28 -j DROP; iptables -A CLSCUT -d $GW -p tcp --dport 7880 -j DROP; iptables -A CLSCUT -s $GW -p tcp --sport 7880 -j DROP; iptables -I OUTPUT 1 -j CLSCUT; iptables -I INPUT 1 -j CLSCUT"
      echo "$(date -u +%T) CUT $sec" >> "$OUT/netcut.log"
      sleep "$sec"
      nsenter -t "$DPID" -n sh -c "iptables -D OUTPUT -j CLSCUT; iptables -D INPUT -j CLSCUT; iptables -F CLSCUT; iptables -X CLSCUT"
      echo "$(date -u +%T) RESTORED" >> "$OUT/netcut.log"
      touch "$OUT/ctl.cut.done"
    fi
    sleep 0.3
  done
) &
docker run --rm --name cls-driver --network e2e-net -v "$H":/w -v "$H/../media":/media:ro -v /usr/local/bin/lk:/usr/local/bin/lk:ro -w /w \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0 -e NODE_NO_WARNINGS=1 -e OUT=/w/results/$NAME \
  -e LID="${LID:-add87950-752e-43b0-85c3-7628bbc079d5}" -e JOIN_PATH="${JOIN_PATH:-/j/0b0315665c2061b3dd9d6e9713a9b97e8cd3d13b57941c95fecda8ddec5200dc}" \
  -e T_EMAIL=e2e-teacher2@school.dev -e T_PW="$(cat /root/znat/test-results/matis-client-network-resilience-2026-10-04/harness/.secrets/e2e-teacher.pw)" \
  -e T_CDP=$TIP:9223 $SB_ENV -e LK_URL=http://$GW:7880 -e LK_KEY="$LK_KEY" -e LK_SECRET="$LK_SECRET" \
  -e STORM_CAMS="${STORM_CAMS:-}" -e SNAP_ACTION="${SNAP_ACTION:-}" -e SNAP_REPS="${SNAP_REPS:-}" -e LEAK_MODE="${LEAK_MODE:-}" -e THROTTLE="${THROTTLE:-}" -e PHASES="${PHASES:-}" -e STUDENTS="${STUDENTS:-29}" -e SOAK_MIN="${SOAK_MIN:-0}" -e CUT_SEC="${CUT_SEC:-20}" \
  node:22-bookworm-slim node run.mjs > "$OUT/driver.log" 2>&1
touch "$OUT/done" "$OUT/host.jsonl.stop"
docker compose logs --no-color --since "$START_UTC" app > "$OUT/app.log" 2>&1
docker compose logs --no-color --since "$START_UTC" livekit > "$OUT/livekit.log" 2>&1
docker rm -f cls-teacher cls-teacher-fwd cls-s1 cls-s1-fwd cls-s2 cls-s2-fwd cls-s3 cls-s3-fwd >/dev/null 2>&1
echo DONE
