#!/usr/bin/env python3
"""Разбор samples.jsonl/events.jsonl одного прогона → analysis.json + краткая таблица в stdout.
Использование: analyze.py <data-dir>"""
import json, sys, statistics as st
from collections import defaultdict

D = sys.argv[1]
samples = [json.loads(l) for l in open(f"{D}/samples.jsonl")]
events = [json.loads(l) for l in open(f"{D}/events.jsonl")]


def pct(a, p):
    a = sorted(x for x in a if x is not None)
    if not a:
        return None
    return a[min(len(a) - 1, int(round(p / 100 * (len(a) - 1))))]


def med(a):
    a = [x for x in a if x is not None]
    return round(st.median(a), 1) if a else None


by_tag = defaultdict(lambda: {"teacher": [], "student": [], "livekit": []})
for s in samples:
    by_tag[s.get("tag") or "-"][s["who"]].append(s)

out = {}
for tag, g in by_tag.items():
    r = {}
    for who in ("teacher", "student"):
        ss = [s for s in g[who] if not s.get("error")]
        if not ss:
            continue
        inb_a = [i for s in ss for i in s.get("inb", []) if i["kind"] == "audio"]
        inb_v = [i for s in ss for i in s.get("inb", []) if i["kind"] == "video"]
        # приём складываем по потокам за сэмпл
        a_kbps = [sum((i["kbps"] or 0) for i in s.get("inb", []) if i["kind"] == "audio") for s in ss]
        v_kbps = [sum((i["kbps"] or 0) for i in s.get("inb", []) if i["kind"] == "video") for s in ss]
        r[who] = {
            "n": len(ss),
            "rttMs": {"med": med([s.get("rttMs") for s in ss]), "p95": pct([s.get("rttMs") for s in ss], 95), "max": max([s.get("rttMs") or 0 for s in ss])},
            "jitterAudioMs": {"med": med([i["jitterMs"] for i in inb_a]), "p95": pct([i["jitterMs"] for i in inb_a], 95)},
            "jitterVideoMs": {"med": med([i["jitterMs"] for i in inb_v]), "p95": pct([i["jitterMs"] for i in inb_v], 95)},
            "lossAudioPct": {"med": med([i["lossPct"] for i in inb_a]), "p95": pct([i["lossPct"] for i in inb_a], 95)},
            "lossVideoPct": {"med": med([i["lossPct"] for i in inb_v]), "p95": pct([i["lossPct"] for i in inb_v], 95)},
            "inAudioKbps": {"med": med(a_kbps), "min": min(a_kbps)},
            "inVideoKbps": {"med": med(v_kbps), "min": min(v_kbps)},
            "outAudioKbps": med([s.get("out", {}).get("audio", {}).get("kbps") for s in ss]),
            "outVideoKbps": med([s.get("out", {}).get("video", {}).get("kbps") for s in ss]),
            "outBwKbps": med([s.get("outBwKbps") for s in ss]),
            "inFps": med([i["fps"] for i in inb_v if i["fps"]]),
            "inRes": sorted({i["res"] for i in inb_v if i["res"]}),
            "framesDropped": sum((i.get("dropped") or 0) for i in inb_v),
            "freezes": sum((i.get("freezes") or 0) for i in inb_v),
            "concealedAudioPct": med([i.get("concealedPct") for i in inb_a]),
            "outLayers": sorted({l for s in ss for l in s.get("out", {}).get("video", {}).get("layers", [])})[:8],
            "pair": sorted({s.get("pair") for s in ss if s.get("pair")}),
            "maxRoomWs": max(s.get("ws", []).count("room") for s in ss),
            "maxLkWs": max(s.get("ws", []).count("lk") for s in ss),
            "maxPcs": max(len(s.get("pcs", [])) for s in ss),
            "heapMB": [ss[0].get("mem", {}).get("heapMB"), ss[-1].get("mem", {}).get("heapMB")],
            "listeners": [ss[0].get("mem", {}).get("listeners"), ss[-1].get("mem", {}).get("listeners")],
            "nodes": [ss[0].get("mem", {}).get("nodes"), ss[-1].get("mem", {}).get("nodes")],
            "uiQuality": sorted({q for s in ss for q in (s.get("ui") or {}).get("quality", [])}),
            "uiOverlay": sum(1 for s in ss if (s.get("ui") or {}).get("overlayReconnect")),
            "uiPill": sum(1 for s in ss if (s.get("ui") or {}).get("pill")),
            "uiLkWarn": sum(1 for s in ss if (s.get("ui") or {}).get("lkWarn")),
        }
        # «UI молчит, медиа нет»: ≥3 сэмплов подряд (15 с) без входящего звука, а предупреждений нет
        silent, run, worst = [], 0, 0
        for s in ss:
            a = sum((i["kbps"] or 0) for i in s.get("inb", []) if i["kind"] == "audio")
            ui = s.get("ui") or {}
            warned = ui.get("overlayReconnect") or ui.get("pill") or ui.get("lkWarn") or any("ПОТЕР" in q.upper() or "ПЛОХ" in q.upper() for q in ui.get("quality", []))
            if a < 4 and not warned:
                run += 1
                worst = max(worst, run)
                if run == 3:
                    silent.append(s["rel"])
            else:
                run = 0
        r[who]["silentMediaLoss"] = {"episodes": silent, "longestSec": worst * 5}
    lk = g["livekit"]
    if lk:
        r["livekit"] = {"dupSamples": sum(1 for x in lk if x.get("dup")), "maxParticipants": max(len(x.get("list", [])) for x in lk),
                        "states": sorted({p["state"] for x in lk for p in x.get("list", [])})}
    out[tag] = r

