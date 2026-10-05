#!/usr/bin/env python3
"""Сводка прогона: фазы → браузер учителя + сервер. python3 analyze.py results/<run>"""
import json, re, sys, statistics as st
from pathlib import Path

R = Path(sys.argv[1])
S = json.loads((R / "summary.json").read_text())
perf = json.loads((R / "perf.json").read_text()) if (R / "perf.json").exists() else []
host = [json.loads(l) for l in (R / "host.jsonl").read_text().splitlines() if l.strip()]
events = [json.loads(l) for l in (R / "events.jsonl").read_text().splitlines() if l.strip()]
phases = [(e["t"], e["text"].replace("PHASE ", "")) for e in events if e["kind"] == "MARK" and e["text"].startswith("PHASE")]


def phase_at(t):
    cur = None
    for pt, name in phases:
        if pt <= t:
            cur = name
    return cur


def cpu(entry, name):
    m = re.search(re.escape(name) + r"=([\d.]+)%=([\d.]+)(MiB|GiB)", entry.get("docker", ""))
    if not m:
        return None, None
    mem = float(m.group(2)) * (1024 if m.group(3) == "GiB" else 1)
    return float(m.group(1)), mem


def host_by_phase():
    out = {}
    for h in host:
        p = phase_at(h["t"])
        if not p:
            continue
        o = out.setdefault(p, {"n": 0, "load": [], "lk": [], "app": [], "pg": [], "redis": [], "teacher": [], "teacherMem": [], "driver": [], "s1": [], "evlag": [], "pgconn": [], "mem": []})
        o["n"] += 1
        o["load"].append(float(h["load"].split()[0]))
        for key, name in [("lk", "znat-livekit-1"), ("app", "znat-app-1"), ("pg", "znat-postgres-1"), ("redis", "znat-redis-1"), ("teacher", "cls-teacher"), ("driver", "cls-driver"), ("s1", "cls-s1")]:
            c, m = cpu(h, name + ";") if False else cpu(h, name)
            if c is not None:
                o[key].append(c)
                if key == "teacher":
                    o["teacherMem"].append(m)
        app = h.get("app", "").split("|")
        if app and app[0]:
            try:
                o["evlag"].append(float(app[0]) * 1000)
            except ValueError:
                pass
        if h.get("pg"):
            o["pgconn"].append(int(h["pg"].split("/")[0]))
        o["mem"].append(int(h["mem"].split("/")[0]))
    res = {}
    for p, o in out.items():
        f = lambda xs: round(st.mean(xs), 1) if xs else None
        mx = lambda xs: round(max(xs), 1) if xs else None
        res[p] = {"samples": o["n"], "loadAvg1": f(o["load"]), "livekitCpu": f(o["lk"]), "livekitCpuMax": mx(o["lk"]), "appCpu": f(o["app"]), "appCpuMax": mx(o["app"]),
                  "pgCpuMax": mx(o["pg"]), "redisCpuMax": mx(o["redis"]), "teacherChromeCpu": f(o["teacher"]), "teacherChromeMemMB": mx(o["teacherMem"]), "driverCpu": f(o["driver"]),
                  "studentChromeCpu": f(o["s1"]), "eventLoopP99ms": mx(o["evlag"]), "pgConnMax": mx(o["pgconn"]), "hostMemUsedMB": mx(o["mem"])}
    return res


hp = host_by_phase()
(R / "host-by-phase.json").write_text(json.dumps(hp, ensure_ascii=False, indent=1))
print("== host by phase")
for p, v in hp.items():
    print(p.ljust(14), v)

if "dynamic" in S:
    print("\n== load matrix (scenario A, all cams)")
    for row in S["dynamic"]["steps"]:
        w = row["window"]
        h = hp.get(f"stepA-{row['students']}", {})
        api = row.get("api", {})
        lat = max([v["p95"] for v in api.values() if v.get("p95") is not None] or [0])
        print(f"1+{row['students']:>2}: lk {row['lk']['active']}/{row['students']+1} tracks {row['lk']['tracks']} | teacher fps {w['fpsAvg']} longTask% {w['longTaskPct']} task% {w['taskPct']} renders/s {w['fnRendersPerSec']} vid {w['videosVisible']}/{w['videosPlaying']} decFps {w['decodedFps']} drop {w['dropped']} | rtc loss {row['rtc']['lossPct']}% jit95 {row['rtc']['jitterP95Ms']} | LK cpu {h.get('livekitCpu')}/{h.get('livekitCpuMax')} app {h.get('appCpu')} T-chrome {h.get('teacherChromeCpu')}% load {h.get('loadAvg1')} evlag {h.get('eventLoopP99ms')}ms | api p95 max {lat}ms")
    print("\n== grid by count")
    for g in S["dynamic"]["grid"]:
        print(g.get("dir"), g.get("total"), g.get("grid"), g.get("cells"), f"{g.get('tileW')}x{g.get('tileH')}", g.get("more"), g.get("page"), "scroll" if (g.get("scrollH") or 0) > (g.get("clientH") or 0) else "")
    ch = S["dynamic"]["perChange"]
    print("\n== per join/leave change (n=%d)" % len(ch))
    for k in ["commits", "fnRenders", "videoMounts", "videoRenders", "tileMoves", "gridChanges", "longTaskMs", "mut"]:
        xs = [c[k] for c in ch if isinstance(c.get(k), (int, float))]
        if xs:
            print(f"  {k}: median {st.median(xs)} max {max(xs)}")
for key in ["storm", "scenarioB", "speaker", "cams", "share", "resize", "panels", "realtime", "answers", "interact", "lecture", "reconnect", "soak"]:
    if key in S:
        txt = json.dumps(S[key], ensure_ascii=False)
        print(f"\n== {key}\n{txt[:2500]}")
