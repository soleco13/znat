#!/bin/bash
# Стенд: два headless Chrome (teacher / student) в отдельных контейнерах и netns
# + сетевой контроллер netctl.py. Использование:
#   stand.sh up            — поднять браузеры (чистые профили) и контроллер
#   stand.sh down          — убрать (сеть контейнеров возвращается в исходное)
#   stand.sh run <script.mjs> <out-name> [ENV=VAL ...] — запустить драйвер
set -u
E2E=$(cd "$(dirname "$0")" && pwd)
CTL=$E2E/ctl
case "$1" in
up)
  docker network create e2e-net >/dev/null 2>&1
  touch "$CTL/done" 2>/dev/null; sleep 0.5
  for n in teacher student; do docker rm -f e2e-$n e2e-$n-fwd >/dev/null 2>&1; done
  rm -rf "$CTL"; mkdir -p "$CTL"; chmod 777 "$CTL"
  FLAGS="--headless=new --no-sandbox --remote-debugging-port=9222 --ignore-certificate-errors \
   --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --auto-select-desktop-capture-source=Entire \
   --use-file-for-fake-audio-capture=/media/voice.wav --autoplay-policy=no-user-gesture-required --window-size=1280,800 --lang=ru-RU"
  for n in teacher student; do
    docker run -d --name e2e-$n --network e2e-net --shm-size=1g --cap-add NET_ADMIN -v "$E2E/voice-$n.wav":/media/voice.wav:ro \
      --entrypoint google-chrome livekit/egress:v1.14.1 $FLAGS --user-data-dir=/tmp/prof-$n about:blank >/dev/null
    docker run -d --name e2e-$n-fwd --network container:e2e-$n alpine/socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/dev/null
  done
  sleep 3
  TPID=$(docker inspect -f '{{.State.Pid}}' e2e-teacher); SPID=$(docker inspect -f '{{.State.Pid}}' e2e-student)
  nohup python3 "$E2E/netctl.py" "$CTL" teacher=$TPID student=$SPID > "$CTL/netctl.out" 2>&1 &
  echo "teacher=$TPID student=$SPID"
  ;;
down)
  touch "$CTL/done"; sleep 1
  for n in teacher student; do docker rm -f e2e-$n e2e-$n-fwd >/dev/null 2>&1; done
  ;;
run)
  SCRIPT=$2; NAME=$3; shift 3
  OUT=$E2E/../data/$NAME; rm -rf "$OUT"; mkdir -p "$OUT"; chmod 777 "$OUT"
  TIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' e2e-teacher)
  SIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' e2e-student)
  GW=$(docker network inspect e2e-net -f '{{(index .IPAM.Config 0).Gateway}}')
  EXTRA=(); for kv in "$@"; do EXTRA+=(-e "$kv"); done
  START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  docker rm -f e2e-driver >/dev/null 2>&1
  docker run --rm --name e2e-driver --network e2e-net -v "$E2E":/w -v "$OUT":/out -w /w \
    -e OUT=/out -e CTL=/w/ctl -e T_CDP=$TIP:9223 -e S_CDP=$SIP:9223 -e LK_HOST=http://$GW:7880 \
    -e LK_KEY="$(grep ^LIVEKIT_API_KEY= /root/znat/.env | cut -d= -f2-)" -e LK_SECRET="$(grep ^LIVEKIT_API_SECRET= /root/znat/.env | cut -d= -f2-)" \
    -e LID=${LID:-add87950-752e-43b0-85c3-7628bbc079d5} -e JOIN_PATH=${JOIN_PATH:-/j/0b0315665c2061b3dd9d6e9713a9b97e8cd3d13b57941c95fecda8ddec5200dc} -e T_EMAIL=${T_EMAIL:-e2e-teacher2@school.dev} -e T_PW="$(cat "$E2E/.secrets/e2e-teacher.pw")" \
    "${EXTRA[@]}" node:22-bookworm-slim node "$SCRIPT" 2>&1 | tee "$OUT/driver.log"
  cd /root/znat && for s in livekit app; do docker compose logs --no-color --since "$START_UTC" $s > "$OUT/$s.log" 2>&1; done
  cp "$CTL/netctl.log" "$OUT/netctl.log" 2>/dev/null
  ;;
esac
