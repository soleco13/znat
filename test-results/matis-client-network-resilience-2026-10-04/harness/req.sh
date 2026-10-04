#!/bin/bash
# req.sh '<json>' — запрос к netctl.py с хоста
D=$(cd "$(dirname "$0")" && pwd)/ctl; id=$(date +%s%N); echo "$1" > $D/$id.req
for i in $(seq 1 300); do [ -f $D/$id.res ] && { cat $D/$id.res; rm $D/$id.res; echo; exit 0; }; sleep 0.1; done; echo TIMEOUT
