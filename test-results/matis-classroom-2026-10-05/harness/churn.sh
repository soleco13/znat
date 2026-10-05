#!/bin/bash
# Usage: churn.sh <name>  (env RECONNECTS, CYCLES, NEW_IDS) — прогон churn.mjs + подсчёт строк lesson_participants.
H=$(cd "$(dirname "$0")" && pwd); OUT=$H/results/$1; mkdir -p "$OUT"
LID=${LID:-add87950-752e-43b0-85c3-7628bbc079d5}
docker run --rm --network e2e-net -v "$H":/w -w /w -e NODE_TLS_REJECT_UNAUTHORIZED=0 -e NODE_NO_WARNINGS=1 -e OUT=/tmp \
  -e LID=$LID -e JOIN_PATH="${JOIN_PATH:-/j/0b0315665c2061b3dd9d6e9713a9b97e8cd3d13b57941c95fecda8ddec5200dc}" \
  -e RECONNECTS="${RECONNECTS:-20,100}" -e CYCLES="${CYCLES:-20}" -e NEW_IDS="${NEW_IDS:-20}" \
  node:22-bookworm-slim node churn.mjs > "$OUT/churn.json" 2> "$OUT/churn.err"
cd /root/znat
python3 - "$OUT/churn.json" "$LID" <<'PY' | tee "$OUT/rows.json"
import json, subprocess, sys
d = json.load(open(sys.argv[1])); lid = sys.argv[2]
def rows(ids):
    q = "select count(*), count(*) filter (where left_at is null) from lesson_participants where lesson_id='%s' and guest_id in (%s)" % (lid, ",".join("'%s'" % i for i in ids))
    r = subprocess.run(["docker","compose","exec","-T","postgres","psql","-U","school","-d","school_dev","-Atc",q],capture_output=True,text=True).stdout.strip().split("|")
    return {"rows": int(r[0]), "open": int(r[1])}
res = {}
for k, v in d.items():
    ids = v.get("identities") or [v["identity"]]
    res[k] = {"statuses": v["statuses"], **rows(ids)}
print(json.dumps(res, ensure_ascii=False))
PY
