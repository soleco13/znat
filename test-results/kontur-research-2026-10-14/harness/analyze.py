#!/usr/bin/env python3
"""Сводка samples.jsonl по окнам: звук (дорисовано %, задержка буфера), видео (кадр/с, высота, замирания), отправка."""
import json, sys, collections
path = sys.argv[1]; WIN = int(sys.argv[2]) if len(sys.argv) > 2 else 10
rows = [json.loads(l) for l in open(path) if l.strip()]
by = collections.defaultdict(list)
for r in rows: by[r["who"]].append(r)
def deltas(seq, key, fields):
    out = []
    for a, b in zip(seq, seq[1:]):
        pa = {x["id"]: x for x in a[key]}; acc = collections.Counter()
        for x in b[key]:
            y = pa.get(x["id"])
            if not y: continue
            for f in fields:
                if x.get(f) is not None and y.get(f) is not None and x[f] >= y[f]: acc[f] += x[f] - y[f]
        acc["dt"] = (b["t"] - a["t"]) / 1000; acc["t"] = b["t"]
        out.append((acc, b))
    return out
summary = {}
for who, seq in by.items():
    seq.sort(key=lambda r: r["t"]); t0 = seq[0]["t"]
    A = deltas(seq, "inA", ["conc", "silConc", "tot", "jbd", "jbe", "lost", "rcv", "ce", "bytes"])
    V = deltas(seq, "inV", ["fd", "fz", "fzd", "bytes", "lost", "rcv"])
    O = deltas(seq, "outV", ["fe", "bytes", "enc"])
    OA = deltas(seq, "outA", ["bytes"])
    print(f"\n=== {who}  (окно {WIN} с)")
    print(" t,с | звук: дорис.% задерж.мс поте.% кбит | видео вход: к/с выс. замир. кбит | видео выход: к/с выс. огр. кбит | аудио выход кбит | RTT мс")
    tot = collections.Counter()
    for w in range(0, int((seq[-1]["t"] - t0) / 1000) + 1, WIN):
        def pick(D): return [d for d, b in D if w <= (d["t"] - t0) / 1000 < w + WIN]
        a = sum(pick(A), collections.Counter()); v = sum(pick(V), collections.Counter()); o = sum(pick(O), collections.Counter()); oa = sum(pick(OA), collections.Counter())
        bs = [b for d, b in A if w <= (d["t"] - t0) / 1000 < w + WIN] or [None]
        last = bs[-1]
        dt = a["dt"] or 1
        conc = 100 * (a["conc"] - a["silConc"]) / a["tot"] if a["tot"] else float("nan")
        jb = 1000 * a["jbd"] / a["jbe"] if a["jbe"] else float("nan")
        loss = 100 * a["lost"] / (a["lost"] + a["rcv"]) if (a["lost"] + a["rcv"]) else float("nan")
        hin = max([x.get("h") or 0 for x in (last or {}).get("inV", [])] or [0])
        hout = max([x.get("h") or 0 for x in (last or {}).get("outV", [])] or [0])
        ql = ",".join(sorted({x["ql"] for x in (last or {}).get("outV", []) if x.get("ql")}))
        rtt = ((last or {}).get("pair") or {}).get("rtt")
        print(f"{w:4d} | {conc:6.1f} {jb:6.0f} {loss:5.1f} {8*a['bytes']/dt/1000:5.0f} | {v['fd']/(v['dt'] or 1):4.1f} {hin:4d} {v['fz']:3d} {8*v['bytes']/(v['dt'] or 1)/1000:5.0f} | {o['fe']/(o['dt'] or 1):4.1f} {hout:4d} {ql:9s} {8*o['bytes']/(o['dt'] or 1)/1000:5.0f} | {8*oa['bytes']/(oa['dt'] or 1)/1000:4.0f} | {rtt*1000 if rtt else 0:4.0f}")
        tot += a; tot["vfz"] += v["fz"]; tot["vfzd"] += v["fzd"]; tot["vfd"] += v["fd"]; tot["vdt"] += v["dt"]
    summary[who] = {"audioConcealedPct": round(100 * (tot["conc"] - tot["silConc"]) / tot["tot"], 2) if tot["tot"] else None,
                    "audioJitterBufferMs": round(1000 * tot["jbd"] / tot["jbe"]) if tot["jbe"] else None,
                    "audioConcealEvents": tot["ce"], "videoFreezes": tot["vfz"], "videoFreezeSec": round(tot["vfzd"], 1),
                    "videoFpsAvg": round(tot["vfd"] / tot["vdt"], 1) if tot["vdt"] else None}
print("\nИТОГО", json.dumps(summary, ensure_ascii=False, indent=1))
