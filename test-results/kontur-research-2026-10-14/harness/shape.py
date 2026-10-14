#!/usr/bin/env python3
"""Профиль сети Елены (урок 2026-10-14) по расписанию — внутри netns одного контейнера.
  shape.py <pid> <mode> [targets]
mode: elena — расписание 240 с; clear — снять.
targets: через запятую IP/подсети, к которым портится трафик; по умолчанию — всё,
кроме частных сетей (Контур: медиа и сигнал идут в интернет)."""
import subprocess, sys, time, math, json
pid, mode = sys.argv[1], sys.argv[2]
targets = sys.argv[3].split(",") if len(sys.argv) > 3 else None

def sh(s):
    r = subprocess.run(["nsenter", "-t", pid, "-n", "sh", "-c", s], capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()

def limit_pkts(rate, lat, jit):
    return max(30, int(math.ceil(rate * 1000 / 8 * (1.0 + (lat + jit) / 2000) / 1200)))

def netem(rate, lat, jit, loss):
    a = f"delay {lat/2:.0f}ms"
    if jit: a += f" {jit/2:.0f}ms distribution normal"
    if loss: a += f" loss {loss}%"
    return a + f" rate {rate}kbit limit {limit_pkts(rate, lat, jit)}"

def clear():
    sh("tc qdisc del dev eth0 root 2>/dev/null; tc qdisc del dev eth0 ingress 2>/dev/null; tc qdisc del dev ifb0 root 2>/dev/null; ip link del ifb0 2>/dev/null; true")

def tree():
    clear()
    if targets:
        fo = "\n".join(f"tc filter add dev eth0 parent 1: protocol ip prio 2 u32 match ip dst {t} flowid 1:3" for t in targets)
        fi = "\n".join(f"tc filter add dev eth0 parent ffff: protocol ip prio 2 u32 match ip src {t} action mirred egress redirect dev ifb0" for t in targets)
    else:
        # всё, кроме частных сетей (CDP/агент — по docker-мосту)
        fo = "\n".join(f"tc filter add dev eth0 parent 1: protocol ip prio 1 u32 match ip dst {n} flowid 1:2" for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")) + \
             "\ntc filter add dev eth0 parent 1: protocol ip prio 2 u32 match ip dst 0.0.0.0/0 flowid 1:3"
        fi = "\n".join(f"tc filter add dev eth0 parent ffff: protocol ip prio 1 u32 match ip src {n} action ok" for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")) + \
             "\ntc filter add dev eth0 parent ffff: protocol ip prio 2 u32 match ip src 0.0.0.0/0 action mirred egress redirect dev ifb0"
    print(sh(f"""set -e
tc qdisc add dev eth0 root handle 1: prio bands 3 priomap 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1
tc qdisc add dev eth0 parent 1:3 handle 30: netem delay 1ms
{fo}
ip link add ifb0 type ifb
ip link set ifb0 up
tc qdisc add dev ifb0 root handle 1: netem delay 1ms
tc qdisc add dev eth0 handle ffff: ingress
{fi}
"""))

def apply(p):
    sh(f"tc qdisc change dev eth0 parent 1:3 handle 30: netem {netem(p['up'], p['lat'], p['jit'], p['loss'])}; tc qdisc change dev ifb0 root handle 1: netem {netem(p['down'], p['lat'], p['jit'], p['loss'])}")

BASE = dict(down=750, up=1200, lat=40, jit=10, loss=0.5)
SPIKE = dict(BASE, lat=500, jit=150)
DROP = dict(BASE, down=120)
# (начало, с; профиль) — скачки RTT ~0,5 с и провал входа до 120 кбит/с, как у Елены
SCHEDULE = [(0, BASE), (60, SPIKE), (66, BASE), (120, DROP), (150, BASE), (180, SPIKE), (186, BASE), (240, None)]

if mode == "share":
    # Ведущий демонстрации на слабом канале: вход 2 Мбит/с, выход 1 Мбит/с — до 300 с
    tree(); apply(dict(down=2000, up=1000, lat=60, jit=15, loss=0.5)); print("share", flush=True)
    time.sleep(300); clear(); print("done")
elif mode == "bad3g":
    # Постоянно плохая сеть (как BAD_3G стенда UX-аудита) — 240 с
    tree(); apply(dict(down=384, up=128, lat=300, jit=100, loss=5)); print("bad3g", flush=True)
    time.sleep(240); clear(); print("done")
elif mode == "none":
    time.sleep(240); print("none")
elif mode == "clear":
    clear(); print("cleared")
elif mode == "elena":
    tree(); t0 = time.time()
    for at, p in SCHEDULE:
        while time.time() - t0 < at: time.sleep(0.05)
        if p is None: break
        apply(p); print(json.dumps({"t": round(time.time() - t0, 1), **p}), flush=True)
    clear(); print("done")
