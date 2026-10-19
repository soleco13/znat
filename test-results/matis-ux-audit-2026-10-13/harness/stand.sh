#!/bin/bash
# Стенд UX-аудита 2026-10-13: три headless Chrome (teacher / s1 / s2) в отдельных
# контейнерах сети ux-net (172.31.0.0/24) + netctl.py, который портит сеть ТОЛЬКО
# внутри netns браузеров. Приложение — тестовый стенд znat-stage (своя БД/Redis),
# доступен из ux-net по 172.31.0.1:3100, LiveKit стенда — lk-test 172.31.0.50
# (с 2026-10-17, /root/loadtest/stage). Прод, его .env, БД и LiveKit не затрагиваются.
#   stand.sh up | down   (CAPTURE_FLAG=--auto-select-tab-capture-source-by-title=<заголовок> FAKE_UI_FLAG= — демонстрация вкладки со звуком)
#   stand.sh run <script.mjs> <out-name> [ENV=VAL ...]
set -u
H=$(cd "$(dirname "$0")" && pwd)
CTL=$H/ctl
WHO="teacher s1 s2"
ORIGIN=http://172.31.0.1:3100
case "$1" in
up)
  docker network inspect ux-net >/dev/null 2>&1 || docker network create --subnet 172.31.0.0/24 --gateway 172.31.0.1 ux-net >/dev/null
  touch "$CTL/done" 2>/dev/null; sleep 0.5
  for n in $WHO; do docker rm -f ux-$n ux-$n-fwd >/dev/null 2>&1; done
  rm -rf "$CTL"; mkdir -p "$CTL"; chmod 777 "$CTL"
  FLAGS="--headless=new --no-sandbox --remote-debugging-port=9222 \
   --use-fake-device-for-media-stream ${FAKE_UI_FLAG---use-fake-ui-for-media-stream} ${CAPTURE_FLAG:---auto-select-desktop-capture-source=Entire} \
   --unsafely-treat-insecure-origin-as-secure=$ORIGIN --autoplay-policy=no-user-gesture-required \
   --window-size=1280,800 --lang=ru-RU"
  PIDS=""
  for n in $WHO; do
    voice=voice-student.wav; [ "$n" = teacher ] && voice=${VOICE_TEACHER:-voice-teacher.wav}
    # Ядра 1,2,7,8 — LiveKit прода, 3,9 — app прода: браузеры стенда туда не пускаем.
    docker run -d --name ux-$n --network ux-net --shm-size=1g --cap-add NET_ADMIN --cpuset-cpus="${UX_CPUSET:-0,4,5,6,10,11}" ${CPUS_FLAG:-} \
      -v "$H/$voice":/media/voice.wav:ro --entrypoint /usr/bin/google-chrome znat/raw-recorder:dev \
      $FLAGS --use-file-for-fake-audio-capture=/media/voice.wav --user-data-dir=/tmp/prof-$n about:blank >/dev/null
    docker run -d --name ux-$n-fwd --network container:ux-$n -v "$H":/w node:22 node /w/fwd.mjs >/dev/null
    PIDS="$PIDS $n=$(docker inspect -f '{{.State.Pid}}' ux-$n)"
  done
  sleep 3
  nohup python3 "$H/netctl.py" "$CTL" $PIDS > "$CTL/netctl.out" 2>&1 &
  echo "up:$PIDS"
  ;;
down)
  touch "$CTL/done"; sleep 1.5
  for n in $WHO; do docker rm -f ux-$n ux-$n-fwd >/dev/null 2>&1; done
  ;;
run)
  SCRIPT=$2; NAME=$3; shift 3
  OUT=$H/../data/$NAME; rm -rf "$OUT"; mkdir -p "$OUT"; chmod 777 "$OUT"
  EXTRA=(); for kv in "$@"; do EXTRA+=(-e "$kv"); done
  for n in $WHO; do EXTRA+=(-e "CDP_$n=$(docker inspect -f '{{(index .NetworkSettings.Networks "ux-net").IPAddress}}' ux-$n):9223"); done
  START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  docker rm -f ux-driver >/dev/null 2>&1
  docker run --rm --name ux-driver --network ux-net -v "$H":/w -v "$OUT":/out -v /root/znat/node_modules:/znat/node_modules:ro -w /w \
    -e OUT=/out -e CTL=/w/ctl -e ORIGIN=$ORIGIN "${EXTRA[@]}" node:22 node "$SCRIPT" 2>&1 | tee "$OUT/driver.log"
  docker logs --since "$START_UTC" znat-stage-app-1 > "$OUT/app.log" 2>&1
  cp "$CTL/netctl.log" "$OUT/netctl.log" 2>/dev/null
  ;;
esac
