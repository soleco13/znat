#!/bin/bash
# AFTER: тот же стенд и сценарии, что BEFORE (chain-before*.sh), сборка 4e29a38.
cd "$(dirname "$0")"
echo $$ > .secrets/chain-after.pid
run() { ./stand.sh run "$@" > /dev/null 2>&1; echo "$(date -u +%T) done $2" >> ../data/chain-after.log; }
run scenario.mjs after-matrix SUITE=matrix
run scenario.mjs after-transitions SUITE=transitions ONLY=A,B,C,D,E,F,G,H,W,R
run scenario.mjs after-turn SUITE=turn
run scenario.mjs after-recording SUITE=recording
run rest.mjs after-rest
run load.mjs after-load
run load.mjs after-load-horrible-debug PROFILES=HORRIBLE DEBUG=1
run scenario.mjs after-long SUITE=long PHASE_MIN=5 CYCLES=2 MAX_MIN=32
echo DONE > ../data/chain-after.done
