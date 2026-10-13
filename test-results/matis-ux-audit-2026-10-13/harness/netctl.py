#!/usr/bin/env python3
"""Сетевой контроллер стенда. Работает на хосте, но меняет сеть ТОЛЬКО внутри
network namespace тестовых контейнеров браузеров (nsenter -t <pid> -n).
Настройки самого VDS (интерфейсы хоста, iptables хоста) не трогаются.

Драйвер (в контейнере) пишет запросы в $CTL/<id>.req (JSON), контроллер
отвечает в $CTL/<id>.res. Команды:
  {"cmd":"profile","who":"student|teacher|both","profile":"BAD_3G"}   — tc netem
  {"cmd":"custom","who":..,"down":kbit,"up":kbit,"lat":ms,"jit":ms,"loss":pct}
  {"cmd":"cut","who":..,"on":true|false}                              — полный обрыв (iptables DROP)
  {"cmd":"block","who":..,"mode":"none|udp|udp_tcp7881|direct_udp"}   — фильтр для TURN/TCP
  {"cmd":"sql","q":"select ..."}                                      — оракул БД (только чтение)
  {"cmd":"stats"}                                                      — CPU/RAM контейнеров
Шейпится только трафик к/от SERVER_IP: CDP-канал драйвера (подсеть e2e-net) не замедляется.
"""
import json, os, subprocess, sys, time, math

CTL = sys.argv[1]
# Стенд 2026-10-13: приложение стенда — на шлюзе ux-net (только для этой сети),
# LiveKit — на шлюзе (сигнал) и публичном IP хоста (ICE). Портим оба адреса.
SERVERS = [x for x in os.environ.get("SERVERS", "172.31.0.1,95.213.143.106").split(",") if x]
SERVER = SERVERS[0]
# Шлюз docker-сети стенда = сам хост. LiveKit (network_mode: host) слушает все его
# интерфейсы и после ICE-рестарта находит браузер через мост (prflx 172.x) — путь,
# которого у реального клиента нет и который обходит шейпинг/обрывы. Закрываем его.
SUBNET = os.environ.get("E2E_SUBNET", "172.31.0.0/24")
PIDS = {}  # who -> pid
for kv in sys.argv[2:]:
    k, v = kv.split("=")
    PIDS[k] = v

# down/up — кбит/с, lat/jit — мс (RTT-эквивалент: делится пополам на направления), loss — % в каждом направлении
PROFILES = {
    "NORMAL":   dict(down=10000, up=5000, lat=40,  jit=10,  loss=0),
    "BAD_4G":   dict(down=2000,  up=1000, lat=100, jit=30,  loss=1),
    "3G":       dict(down=1000,  up=512,  lat=200, jit=50,  loss=2),
    "BAD_3G":   dict(down=384,   up=128,  lat=300, jit=100, loss=5),
    "EXTREME":  dict(down=128,   up=64,   lat=500, jit=200, loss=10),
    "HORRIBLE": dict(down=64,    up=32,   lat=800, jit=300, loss=15),
    "LOSS5":    dict(down=10000, up=5000, lat=40,  jit=10,  loss=5),
    "LOSS10":   dict(down=10000, up=5000, lat=40,  jit=10,  loss=10),
}


