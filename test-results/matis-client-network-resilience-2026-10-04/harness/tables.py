#!/usr/bin/env python3
"""Сводные таблицы для отчёта из data/<прогон>/summary.json (+ analysis.json, load.json).
Использование: tables.py <prefix>   (prefix = before | after) → markdown в stdout."""
import json, os, sys

D = os.path.join(os.path.dirname(__file__), "..", "data")
P = sys.argv[1]


def load(name, f="summary.json"):
    p = os.path.join(D, f"{P}-{name}", f)
    return json.load(open(p)) if os.path.exists(p) else None


def ms(v):
    return "—" if v is None else (f"{v/1000:.1f} с" if v >= 1000 else f"{v} мс")


def ok(v):
    return "✅" if v else "❌"


out = []
# ── матрица ──
rounds = {}
for name in ("matrix", "matrix2"):
    s = load(name)
    if s:
        rounds.update(s["rounds"])  # matrix2 (перемер) перекрывает matrix
an = {}
for name in ("matrix", "matrix2"):
    a = load(name, "analysis.json")
    if a:
        an.update(a["rounds"])
if rounds:
    out.append("| Профиль | Медиа | Чат T→S / S→T | Мик вкл→слышно | Кам вкл→видно (T / S) | Демонстрация | Доска откр / T→S / S→T | Ответ сохранён | Восстановление |")
    out.append("|---|---|---|---|---|---|---|---|---|")
    for prof in ["NORMAL", "BAD_4G", "3G", "BAD_3G", "EXTREME", "HORRIBLE", "LOSS5", "LOSS10"]:
        r = rounds.get(prof)
        if not r:
            continue
        st = r["steps"]
        g = lambda k: st.get(k, {})
        out.append("| {} | {} | {} / {} | {} / {} | {} / {} | {} | {} / {} / {} | {} | {} |".format(
            prof, ok(g("media").get("ok")),
            ms(g("chatT2S").get("ms")) if g("chatT2S").get("ok") else "❌", ms(g("chatS2T").get("ms")) if g("chatS2T").get("ok") else "❌",
            ms(g("teacherMic").get("ms")) if g("teacherMic").get("ok") else "❌", ms(g("studentMic").get("ms")) if g("studentMic").get("ok") else "❌",
            ms(g("teacherCam").get("ms")) if g("teacherCam").get("ok") else "❌", ms(g("studentCam").get("ms")) if g("studentCam").get("ok") else "❌",
            ms(g("screenShare").get("startMs")) if g("screenShare").get("ok") else "❌",
            ms(g("board").get("openMs")), ms(g("board").get("t2sMs")), ms(g("board").get("s2tMs")) if g("board").get("s2tOk") else "❌",
            ms(g("answer").get("saveMs")) if g("answer").get("ok") else ("❌ " + (g("answer").get("why") or "")),
            ms((r.get("recovery") or {}).get("mediaMs")) if r.get("recovery") else "—"))
    out.append("")
    out.append("| Профиль | RTT мед/p95 (ученик) | Потери аудио/видео, % | Входящий звук, кбит/с | Входящее видео, кбит/с | FPS / разрешение у ученика | Исходящие слои учителя | Звука нет, а UI молчит |")
    out.append("|---|---|---|---|---|---|---|---|")
    for prof in ["NORMAL", "BAD_4G", "3G", "BAD_3G", "EXTREME", "HORRIBLE", "LOSS5", "LOSS10"]:
        a = an.get(prof)
        if not a or "student" not in a:
            continue
        s, t = a["student"], a.get("teacher", {})
        out.append("| {} | {} / {} мс | {} / {} | {} | {} | {} / {} | {} | {} с |".format(
            prof, s["rttMs"]["med"], s["rttMs"]["p95"], s["lossAudioPct"]["med"], s["lossVideoPct"]["med"],
            s["inAudioKbps"]["med"], s["inVideoKbps"]["med"], s["inFps"], ", ".join(s["inRes"][:3]),
            ", ".join(t.get("outLayers", [])[:4]), max(s["silentMediaLoss"]["longestSec"], t.get("silentMediaLoss", {}).get("longestSec", 0))))
    out.append("")

# ── переходы и обрывы ──
s = load("transitions")
if s:
    R = s["rounds"]
    out.append("| Сценарий | PC снова connected | Звук+видео в обе стороны | WS урока | Пропущенное сообщение | Стейдж | Сообщение, отправленное без сети | Дубли участников | Что видел ученик во время обрыва |")
    out.append("|---|---|---|---|---|---|---|---|---|")
    for k in ["D", "E", "F", "G", "H"]:
        o = (R.get(k) or {}).get("outage")
        if not o:
            continue
        ui = o.get("uiDuring") or []
        seen = sorted({x for u in ui for x in ([("оверлей" if u.get("overlay") else None)] + u.get("pill", []) + u.get("lkWarn", []) + u.get("q", [])) if x})
        om = o.get("offlineMsg", {})
        out.append("| {} ({} с{}) | {} | {} | {} | {} ({} коп.) | {} | у учителя {} коп.{} | {} | {} |".format(
            k, o["sec"], ", " + o["base"] if o.get("base") != "NORMAL" else "", ms(o.get("pcReconnectMs")), ms(o.get("mediaMs")), ok(o.get("roomWs")),
            ok(o["missedChat"]["delivered"]), o["missedChat"]["copies"], ok(o.get("stageSynced")),
            om.get("atTeacher"), ", текст вернулся в поле" if om.get("draftKept") else "", "нет" if not o.get("dup") else "ДА",
            ", ".join(seen) or "ничего"))
    for k in ["A", "B", "C", "W"]:
        r = R.get(k)
        if r:
            rec = r.get("recovery", {})
            extra = ""
            if k == "W":
                extra = f"события после возврата TCP через {ms(r.get('missedChatDeliveredMs'))}, стейдж через {ms(r.get('stageMs'))}"
            out.append(f"| {k} | | восстановление {ms(rec.get('mediaMs'))} | | | | | {'нет' if not rec.get('dup') else 'ДА'} | {extra} |")
    out.append("")

