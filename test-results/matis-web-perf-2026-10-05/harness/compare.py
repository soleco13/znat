"""BEFORE/AFTER по результатам perf.mjs: results-before/ против results/."""
import json, os, sys
H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, H)

def load(dirname, prof):
    out = {}
    for f in sorted(os.listdir(os.path.join(H, dirname))):
        if not f.startswith(prof + "-") or not f.endswith(".requests.json"):
            continue
        lab = f[len(prof) + 1:-len(".requests.json")]
        if lab.startswith("cpu"):
            continue
        rows = json.load(open(os.path.join(H, dirname, f)))
        T0 = min(r["t0"] for r in rows)
        ph = {}
        for r in rows:
            if "/ping" in r["url"]:
                continue
            d = ph.setdefault(r["phase"], {"bytes": 0, "n": 0, "last": 0, "js": 0})
            b = r.get("bytes") or 0
            d["bytes"] += b; d["n"] += 1
            if r["url"].split("?")[0].endswith((".js", ".mjs")): d["js"] += b
            if r.get("t1") and ("/assets/" in r["url"] or "/fonts/" in r["url"] or "/files/" in r["url"]):
                d["last"] = max(d["last"], r["t1"] - T0)
        out[lab] = ph
    summ = {}
    p = os.path.join(H, dirname, f"{prof}-summary.json")
    if os.path.exists(p):
        summ = {x["label"]: x for x in json.load(open(p))}
    return out, summ

for prof in sys.argv[1:] or ["none"]:
    b, bs = load("results-before", prof)
    a, as_ = load("results", prof)
    print(f"\n######## {prof}")
    for lab in sorted(set(b) | set(a)):
        for ph in sorted(set(b.get(lab, {})) | set(a.get(lab, {}))):
            x = b.get(lab, {}).get(ph); y = a.get(lab, {}).get(ph)
            f = lambda d, k: f"{d[k]/1024:7.1f}K" if d else "      —"
            g = lambda d: f"{d['last']:5.1f}s" if d else "    —"
            print(f"  {lab:18} {ph:9} bytes {f(x,'bytes')} -> {f(y,'bytes')}   js {f(x,'js')} -> {f(y,'js')}   n {x['n'] if x else '-':>3} -> {y['n'] if y else '-':>3}   last-static {g(x)} -> {g(y)}")
        eb = (bs.get(lab) or {}).get("extra"); ea = (as_.get(lab) or {}).get("extra")
        mb = (bs.get(lab) or {}).get("m"); ma = (as_.get(lab) or {}).get("m")
        if eb or ea: print(f"  {lab:18} extra {json.dumps(eb)}\n  {'':18}    -> {json.dumps(ea)}")
        if mb or ma: print(f"  {lab:18} m     {json.dumps(mb)}\n  {'':18}    -> {json.dumps(ma)}")
