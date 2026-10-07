#!/bin/bash
cd "$(dirname "$0")"
for P in none fast4g slow4g 3g slow3g; do PROFILE=$P ./run.sh > results/$P.log 2>&1; done
PROFILE=slow4g CPU=4 ./run.sh > results/slow4g-cpu4.log 2>&1
for P in slow3g 3g slow4g; do PROFILE=$P PAGES=classroom,student BOARD=0 FASTJOIN=1 ./run.sh > results/$P-fastjoin.log 2>&1; done
touch results/ALL_DONE