ev = defaultdict(int)
for e in events:
    k = e.get("kind")
    if k in ("exception", "CRASH", "http5xx", "net.fail", "ws.created", "ws.closed", "console.error", "INJECT"):
        ev[f"{e.get('who','')}:{k}"] += 1
tele = defaultdict(int)
for e in events:
    if e.get("kind") == "tele":
        tele[f"{e['who']}:{e.get('type')}"] += 1
rest = defaultdict(list)
for e in events:
    if e.get("kind") == "rest":
        rest[f"{e.get('method')} {e.get('url')}"].append(e.get("ms"))
rest_sum = {k: {"n": len(v), "medMs": med(v), "maxMs": max(v)} for k, v in rest.items() if len(v) >= 1}
fails = [e for e in events if e.get("kind") in ("net.fail", "http5xx", "exception", "CRASH")]
res = {"rounds": out, "eventCounts": dict(ev), "telemetry": dict(tele), "rest": rest_sum, "failures": [{k: e.get(k) for k in ("rel", "who", "kind", "text", "url", "method", "ms", "status")} for e in fails][:200]}
json.dump(res, open(f"{D}/analysis.json", "w"), ensure_ascii=False, indent=1)

for tag, r in out.items():
    s, t = r.get("student", {}), r.get("teacher", {})
    if not s:
        continue
    print(f"{tag:22} RTT s={s['rttMs']['med']}/{s['rttMs']['p95']} t={t.get('rttMs',{}).get('med')} | loss a/v s={s['lossAudioPct']['med']}/{s['lossVideoPct']['med']} "
          f"| in a/v s={s['inAudioKbps']['med']}/{s['inVideoKbps']['med']} t={t.get('inAudioKbps',{}).get('med')}/{t.get('inVideoKbps',{}).get('med')} "
          f"| out v t={t.get('outVideoKbps')} s={s.get('outVideoKbps')} | fps s={s['inFps']} {s['inRes'][:3]} | silentLoss s={s['silentMediaLoss']['longestSec']}s t={t.get('silentMediaLoss',{}).get('longestSec')}s "
          f"| ui q={s['uiQuality']} ov={s['uiOverlay']} | ws room max={s['maxRoomWs']}/{t.get('maxRoomWs')}")
print(json.dumps(dict(ev), ensure_ascii=False))
print(json.dumps(dict(tele), ensure_ascii=False))
