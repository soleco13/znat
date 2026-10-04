#!/bin/bash
# Цепочка BEFORE (после закрытия моста docker: медиа только через 213.21.241.28)
cd "$(dirname "$0")"
echo $$ > ctl/chain.pid
./stand.sh run scenario.mjs before-turn SUITE=turn > /dev/null 2>&1
./stand.sh run scenario.mjs before-transitions SUITE=transitions > /dev/null 2>&1
./stand.sh run scenario.mjs before-recording SUITE=recording > /dev/null 2>&1
./stand.sh run rest.mjs before-rest > /dev/null 2>&1
./stand.sh run load.mjs before-load > /dev/null 2>&1
echo CHAIN-DONE > ../data/chain-before.done
