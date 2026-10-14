#!/bin/bash
D=/root/znat/test-results/kontur-research-2026-10-14/data/live-phone; cd /root/znat/test-results/kontur-research-2026-10-14/harness
S=$(cat sample.js)
while [ -f $D/phase ]; do ph=$(cat $D/phase)
  ./kt.sh call a /eval "$S" | python3 -c "import sys,json; print(json.dumps({'who':'a','phase':'$ph', **json.loads(json.loads(sys.stdin.read()))}))" >> $D/teacher.jsonl 2>/dev/null
  sleep 2; done
