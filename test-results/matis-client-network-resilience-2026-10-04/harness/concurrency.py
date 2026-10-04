#!/usr/bin/env python3
"""Параллельность загрузок на странице входа: requests-<PROFILE>.json (load.mjs DEBUG=1).
Использование: concurrency.py <data-dir> [PROFILE]"""
import json, sys, collections
d, prof = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "HORRIBLE")
R = json.load(open(f"{d}/requests-{prof}.json"))
assets = [r for r in R if r["u"].startswith("/assets/") and r.get("type") == "Fetch"]
end = max((r["endS"] or 1e9) for r in R if r.get("endS")) if R else 0
def overlap(rs):
    ev = []
    for r in rs:
        ev.append((r["startS"], 1)); ev.append((r["endS"] if r["endS"] is not None else 1e9, -1))
    cur = mx = 0
    for _, k in sorted(ev, key=lambda x: (x[0], x[1])):
        cur += k; mx = max(mx, cur)
    return mx
entry = [r for r in R if r["m"] == "POST" and r["u"].startswith("/api/v1/j/")]
during = []
for e in entry:
    s, t = e["startS"], e["endS"] if e["endS"] is not None else 1e9
    during.append(sum(1 for a in assets if a["startS"] < t and (a["endS"] or 1e9) > s))
print(json.dumps({
    "chunkFetches": len(assets),
    "maxConcurrentChunkFetches": overlap(assets),
    "chunkPriorities": dict(collections.Counter(a.get("prio") for a in assets)),
    "entryPost": [{"startS": e["startS"], "endS": e["endS"], "fail": e.get("fail"), "prio": e.get("prio"), "chunkFetchesInFlightDuring": n} for e, n in zip(entry, during)],
}, ensure_ascii=False, indent=1))
