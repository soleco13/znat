#!/bin/bash
# Контур Толк в условиях Елены: a — обычный ПК и сеть, b — «Елена» (CPU $CPU ядер i7-8700, сеть по shape.py).
H=$(cd "$(dirname "$0")" && pwd); cd "$H"
OUT=${OUT:-$H/../data/kontur-elena}; CPU=${CPU:-1.2}; SHAPE=${SHAPE:-elena}
mkdir -p "$OUT"
waitfor() { for i in $(seq 1 90); do [ "$(./kt.sh call $1 /eval "$2" 2>/dev/null)" = true ] && return 0; sleep 1; done; echo "timeout $1 $2" >> "$OUT/join.log"; }
join() { # $1 name
  ./kt.sh call $1 /goto https://shkola10.ktalk.ru/d6l33r25uec0 >/dev/null
  waitfor $1 '!!document.querySelector("input")'
  ./kt.sh call $1 /click 'document.querySelector("input")' >/dev/null; ./kt.sh call $1 /type "Матис-исследование $1" >/dev/null
  ./kt.sh call $1 /click '[...document.querySelectorAll("button")].find(b=>/Continue/.test(b.textContent))' >/dev/null
  waitfor $1 '!![...document.querySelectorAll("button")].find(b=>/Join the conference/.test(b.textContent))'; sleep 3
  ./kt.sh call $1 /click '[...document.querySelectorAll("button")].find(b=>/Join the conference/.test(b.textContent))' >/dev/null
  waitfor $1 '(window.__pcs||[]).some(p=>p.connectionState==="connected")'
  echo "$1 joined at $(date +%T)" >> "$OUT/join.log"
}
./kt.sh down a; ./kt.sh down b
./kt.sh up a >/dev/null; ./kt.sh up b $CPU >/dev/null
join a; join b; sleep 25
PID=$(docker inspect -f '{{.State.Pid}}' kt-b)
S=$(cat sample.js)
( [ "$SHAPE" = none ] || python3 shape.py $PID $SHAPE > "$OUT/shape.log" 2>&1 ) &
for i in $(seq 1 125); do
  for n in a b; do ./kt.sh call $n /eval "$S" | python3 -c "import sys,json; print(json.dumps({'who':'$n', **json.loads(json.loads(sys.stdin.read()))}))" >> "$OUT/samples.jsonl" 2>/dev/null & done
  sleep 2
done
wait
./kt.sh call b /shot elena-end >/dev/null; ./kt.sh call a /shot partner-end >/dev/null
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' kt-a kt-b > "$OUT/cpu.txt"
echo done
