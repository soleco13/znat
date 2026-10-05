#!/usr/bin/env python3
"""Отсоединённые DOM-узлы в V8 heap snapshot и кто их держит.
python3 heap-retainers.py file.heapsnapshot [N_PATHS]"""
import json, sys
from collections import Counter, deque

snap = json.load(open(sys.argv[1]))
NPATH = int(sys.argv[2]) if len(sys.argv) > 2 else 6
meta = snap["snapshot"]["meta"]
nf, ef = meta["node_fields"], meta["edge_fields"]
ntypes, etypes = meta["node_types"][0], meta["edge_types"][0]
nodes, edges, strings = snap["nodes"], snap["edges"], snap["strings"]
NFL, EFL = len(nf), len(ef)
i_type, i_name, i_ec = nf.index("type"), nf.index("name"), nf.index("edge_count")
i_det = nf.index("detachedness") if "detachedness" in nf else None
e_type, e_name, e_to = ef.index("type"), ef.index("name_or_index"), ef.index("to_node")
N = len(nodes) // NFL

name = lambda n: strings[nodes[n * NFL + i_name]]
ntype = lambda n: ntypes[nodes[n * NFL + i_type]]

# прямые рёбра → обратные
first_edge = [0] * (N + 1)
acc = 0
for n in range(N):
    first_edge[n] = acc
    acc += nodes[n * NFL + i_ec] * EFL
first_edge[N] = acc
retainers = [[] for _ in range(N)]
for n in range(N):
    for e in range(first_edge[n], first_edge[n + 1], EFL):
        t = etypes[edges[e + e_type]]
        if t == "weak":
            continue
        to = edges[e + e_to] // NFL
        en = edges[e + e_name]
        label = strings[en] if t in ("context", "property", "internal", "shortcut") else f"[{en}]"
        # Эфемероны WeakMap не удерживают ключ: путь через них не настоящий.
        if "WeakMap" in label or "part of key" in label:
            continue
        retainers[to].append((n, t, label))

detached = [n for n in range(N) if (i_det is not None and nodes[n * NFL + i_det] == 2) or name(n).startswith("Detached ")]
print("detached nodes:", len(detached))
c = Counter(name(n) for n in detached)
for k, v in c.most_common(15):
    print(f"  {v:5d}  {k}")

# корни детачнутых «деревьев»: детачнутые узлы, у которых нет детачнутого родителя-ретейнера
dset = set(detached)
roots = [n for n in detached if not any(r in dset for r, _, _ in retainers[n])]
print("detached subtree roots:", len(roots), Counter(name(n) for n in roots).most_common(8))


def path_to_gc_root(start, limit=200000):
    """BFS по ретейнерам до узла типа synthetic (корень) — кратчайшая цепочка."""
    prev = {start: None}
    q = deque([start])
    seen = 0
    while q and seen < limit:
        n = q.popleft()
        seen += 1
        if ntype(n) == "synthetic" and n != start:
            path = []
            while n is not None:
                path.append(n)
                n = prev[n][0] if prev[n] else None
            return path, prev
        for r, t, label in retainers[n]:
            if r not in prev:
                prev[r] = (n, t, label)
                q.append(r)
    return None, prev


shown = Counter()
focus = sys.argv[3] if len(sys.argv) > 3 else None
targets = [n for n in detached if focus and focus in name(n)] if focus else roots
for n in targets:
    key = name(n)
    if shown[key] >= 2:
        continue
    shown[key] += 1
    path, prev = path_to_gc_root(n)
    print(f"\n== retainer chain for {name(n)} (#{n})")
    if not path:
        print("  no path")
        continue
    # path: [root ... start] через prev: prev[x] = (child, type, label)
    for node in path[: 25]:
        p = prev[node]
        edge = f"--{p[1]}:{p[2]}-->" if p else ""
        print(f"  {ntype(node):10s} {name(node)[:90]:90s} {edge}")
    if sum(shown.values()) >= NPATH:
        break

if len(sys.argv) > 4:
    i_id = nf.index("id")
    want = int(sys.argv[4])
    tgt = next(n for n in range(N) if nodes[n * NFL + i_id] == want)
    dset = set()
    path, prev = path_to_gc_root(tgt, limit=2_000_000)
    print(f"\n== chain for @{want} {name(tgt)}")
    for node in (path or [])[:40]:
        p = prev[node]
        edge = f"--{p[1]}:{p[2]}-->" if p else ""
        print(f"  {ntype(node):10s} {name(node)[:80]:80s} {edge}")