# ── TURN ──
s = load("turn")
if s:
    out.append("| Что закрыто у ученика | Путь кандидатов | Вход → звук | Обрыв 15 с → медиа | Итог |")
    out.append("|---|---|---|---|---|")
    names = {"udp": "весь UDP", "udp_tcp7881": "UDP + ICE-TCP 7881", "direct_udp": "прямой UDP 50000–60000 + ICE-TCP"}
    for k, r in s["rounds"].items():
        out.append(f"| {names.get(r['mode'], r['mode'])} | `{r.get('path')}` | {ms(r.get('joinToAudioMs'))} | {ms((r.get('outage15') or {}).get('mediaMs'))} | {ok(r.get('mediaOk') and (r.get('mediaAfter') or {}).get('ok'))} |")
    out.append("")

# ── REST ──
s = load("rest")
if s:
    out.append("| Проверка | Итог | Детали |")
    out.append("|---|---|---|")
    for c in s["checks"]:
        if c["name"].startswith("rest: "):
            d = c.get("detail") or {}
            det = {k: v for k, v in d.items() if k in ("msg", "state", "firstMs", "dbRows", "copies", "rows", "saveMs", "firstState", "recoversByReopen", "atTeacherAfterResend", "onLogin", "dupT", "why")} if isinstance(d, dict) else d
            out.append(f"| {c['name'][6:]} | {ok(c['ok'])} | {json.dumps(det, ensure_ascii=False)[:160]} |")
    out.append("")

# ── загрузка ──
L = load("load", "load.json")
if L:
    out.append("| Профиль | FCP | LCP | Форма входа | Экран устройств | В уроке | Запросов | Передано, КБ | JS/CSS до формы, КБ | Ошибки |")
    out.append("|---|---|---|---|---|---|---|---|---|---|")
    for k, v in L.items():
        out.append(f"| {k} | {ms(v.get('fcp'))} | {ms(v.get('lcp'))} | {ms(v.get('formMs'))} | {ms(v.get('devCheckMs'))} | {ms(v.get('inRoomMs'))} | {v.get('requests')} | {v.get('totalKb')} | {v['beforeForm']['kb']} | {len(v.get('fails', []))} |")
    out.append("")

# ── запись ──
s = load("recording")
if s and s["rounds"].get("recording"):
    r = s["rounds"]["recording"]
    out.append(f"Запись: бот записи в комнате через {ms(r.get('egressJoinedMs'))}, ученик видит значок записи: {ok(r.get('studentSeesBadge'))}, после переподключения: {ok(r.get('badgeAfterReconnect'))}; "
               f"обрыв 15 с на BAD_3G → медиа {ms((r.get('outage') or {}).get('mediaMs'))}; итог записи: `{r.get('final')}`.")
    out.append("")

# ── длительный ──
s = load("long")
if s and s["rounds"].get("long"):
    ph = s["rounds"]["long"]["phases"]
    out.append("| Цикл | Фаза | Минут | Звук OK | Видео OK | Чат OK (мед. мс) | Дубли чата | heap T/S, МБ (нач→кон) | Слушатели T/S (нач→кон) | WS T/S макс |")
    out.append("|---|---|---|---|---|---|---|---|---|---|")
    for p in ph:
        m = p["minutes"]
        if not m:
            continue
        cm = sorted(x["chatMs"] for x in m if x.get("chatMs"))
        out.append("| {} | {} | {} | {}/{} | {}/{} | {}/{} ({}) | {} | {}→{} / {}→{} | {}→{} / {}→{} | {} / {} |".format(
            p["cycle"], p["prof"], len(m), sum(1 for x in m if all(x["audio"])), len(m), sum(1 for x in m if all(x["video"])), len(m),
            sum(1 for x in m if x["chat"]), len(m), cm[len(cm)//2] if cm else "—", sum(1 for x in m if (x.get("chatDup") or 1) > 1),
            m[0]["heapMB"]["t"], m[-1]["heapMB"]["t"], m[0]["heapMB"]["s"], m[-1]["heapMB"]["s"],
            m[0]["listeners"]["t"], m[-1]["listeners"]["t"], m[0]["listeners"]["s"], m[-1]["listeners"]["s"],
            max(x["wsCount"]["teacher"] for x in m), max(x["wsCount"]["student"] for x in m)))
    out.append("")

print("\n".join(out))
