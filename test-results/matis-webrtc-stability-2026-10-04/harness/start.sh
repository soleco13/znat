#!/bin/bash
# Usage: start.sh <run-name> <LONG_MIN> [CUTS]
# Env: LID=<lesson uuid> JOIN_PATH=/j/<token> [FOCUS=1 OBS_SEC=240 LKDEBUG=1]. Needs voice-teacher.wav / voice-student.wav (gen-voice.py) next to this script.
set -u
E2E=$(cd "$(dirname "$0")" && pwd)
RUN=$1; LONG=$2; CUTS=${3:-5,25}
OUT=$E2E/results/$RUN
rm -rf "$OUT"; mkdir -p "$OUT/shots"; chmod -R 777 "$OUT"

docker network create e2e-net >/dev/null 2>&1
# Чистые браузеры (новые профили, новые netns)
for n in teacher student; do docker rm -f e2e-$n e2e-$n-fwd >/dev/null 2>&1; done
CHROME_FLAGS="--headless=new --no-sandbox --remote-debugging-port=9222 --ignore-certificate-errors \
 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --auto-select-desktop-capture-source=Entire \
 --use-file-for-fake-audio-capture=/media/voice.wav --autoplay-policy=no-user-gesture-required --window-size=1280,800 --lang=ru-RU"
for n in teacher student; do
  docker run -d --name e2e-$n --network e2e-net --shm-size=1g -v "$E2E/voice-$n.wav":/media/voice.wav:ro --entrypoint google-chrome livekit/egress:v1.14.1 \
    $CHROME_FLAGS --user-data-dir=/tmp/prof-$n about:blank >/dev/null
  docker run -d --name e2e-$n-fwd --network container:e2e-$n alpine/socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/dev/null
done
sleep 4
TIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' e2e-teacher)
SIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' e2e-student)
SPID=$(docker inspect -f '{{.State.Pid}}' e2e-student)
SUBNET=$(docker network inspect e2e-net -f '{{(index .IPAM.Config 0).Subnet}}')
GW=$(docker network inspect e2e-net -f '{{(index .IPAM.Config 0).Gateway}}')

# Watcher: обрыв сети ТОЛЬКО в netns контейнера ученика (CDP-канал из e2e-net оставляем)
(
  last=""
  while [ ! -f "$OUT/done" ]; do
    if [ -f "$OUT/ctl.req" ]; then
      read -r id sec < "$OUT/ctl.req"
      if [ "$id" != "$last" ]; then
        last=$id
        nsenter -t "$SPID" -n sh -c "iptables -N E2ECUT 2>/dev/null; iptables -F E2ECUT; \
          iptables -A E2ECUT -o lo -j RETURN; iptables -A E2ECUT -i lo -j RETURN; \
          iptables -A E2ECUT -d $SUBNET ! -d $GW -j RETURN; iptables -A E2ECUT -s $SUBNET ! -s $GW -j RETURN; \
          iptables -A E2ECUT -j DROP; iptables -I OUTPUT 1 -j E2ECUT; iptables -I INPUT 1 -j E2ECUT"
        echo $(($(date +%s%N)/1000000)) > "$OUT/ctl.down.$id"
        echo "$(date -u +%T) CUT $sec s" >> "$OUT/netcut.log"
        sleep "$sec"
        nsenter -t "$SPID" -n sh -c "iptables -D OUTPUT -j E2ECUT; iptables -D INPUT -j E2ECUT; iptables -F E2ECUT; iptables -X E2ECUT"
        echo $(($(date +%s%N)/1000000)) > "$OUT/ctl.up.$id"
        echo "$(date -u +%T) RESTORED" >> "$OUT/netcut.log"
        nsenter -t "$SPID" -n iptables -S >> "$OUT/netcut.log"
      fi
    fi
    sleep 0.2
  done
) &
WATCHER=$!

# Ресурсы хоста в фоне
( while [ ! -f "$OUT/done" ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg) | $(docker stats --no-stream --format '{{.Name}}={{.CPUPerc}}/{{.MemUsage}}' znat-livekit-1 znat-app-1 e2e-teacher e2e-student | tr '\n' ' ')" >> "$OUT/host.log"; sleep 30; done ) &

START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$START_UTC" > "$OUT/start_utc"
LK_KEY=$(grep ^LIVEKIT_API_KEY= /root/znat/.env | cut -d= -f2-)
LK_SECRET=$(grep ^LIVEKIT_API_SECRET= /root/znat/.env | cut -d= -f2-)
docker run --rm --name e2e-driver --network e2e-net -v "$E2E":/w -w /w \
  -e LID="${LID:?set LID}" \
  -e JOIN_PATH="${JOIN_PATH:?set JOIN_PATH}" \
  -e LONG_MIN="$LONG" -e CUTS="$CUTS" -e FOCUS="${FOCUS:-}" -e LKDEBUG="${LKDEBUG:-}" -e OBS_SEC="${OBS_SEC:-90}" -e OUT=/w/results/$RUN \
  -e T_CDP=$TIP:9223 -e S_CDP=$SIP:9223 -e LK_HOST=http://$GW:7880 \
  -e LK_KEY="$LK_KEY" -e LK_SECRET="$LK_SECRET" \
  node:22-bookworm-slim node run.mjs > "$OUT/driver.log" 2>&1
touch "$OUT/done"
wait $WATCHER 2>/dev/null
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/end_utc"
cd /root/znat && docker compose logs --no-color --since "$START_UTC" livekit > "$OUT/livekit.log" 2>&1
cd /root/znat && docker compose logs --no-color --since "$START_UTC" app > "$OUT/app.log" 2>&1
cd /root/znat && docker compose logs --no-color --since "$START_UTC" caddy > "$OUT/caddy.log" 2>&1
# браузеры оставляем для разбора; сеть ученика гарантированно возвращена
nsenter -t "$SPID" -n iptables -S | grep -q E2ECUT && echo "WARN: E2ECUT still present" >> "$OUT/netcut.log"
echo DONE
