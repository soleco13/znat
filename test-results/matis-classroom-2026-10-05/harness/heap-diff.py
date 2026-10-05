#!/usr/bin/env python3
"""Сравнение двух heap snapshot по конструкторам: число объектов и self size."""
import json, sys
from collections import defaultdict

def agg(path):
    s = json.load(open(path)); m = s["snapshot"]["meta"]; nf = m["node_fields"]; L = len(nf)
    it, iname, isz = nf.index("type"), nf.index("name"), nf.index("self_size")
    types = m["node_types"][0]; nodes = s["nodes"]; strings = s["strings"]
    cnt, size = defaultdict(int), defaultdict(int)
    total = 0
    for k in range(0, len(nodes), L):
        t = types[nodes[k + it]]
        if t in ("hidden", "synthetic", "code", "concatenated string", "sliced string"):
            continue
        key = f"{t}:{strings[nodes[k + iname]][:60]}" if t in ("object", "native", "closure") else t
        cnt[key] += 1; size[key] += nodes[k + isz]; total += nodes[k + isz]
    return cnt, size, total

c1, s1, t1 = agg(sys.argv[1]); c2, s2, t2 = agg(sys.argv[2])
print(f"total self size: {t1/1e6:.2f} MB -> {t2/1e6:.2f} MB")
rows = sorted(set(s1) | set(s2), key=lambda k: -(s2.get(k, 0) - s1.get(k, 0)))
for k in rows[:25]:
    print(f"{(s2.get(k,0)-s1.get(k,0))/1024:9.1f} KB  {c2.get(k,0)-c1.get(k,0):+7d}  {k}")
