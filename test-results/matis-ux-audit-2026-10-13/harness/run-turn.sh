#!/bin/bash
# T7 на стенде: MODE=noudp|only443. iptables в netns ux-s2, LiveKit стенда с TURN turn-test (172.31.0.60, TCP 443).
set -u; H=$(cd "$(dirname "$0")" && pwd); cd "$H"; MODE=${MODE:-noudp}; NAME=${NAME:-s26-turn-$MODE}
rm -f ctl/start-shape
./stand.sh run s26-turn.mjs $NAME MODE=$MODE > /dev/null 2>&1 &
DRV=$!
until [ -f ctl/start-shape ] || ! kill -0 $DRV 2>/dev/null; do sleep 0.5; done
PID=$(docker inspect -f '{{.State.Pid}}' ux-s2); NS="nsenter -t $PID -n"
$NS iptables -F OUTPUT
case $MODE in
  noudp) $NS iptables -A OUTPUT -p udp -j DROP;;
  only443) $NS iptables -A OUTPUT -o lo -j ACCEPT
    $NS iptables -A OUTPUT -p tcp -m state --state ESTABLISHED,RELATED -j ACCEPT
    $NS iptables -A OUTPUT -p tcp -d 172.31.0.1 --dport 3100 -j ACCEPT   # «сайт на 443»
    $NS iptables -A OUTPUT -p tcp -d 172.31.0.50 --dport 7880 -j ACCEPT  # «сигнализация на 443»
    $NS iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
    $NS iptables -A OUTPUT -j DROP;;
esac
$NS iptables -S OUTPUT > ../data/$NAME.iptables.txt 2>&1
wait $DRV
$NS iptables -F OUTPUT
OUT=../data/$NAME; cp ../data/$NAME.iptables.txt $OUT/iptables.txt 2>/dev/null
grep -E "CHECK|CHECKS|MARK" $OUT/driver.log | tail -8 | cut -c1-200
grep -o '"clientEvent":"media_path"[^}]*' $OUT/app.log | grep -o '"localType":"[a-z]*","protocol":"[a-z]*","relayProtocol":[^,]*' | sort | uniq -c
