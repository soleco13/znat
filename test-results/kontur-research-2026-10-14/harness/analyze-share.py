#!/usr/bin/env python3
"""Сводка сценария демонстрации по фазам: звук ведущего (a) у зрителя (b), захват микрофона у ведущего, отправка ведущего."""
import json, sys, collections
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
by = collections.defaultdict(list)
for r in rows: by[r["who"]].append(r)
for k in by: by[k].sort(key=lambda r: r["t"])
def pairs(seq):
    return list(zip(seq, seq[1:]))
def sumdelta(a, b, key, f):
    pa = {x["id"]: x for x in a.get(key, [])}; tot = 0
    for x in b.get(key, []):
        y = pa.get(x["id"])
        if y and x.get(f) is not None and y.get(f) is not None and x[f] >= y[f]: tot += x[f] - y[f]
    return tot
res = collections.OrderedDict()
for a, b in pairs(by["b"]):
    ph = b.get("phase", "?"); d = res.setdefault(ph, collections.Counter())
    d["conc"] += sumdelta(a, b, "inA", "conc") - sumdelta(a, b, "inA", "silConc"); d["tot"] += sumdelta(a, b, "inA", "tot")
    d["jbd"] += sumdelta(a, b, "inA", "jbd"); d["jbe"] += sumdelta(a, b, "inA", "jbe")
    d["ce"] += sumdelta(a, b, "inA", "ce"); d["lost"] += sumdelta(a, b, "inA", "lost"); d["rcv"] += sumdelta(a, b, "inA", "rcv")
    d["abytes"] += sumdelta(a, b, "inA", "bytes"); d["dt"] += (b["t"] - a["t"]) / 1000
for a, b in pairs(by["a"]):
    ph = b.get("phase", "?"); d = res.setdefault(ph, collections.Counter())
    d["cap"] += sumdelta(a, b, "srcA", "dur"); d["capwall"] += (b["t"] - a["t"]) / 1000
    d["vbytes"] += sumdelta(a, b, "outV", "bytes"); d["vdt"] += (b["t"] - a["t"]) / 1000
    d["hidden"] += 1 if b.get("vis") == "hidden" else 0; d["n"] += 1
    for o in b.get("outV", []):
        if o.get("ql") and o["ql"] != "none": d["ql_" + o["ql"]] += 1
print(f"{'фаза':16s} | звук ведущего у зрителя: дорис.% задерж.мс поте.% события кбит | захват мик. % | видео ведущего кбит | вкладка скрыта | огранич.")
for ph, d in res.items():
    conc = 100 * d["conc"] / d["tot"] if d["tot"] else float("nan")
    jb = 1000 * d["jbd"] / d["jbe"] if d["jbe"] else float("nan")
    loss = 100 * d["lost"] / (d["lost"] + d["rcv"]) if d["lost"] + d["rcv"] else float("nan")
    cap = 100 * d["cap"] / d["capwall"] if d["capwall"] else float("nan")
    ql = ",".join(f"{k[3:]}:{v}" for k, v in d.items() if k.startswith("ql_"))
    print(f"{ph:16s} | {conc:6.1f} {jb:6.0f} {loss:5.1f} {d['ce']:5d} {8*d['abytes']/(d['dt'] or 1)/1000:5.0f} | {cap:6.1f} | {8*d['vbytes']/(d['vdt'] or 1)/1000:6.0f} | {d['hidden']}/{d['n']} | {ql}")
