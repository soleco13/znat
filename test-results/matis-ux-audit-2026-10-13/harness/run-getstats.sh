#!/bin/bash
# B2: замер цены getStats-мониторов SDK одним наблюдателем (s70-getstats.mjs).
# Браузер — один контейнер на двух потоках (cpuset, не квота): слабое устройство.
#   ORIGIN=https://matis-edu.ru JOIN_PATH=/<код> NAME=s70-getstats ./run-getstats.sh
H=$(cd "$(dirname "$0")" && pwd); cd "$H"
NAME=${NAME:-s70-getstats}; ORIGIN=${ORIGIN:?}; JOIN_PATH=${JOIN_PATH:?}; CPUSET=${OBS_CPUSET:-0,6}
OUT=$H/../data/$NAME; rm -rf "$OUT"; mkdir -p "$OUT"; chmod 777 "$OUT"
docker network inspect ux-net >/dev/null 2>&1 || docker network create --subnet 172.31.0.0/24 --gateway 172.31.0.1 ux-net >/dev/null
docker rm -f ux-obs ux-obs-fwd ux-driver >/dev/null 2>&1
docker run -d --name ux-obs --network ux-net --shm-size=1g --cpuset-cpus="$CPUSET" --entrypoint /usr/bin/google-chrome znat/raw-recorder:dev \
  --headless=new --no-sandbox --remote-debugging-port=9222 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required --window-size=1280,800 --lang=ru-RU --user-data-dir=/tmp/prof-obs about:blank >/dev/null
docker run -d --name ux-obs-fwd --network container:ux-obs -v "$H":/w node:22 node /w/fwd.mjs >/dev/null
sleep 3
IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "ux-net").IPAddress}}' ux-obs)
CG=/sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' ux-obs).scope/cpu.stat
( while docker inspect ux-obs >/dev/null 2>&1; do echo "$(date +%s%3N) $(awk '/usage_usec/{print $2}' "$CG")"; sleep 2; done ) > "$OUT/cpu.log" 2>/dev/null &
docker run --rm --name ux-driver --network ux-net -v "$H":/w -v "$OUT":/out -v /root/znat/node_modules:/znat/node_modules:ro -w /w \
  -e OUT=/out -e CTL=/w/ctl -e ORIGIN="$ORIGIN" -e JOIN_PATH="$JOIN_PATH" -e CDP_s1="$IP:9223" -e PHASE_S="${PHASE_S:-60}" -e ROUNDS="${ROUNDS:-3}" \
  node:22 node s70-getstats.mjs 2>&1 | tee "$OUT/driver.log"
docker rm -f ux-obs ux-obs-fwd >/dev/null 2>&1
python3 - "$OUT" <<'PY'
import json,sys
out=sys.argv[1]
cpu=[tuple(map(int,l.split())) for l in open(out+'/cpu.log') if len(l.split())==2]
def usage(t):
    return min(cpu,key=lambda x:abs(x[0]-t))[1]
for p in json.load(open(out+'/phases.json')):
    cores=(usage(p['to'])-usage(p['from']))/1e6/((p['to']-p['from'])/1000)
    print(p['mode'],'cpu',round(cores*100,1),'% of one core','calls/s',round(p['calls']/((p['to']-p['from'])/1000),1),'videos',p['videos'],'audios',p['audios'],'rendererTaskS',p['taskS'],'scriptS',p['scriptS'])
PY
