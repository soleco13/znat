#!/bin/bash
# Контур Толк: демонстрация у слабого ведущего (kt-b: CPU $CPU, сеть shape.py share), зритель — kt-a.
# В samples ведущий записан как a, зритель — как b (как в s21-share Матиса).
H=$(cd "$(dirname "$0")" && pwd); cd "$H"
OUT=${OUT:-$H/../data/kontur-share}; CPU=${CPU:-0.5}; mkdir -p "$OUT"; rm -f "$OUT/samples.jsonl"
waitfor() { for i in $(seq 1 90); do [ "$(./kt.sh call $1 /eval "$2" 2>/dev/null)" = true ] && return 0; sleep 1; done; echo "timeout $1 $2" >> "$OUT/join.log"; }
join() {
  ./kt.sh call $1 /goto https://shkola10.ktalk.ru/d6l33r25uec0 >/dev/null
  waitfor $1 '!!document.querySelector("input")'
  ./kt.sh call $1 /click 'document.querySelector("input")' >/dev/null; ./kt.sh call $1 /type "Матис-демо $1" >/dev/null
  ./kt.sh call $1 /click '[...document.querySelectorAll("button")].find(b=>/Continue/.test(b.textContent))' >/dev/null
  waitfor $1 '!![...document.querySelectorAll("button")].find(b=>/Join the conference/.test(b.textContent))'; sleep 3
  ./kt.sh call $1 /click '[...document.querySelectorAll("button")].find(b=>/Join the conference/.test(b.textContent))' >/dev/null
  waitfor $1 '(window.__pcs||[]).some(p=>p.connectionState==="connected")'
}
./kt.sh down a; ./kt.sh down b; ./kt.sh up a >/dev/null; ./kt.sh up b $CPU >/dev/null
join a; join b; sleep 10
PID=$(docker inspect -f "{{.State.Pid}}" ${SHAPED:-kt-b})
python3 shape.py $PID ${SHAPE:-share} > "$OUT/shape.log" 2>&1 &
S=$(cat sample.js); PHASE=1-no-share; echo $PHASE > "$OUT/phase"
( while [ -f "$OUT/phase" ]; do ph=$(cat "$OUT/phase" 2>/dev/null)
    ./kt.sh call b /eval "$S" | python3 -c "import sys,json; print(json.dumps({'who':'a','phase':'$ph', **json.loads(json.loads(sys.stdin.read()))}))" >> "$OUT/samples.jsonl" 2>/dev/null &
    ./kt.sh call a /eval "$S" | python3 -c "import sys,json; print(json.dumps({'who':'b','phase':'$ph', **json.loads(json.loads(sys.stdin.read()))}))" >> "$OUT/samples.jsonl" 2>/dev/null &
    sleep 2; done ) &
sleep 30; echo 2-share > "$OUT/phase"
./kt.sh call b /click '[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Start screen sharing")' > "$OUT/share-click.txt"
sleep 40; echo 3-share-hidden > "$OUT/phase"
./kt.sh call b /heavy "data:text/html;base64,$(base64 -w0 heavy.html)" >/dev/null; sleep 1.5
./kt.sh call b /eval 'document.visibilityState' > "$OUT/vis.txt"
sleep 60; echo 4-back > "$OUT/phase"
./kt.sh call b /front >/dev/null
sleep 30; rm -f "$OUT/phase"; sleep 3
./kt.sh call b /eval 'JSON.stringify(window.__sdp.filter(x=>x.m==="setParameters"||x.m==="applyConstraints").slice(-6))' > "$OUT/params.json"
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' kt-a kt-b > "$OUT/cpu.txt"
pkill -f "shape.py $PID" 2>/dev/null; python3 shape.py $PID clear >/dev/null 2>&1
echo done
