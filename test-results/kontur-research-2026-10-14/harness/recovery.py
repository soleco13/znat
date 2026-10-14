#!/usr/bin/env python3
"""Время возврата видео у «Елены» (b) после провала канала (сеть вернулась на t=150 с)
и средние за прогон. recovery.py <samples.jsonl>..."""
import json, sys, collections
def load(p):
    rows = [json.loads(l) for l in open(p) if l.strip()]
    b = sorted([r for r in rows if r["who"] == "b"], key=lambda r: r["t"])
    t0 = b[0]["t"]; pts = []
    for x, y in zip(b, b[1:]):
        px = {v["id"]: v for v in x["inV"]}; fd = 0
        for v in y["inV"]:
            if v["id"] in px and v["fd"] >= px[v["id"]]["fd"]: fd += v["fd"] - px[v["id"]]["fd"]
        pts.append(((y["t"] - t0) / 1000, fd / ((y["t"] - x["t"]) / 1000)))
    return pts
for p in sys.argv[1:]:
    pts = load(p)
    rec = None
    for i, (t, f) in enumerate(pts):
        if t < 150: continue
        win = [ff for tt, ff in pts if t <= tt < t + 10]
        if win and min(win) >= 15: rec = round(t - 150); break
    base = [f for t, f in pts if t < 60]; after = [f for t, f in pts if t >= 150]
    print(f"{p.split('/')[-2]:28s} возврат≥15к/с: {('%d с' % rec) if rec is not None else 'нет':>6}  к/с до сбоев {sum(base)/len(base):5.1f}  после провала {sum(after)/len(after):5.1f}  весь прогон {sum(f for _,f in pts)/len(pts):5.1f}")
