#!/bin/bash
# Вторая цепочка BEFORE: REST (перемер), сценарий R, длительная деградация.
cd "$(dirname "$0")"
echo $$ > ctl/chain2.pid
while [ ! -f ../data/chain-before.done ]; do sleep 10; done
# контроллер сети с новым режимом tcp443rst
for p in $(ps -eo pid,args | awk '$2=="python3" && $3=="netctl.py"{print $1}'); do kill $p; done; sleep 1
TPID=$(docker inspect -f '{{.State.Pid}}' e2e-teacher); SPID=$(docker inspect -f '{{.State.Pid}}' e2e-student)
setsid nohup python3 netctl.py "$PWD/ctl" teacher=$TPID student=$SPID > ctl/netctl.out 2>&1 &
sleep 1
./stand.sh run rest.mjs before-rest > /dev/null 2>&1
./stand.sh run scenario.mjs before-R SUITE=transitions ONLY=R > /dev/null 2>&1
./stand.sh run scenario.mjs before-long SUITE=long PHASE_MIN=5 CYCLES=2 > /dev/null 2>&1
echo DONE > ../data/chain-before2.done
