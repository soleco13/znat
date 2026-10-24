#!/bin/bash
# 2026-10-24: геометрия плиток Толка (пропорции, место карточки «один в комнате») на разных окнах.
H=$(cd "$(dirname "$0")" && pwd); cd "$H"; OUT=$H/../data/kontur-tiles; mkdir -p "$OUT"
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
case "$1" in
join) ./kt.sh up $2 >/dev/null; join $2 ;;
size) ./kt.sh call $2 /cdp "{\"m\":\"Emulation.setDeviceMetricsOverride\",\"p\":{\"width\":$3,\"height\":$4,\"deviceScaleFactor\":1,\"mobile\":false}}" >/dev/null; sleep 2
      ./kt.sh call $2 /shot "$5-$3x$4" >/dev/null; mkdir -p "$OUT/shots"; cp ../data/$2/shots/$5-$3x$4.png "$OUT/shots/" ;;
esac