def sh(pid, script):
    r = subprocess.run(["nsenter", "-t", pid, "-n", "sh", "-c", script], capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()


def limit_pkts(rate_kbit, lat_ms, jit_ms):
    # Очередь ≈ 1 с на скорости канала + пакеты «в полёте» (задержка). Без этого
    # netem держит 1000 пакетов — на 64 кбит/с это минуты буфера, а не сотовая сеть.
    bytes_ = rate_kbit * 1000 / 8 * (1.0 + (lat_ms + jit_ms) / 2000)
    return max(30, int(math.ceil(bytes_ / 1200)))


def netem_args(rate, lat, jit, loss):
    half_l, half_j = lat / 2, jit / 2
    a = f"delay {half_l:.0f}ms"
    if half_j > 0:
        a += f" {half_j:.0f}ms distribution normal"
    if loss > 0:
        a += f" loss {loss}%"
    a += f" rate {rate}kbit limit {limit_pkts(rate, lat, jit)}"
    return a


def clear_shape(pid):
    sh(pid, "tc qdisc del dev eth0 root 2>/dev/null; tc qdisc del dev eth0 ingress 2>/dev/null; "
            "tc qdisc del dev ifb0 root 2>/dev/null; ip link del ifb0 2>/dev/null; true")


def ensure_no_bridge(pid):
    """Белый список: из netns браузера — только адреса стенда и соседи по ux-net (CDP)."""
    if "E2EALLOWO" in sh(pid, "iptables -S"):
        return
    allow_o = " ".join(f"iptables -A E2EALLOWO -d {x} -j RETURN;" for x in SERVERS)
    allow_i = " ".join(f"iptables -A E2EALLOWI -s {x} -j RETURN;" for x in SERVERS)
    sh(pid, f"iptables -N E2EALLOWO; iptables -A E2EALLOWO -o lo -j RETURN; iptables -A E2EALLOWO -d {SUBNET} -j RETURN; {allow_o} iptables -A E2EALLOWO -j DROP; "
            f"iptables -N E2EALLOWI; iptables -A E2EALLOWI -i lo -j RETURN; iptables -A E2EALLOWI -s {SUBNET} -j RETURN; {allow_i} iptables -A E2EALLOWI -j DROP; "
            "iptables -A OUTPUT -j E2EALLOWO; iptables -A INPUT -j E2EALLOWI")


def ensure_tree(pid):
    ensure_no_bridge(pid)
    """Дерево qdisc и ifb0 создаются ОДИН раз: пересоздание интерфейса Chrome видит как
    смену сети (ERR_NETWORK_CHANGED, обрыв всех запросов) — на реальном ухудшении связи так не бывает."""
    if "netem 30:" in sh(pid, "tc qdisc show dev eth0") and "ifb0" in sh(pid, "ip link show ifb0 2>&1"):
        return
    clear_shape(pid)
    sh(pid, f"""
set -e
tc qdisc add dev eth0 root handle 1: prio bands 3 priomap 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1
tc qdisc add dev eth0 parent 1:3 handle 30: netem delay 1ms
{chr(10).join(f"tc filter add dev eth0 parent 1: protocol ip prio 1 u32 match ip dst {x}/32 flowid 1:3" for x in SERVERS)}
ip link add ifb0 type ifb
ip link set ifb0 up
tc qdisc add dev ifb0 root handle 1: netem delay 1ms
tc qdisc add dev eth0 handle ffff: ingress
{chr(10).join(f"tc filter add dev eth0 parent ffff: protocol ip prio 1 u32 match ip src {x}/32 action mirred egress redirect dev ifb0" for x in SERVERS)}
""")


def apply_shape(pid, p):
    ensure_tree(pid)
    up = netem_args(p["up"], p["lat"], p["jit"], p["loss"])
    down = netem_args(p["down"], p["lat"], p["jit"], p["loss"])
    out = sh(pid, f"tc qdisc change dev eth0 parent 1:3 handle 30: netem {up}; tc qdisc change dev ifb0 root handle 1: netem {down}")
    return {"up": up, "down": down, "out": out, "qdisc": sh(pid, "tc qdisc show dev eth0; tc qdisc show dev ifb0")[:800]}


def set_cut(pid, on):
    sh(pid, "iptables -D OUTPUT -j E2ECUT 2>/dev/null; iptables -D INPUT -j E2ECUT 2>/dev/null; iptables -F E2ECUT 2>/dev/null; iptables -X E2ECUT 2>/dev/null; true")
    if on:
        rules = " ".join(f"iptables -A E2ECUT -d {x} -j DROP; iptables -A E2ECUT -s {x} -j DROP;" for x in SERVERS)
        sh(pid, f"iptables -N E2ECUT; {rules} iptables -I OUTPUT 1 -j E2ECUT; iptables -I INPUT 1 -j E2ECUT")
    return sh(pid, "iptables -S | grep E2ECUT || echo no-cut")


def set_block(pid, mode):
    sh(pid, "iptables -D OUTPUT -j E2EBLK 2>/dev/null; iptables -F E2EBLK 2>/dev/null; iptables -X E2EBLK 2>/dev/null; true")
    rules = {
        "none": [],
        "udp": [f"-d {x} -p udp -j DROP" for x in SERVERS],
        # «зависший» TCP: приложение (3100: REST, WS урока, доска) и сигнал LiveKit (7880) молча теряются
        "tcpapp": [f"-d {x} -p tcp -m multiport --dports 3100,7880 -j DROP" for x in SERVERS],
        # только приложение (REST/WS урока/доска), медиа живо
        "app": [f"-d {x} -p tcp --dport 3100 -j DROP" for x in SERVERS],
        "apprst": [f"-d {x} -p tcp --dport 3100 -j REJECT --reject-with tcp-reset" for x in SERVERS],
    }[mode]
    if rules:
        cmds = ["iptables -N E2EBLK"] + [f"iptables -A E2EBLK {r}" for r in rules] + ["iptables -I OUTPUT 1 -j E2EBLK"]
        sh(pid, "; ".join(cmds))
    return sh(pid, "iptables -S | grep E2EBLK || echo no-block")


def targets(who):
    return list(PIDS.items()) if who == "both" else [(who, PIDS[who])]


def handle(req):
    cmd = req["cmd"]
    if cmd == "profile" or cmd == "custom":
        p = PROFILES[req["profile"]] if cmd == "profile" else {k: req[k] for k in ("down", "up", "lat", "jit", "loss")}
        return {w: apply_shape(pid, p) for w, pid in targets(req["who"])}
    if cmd == "clear":
        for _, pid in targets(req["who"]):
            ensure_tree(pid)
            # «change … delay 0ms» оставлял прежний rate — сеть «очищалась» не до конца (обвязка 2026-10-13).
            sh(pid, "tc qdisc change dev eth0 parent 1:3 handle 30: netem delay 0ms rate 10gbit limit 1000; tc qdisc change dev ifb0 root handle 1: netem delay 0ms rate 10gbit limit 1000")
        return {"ok": True}
    if cmd == "cut":
        return {w: set_cut(pid, req["on"]) for w, pid in targets(req["who"])}
    if cmd == "block":
        return {w: set_block(pid, req["mode"]) for w, pid in targets(req["who"])}
    if cmd == "sql":
        q = req["q"]
        if not q.lstrip().lower().startswith("select"):
            return {"error": "read-only"}
        # Оракул — БД СТЕНДА (znat-stage), не прод.
        r = subprocess.run(["docker", "exec", "-e", f"Q={q}", "znat-stage-postgres-1", "sh", "-c",
                            'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "$Q"'],
                           capture_output=True, text=True)
        return {"rows": [l for l in r.stdout.splitlines() if l], "err": r.stderr.strip()[:300]}
    if cmd == "stats":
        r = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}",
                            "znat-livekit-1", "znat-stage-app-1", *[f"ux-{w}" for w in PIDS]], capture_output=True, text=True)
        return {"rows": r.stdout.splitlines(), "load": open("/proc/loadavg").read().strip()}
    return {"error": "unknown cmd"}


def main():
    os.makedirs(CTL, exist_ok=True)
    log = open(os.path.join(CTL, "netctl.log"), "a")
    while not os.path.exists(os.path.join(CTL, "done")):
        for f in sorted(os.listdir(CTL)):
            if not f.endswith(".req"):
                continue
            path = os.path.join(CTL, f)
            try:
                req = json.load(open(path))
            except Exception:
                continue  # дописывается
            os.remove(path)
            t0 = time.time()
            try:
                res = handle(req)
            except Exception as e:  # noqa
                res = {"error": repr(e)}
            res["_ms"] = int((time.time() - t0) * 1000)
            res["_t"] = int(time.time() * 1000)
            log.write(f"{time.strftime('%H:%M:%S')} {json.dumps(req, ensure_ascii=False)} -> {json.dumps(res, ensure_ascii=False)[:600]}\n")
            log.flush()
            tmp = path[:-4] + ".tmp"
            json.dump(res, open(tmp, "w"))
            os.rename(tmp, path[:-4] + ".res")
        time.sleep(0.1)
    # уборка: сеть контейнеров в исходное состояние
    for _, pid in PIDS.items():
        clear_shape(pid); set_cut(pid, False); set_block(pid, "none")


if __name__ == "__main__":
    main()
