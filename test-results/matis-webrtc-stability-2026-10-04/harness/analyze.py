#!/usr/bin/env python3
"""Сводка прогона: python3 analyze.py results/<run>"""
import json, sys, re, statistics as st
from collections import Counter, defaultdict

D = sys.argv[1]
samples = [json.loads(l) for l in open(f"{D}/samples.jsonl")]
events = [json.loads(l) for l in open(f"{D}/events.jsonl")]
summary = json.load(open(f"{D}/summary.json"))
T0 = summary["T0"]
marks = {m["text"]: m["t"] for m in summary["timeline"]}
long_start = next((t for k, t in marks.items() if k.startswith("long session start")), None)
long_end = marks.get("long session end")

def pct(vals, p):
    vals = sorted(v for v in vals if v is not None)
    if not vals: return None
    return vals[min(len(vals) - 1, int(round(p / 100 * (len(vals) - 1))))]

def agg(vals):
    vals = [v for v in vals if v is not None]
    if not vals: return None
    return {"n": len(vals), "min": min(vals), "median": pct(vals, 50), "p95": pct(vals, 95), "max": max(vals)}

def window(ss, a, b):
    return [s for s in ss if (a is None and b is None) or ("t" in s and (a is None or s["t"] >= a) and (b is None or s["t"] <= b))]

out = {}
for scope, (a, b) in {"long": (long_start, long_end), "all": (None, None)}.items():
    res = {}
    for who in ("teacher", "student"):
        ss = window([s for s in samples if s.get("who") == who], a, b)
        r = {"samples": len(ss), "sampleErrors": sum(1 for s in ss if "error" in s)}
        r["notConnected"] = sum(1 for s in ss if s.get("conn") not in ("connected", None) or ("error" not in s and s.get("conn") is None))
        r["connStates"] = dict(Counter(s.get("conn") for s in ss))
        r["rttMs"] = agg([s.get("rttMs") for s in ss])
        r["outBwKbps"] = agg([s.get("outBwKbps") for s in ss])
        r["pairs"] = dict(Counter(s.get("pair") for s in ss if s.get("pair")))
        r["outAudioKbps"] = agg([s.get("out", {}).get("audio", {}).get("kbps") for s in ss if s.get("out")])
        r["outVideoKbps"] = agg([s.get("out", {}).get("video", {}).get("kbps") for s in ss if s.get("out")])
        ql = Counter()
        for s in ss:
            for l in (s.get("out", {}).get("video", {}) or {}).get("layers", []):
                m = re.search(r"\[(\w+)\]", l)
                if m: ql[m.group(1)] += 1
        r["qualityLimitation"] = dict(ql)
        for kind in ("audio", "video"):
            inb = [i for s in ss for i in s.get("inb", []) if i["kind"] == kind]
            pk = sum(i["pkts"] or 0 for i in inb if i["pkts"] is not None and i["pkts"] >= 0)
            lost = sum(i["lost"] or 0 for i in inb if i["lost"] is not None and i["lost"] >= 0)
            k = {"kbps": agg([i["kbps"] for i in inb if i["kbps"] is not None and i["kbps"] >= 0]),
                 "packets": pk, "lost": lost, "lossPct": round(100 * lost / (pk + lost), 3) if pk + lost else None,
                 "jitterMs": agg([i["jitterMs"] for i in inb]),
                 "lossSpikes": sum(1 for i in inb if i["pkts"] and i["lost"] and i["lost"] / (i["pkts"] + i["lost"]) > 0.02)}
            if kind == "video":
                cams = [i for i in inb if i.get("fps") is not None]
                k["fps"] = agg([i["fps"] for i in cams])
                k["res"] = dict(Counter(i["res"] for i in inb if i["res"]).most_common(6))
                # фризы: максимум счётчика по каждому треку
                # фризы внутри окна: прирост счётчика по каждому треку (last - first)
                first, last = {}, {}
                for i in inb:
                    if i.get("freezes") is not None:
                        first.setdefault(i["track"], (i["freezes"], i["freezeDur"] or 0))
                        last[i["track"]] = (i["freezes"], i["freezeDur"] or 0)
                k["freezeCount"] = sum(max(0, last[t][0] - first[t][0]) for t in last)
                k["freezeSec"] = round(sum(max(0, last[t][1] - first[t][1]) for t in last), 2)
                k["zeroFrameSamples"] = sum(1 for i in inb if i["framesDecoded"] == 0)
            else:
                k["concealedPct"] = agg([i["concealedPct"] for i in inb])
                k["silentSamples"] = sum(1 for i in inb if (i["kbps"] or 0) < 5)
            r["in_" + kind] = k
        # видео-элементы: удалённые кадры двигаются
        stall = 0; tot = 0
        for s in ss:
            for v in s.get("videos", []) or []:
                if not v["local"] and v["src"] == "camera" and v["adv"] is not None:
                    tot += 1; stall += v["adv"] == 0
        r["remoteCamElementStalls"] = f"{stall}/{tot}"
        res[who] = r
    lk = window([s for s in samples if s.get("who") == "livekit"], a, b)
    res["livekit"] = {"samples": len(lk), "maxParticipants": max((len(s.get("list", [])) for s in lk), default=0),
                      "duplicateSamples": sum(1 for s in lk if s.get("dup")),
                      "counts": dict(Counter(len(s.get("list", [])) for s in lk)), "errors": sum(1 for s in lk if s.get("error"))}
    out[scope] = res

# События
ev = Counter(); urls = Counter()
for e in window(events, None, None):
    k = e["kind"]
    if k in ("console.error", "exception", "http4xx", "http5xx", "net.fail", "ws.error", "browser.log", "CRASH", "ui.miss"):
        key = (e.get("who"), k)
        txt = e.get("text") or ""
        if "esm.sh" in (e.get("url") or "") or "esm.sh" in txt:
            key = (e.get("who"), k + " [esm.sh fonts]")
        ev[key] += 1
        if k in ("http4xx", "http5xx", "net.fail") and "esm.sh" not in (e.get("url") or ""):
            urls[(e.get("who"), k, e.get("status"), re.sub(r"[0-9a-f-]{36}", ":id", (e.get("url") or "").split("?")[0]))] += 1
        if k in ("exception", "console.error") :
            urls[(e.get("who"), k, None, txt[:140])] += 1
ws = Counter((e.get("who"), e["kind"], ("lk" if "/livekit/" in (e.get("url") or "") else "room" if "/ws?" in (e.get("url") or "") else "collab" if "/collab" in (e.get("url") or "") else "other")) for e in events if e["kind"] in ("ws.created", "ws.closed", "ws.error"))
pcs = Counter((e.get("who"), e["kind"], e.get("text", "").split("=")[-1]) for e in events if e["kind"] in ("pc.conn", "pc.ice"))
out["events"] = {"byKind": {f"{a}|{b}": c for (a, b), c in ev.items()}, "details": [list(k) + [c] for k, c in urls.most_common(40)],
                 "ws": {f"{a}|{b}|{c}": n for (a, b, c), n in ws.items()}, "pcStates": {f"{a}|{b}|{c}": n for (a, b, c), n in pcs.items()}}
out["checks"] = {"total": len(summary["checks"]), "failed": [c for c in summary["checks"] if not c["ok"]]}
out["results"] = summary["results"]
json.dump(out, open(f"{D}/analysis.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1)[:20000])
