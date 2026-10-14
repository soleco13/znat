#!/bin/bash
# kt.sh up <name> [cpu] | down <name> | call <name> <path> [body]
H=$(cd "$(dirname "$0")" && pwd); N=$2
case "$1" in
up)
  docker rm -f kt-$N kt-$N-fwd kt-$N-agent >/dev/null 2>&1
  mkdir -p "$H/../data/$N"; chmod 777 "$H/../data/$N"
  VOICE=voice-student.wav; [ "$N" = a ] && VOICE=voice-teacher.wav
  docker run -d --name kt-$N -v "$H/$VOICE":/media/voice.wav:ro --shm-size=1g --cap-add NET_ADMIN ${3:+--cpus=$3} --entrypoint /usr/bin/google-chrome znat/raw-recorder:dev \
    --headless=new --no-sandbox --remote-debugging-port=9222 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
    --autoplay-policy=no-user-gesture-required --use-file-for-fake-audio-capture=/media/voice.wav --window-size=1280,800 --lang=ru-RU --user-data-dir=/tmp/prof about:blank >/dev/null
  docker run -d --name kt-$N-fwd --network container:kt-$N -v "$H":/w node:22 node /w/fwd.mjs >/dev/null
  for i in $(seq 1 60); do docker exec kt-$N-fwd node -e "fetch('http://127.0.0.1:9222/json/version').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null && break; sleep 1; done
  docker run -d --name kt-$N-agent --network container:kt-$N -v "$H":/w -v "$H/../data/$N":/out -e CDP=127.0.0.1:9223 -e OUT=/out -w /w node:22 node agent.mjs >/dev/null
  sleep 3; docker logs kt-$N-agent 2>&1 | tail -2 ;;
down) docker rm -f kt-$N kt-$N-fwd kt-$N-agent >/dev/null 2>&1 ;;
call) IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' kt-$N); curl -s --noproxy '*' -X POST --data-binary "${4:-}" "http://$IP:8080$3" ;;
esac
