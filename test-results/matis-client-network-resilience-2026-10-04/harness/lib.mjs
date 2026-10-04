// Общая часть драйвера: браузеры, сеть (через netctl на хосте), сэмплер, действия урока.
// Всё взаимодействие с приложением — настоящими событиями мыши/клавиатуры через CDP.
// Из страницы только ЧИТАЕМ (getStats, <video>, DOM, Performance-метрики).
import fs from "node:fs";
import crypto from "node:crypto";
import { connectBrowser, openPage, sleep, byText, byLabel } from "./cdp.mjs";
export { sleep, byText, byLabel };

export const ORIGIN = "https://213.21.241.28";
export const LID = process.env.LID;
export const JOIN = process.env.JOIN_PATH;
export const OUT = process.env.OUT;
const CTL = process.env.CTL;
const LK_HOST = process.env.LK_HOST;
export const SAMPLE_MS = 5000;
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

export const T0 = Date.now();
export const rel = (t = Date.now()) => { const s = Math.round((t - T0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const evOut = fs.createWriteStream(`${OUT}/events.jsonl`);
const smOut = fs.createWriteStream(`${OUT}/samples.jsonl`);
export const log = (e) => { e.t = e.t || Date.now(); e.rel = rel(e.t); evOut.write(JSON.stringify(e) + "\n"); if (!e.quiet) console.log(e.rel, e.who || "", e.kind, e.text || e.url || e.status || "", e.extra ? JSON.stringify(e.extra).slice(0, 600) : ""); };
export const mark = (text, extra) => log({ kind: "MARK", text, extra });
export const checks = [];
export const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail, rel: rel(), t: Date.now() }); log({ kind: ok ? "CHECK_OK" : "CHECK_FAIL", text: name, extra: detail }); return !!ok; };

// ── сеть: запросы к netctl.py ──
export async function ctl(req, timeoutMs = 30000) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  fs.writeFileSync(`${CTL}/${id}.tmpw`, JSON.stringify(req));
  fs.renameSync(`${CTL}/${id}.tmpw`, `${CTL}/${id}.req`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(`${CTL}/${id}.res`)) {
      const r = JSON.parse(fs.readFileSync(`${CTL}/${id}.res`, "utf8"));
      fs.unlinkSync(`${CTL}/${id}.res`);
      return r;
    }
    await sleep(50);
  }
  throw new Error(`netctl timeout ${JSON.stringify(req)}`);
}
export let netState = { teacher: "NORMAL", student: "NORMAL" };
export async function setProfile(who, profile) {
  const r = await ctl({ cmd: "profile", who, profile });
  for (const w of who === "both" ? ["teacher", "student"] : [who]) netState[w] = profile;
  log({ kind: "NET", text: `${who} -> ${profile}`, extra: Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, v.up ? { up: v.up, down: v.down } : v])) });
  return r;
}
export async function setCustom(who, p, label) {
  await ctl({ cmd: "custom", who, ...p });
  for (const w of who === "both" ? ["teacher", "student"] : [who]) netState[w] = label;
  log({ kind: "NET", text: `${who} -> ${label}`, extra: p });
}
export async function cut(who, on) {
  const r = await ctl({ cmd: "cut", who, on });
  log({ kind: "NET", text: `${who} ${on ? "CUT (network OFF)" : "network ON"}` });
  return r;
}
export async function block(who, mode) { const r = await ctl({ cmd: "block", who, mode }); log({ kind: "NET", text: `${who} block=${mode}`, extra: r }); return r; }
export async function sql(q) { return (await ctl({ cmd: "sql", q })).rows || []; }
export async function hostStats() { return ctl({ cmd: "stats" }); }

// ── LiveKit server API — источник правды о публикациях ──
function lkJwt(room) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const nowS = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: process.env.LK_KEY, sub: "e2e-observer", nbf: nowS - 5, exp: nowS + 300, video: { roomList: true, roomAdmin: true, room } })}`;
  return `${body}.${crypto.createHmac("sha256", process.env.LK_SECRET).update(body).digest("base64url")}`;
}
async function lkCall(method, payload) {
  const r = await fetch(`${LK_HOST}/twirp/livekit.RoomService/${method}`, { method: "POST", headers: { authorization: `Bearer ${lkJwt(payload.room)}`, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
  return r.json();
}
export async function lkParticipants() {
  try {
    const ps = (await lkCall("ListParticipants", { room: `lesson-${LID}` })).participants || [];
    return { list: ps.map((p) => ({ identity: p.identity, name: p.name, state: p.state || "JOINING", tracks: (p.tracks || []).map((t) => `${t.source || "?"}${t.muted ? ":muted" : ""}`) })) };
  } catch (e) { return { error: String(e) }; }
}

// ── браузеры ──
export let T, S, pages, chromeVersion;
export async function openBrowsers() {
  const tb = await connectBrowser(process.env.T_CDP);
  const sb = await connectBrowser(process.env.S_CDP);
  chromeVersion = tb.version;
  // вкладки прошлых прогонов закрываем: иначе они остаются участниками урока
  for (const b of [tb, sb]) {
    const { targetInfos } = await b.call("Target.getTargets");
    for (const ti of targetInfos) if (ti.type === "page") await b.call("Target.closeTarget", { targetId: ti.targetId }).catch(() => {});
  }
  log({ kind: "env", text: tb.version });
  T = await openPage(tb, "teacher", log);
  S = await openPage(sb, "student", log);
  pages = [T, S];
  return { T, S };
}

// ── UI-состояние, которое видит человек ──
const UI_STATE = `(() => {
  const txt = document.body ? document.body.innerText : '';
  const labels = [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).filter(l => /связ/i.test(l));
  const has = (s) => txt.includes(s);
  return {
    inRoom: !!document.querySelector('[aria-label="Чат"]'),
    overlayReconnect: has('Связь прервалась'),
    pill: ['Переподключение…','Подключение…'].filter(has),
    lkWarn: ['Восстанавливаем','Плохое соединение','Нет соединения','плохое соединение'].filter(has),
    updated: has('Урок обновился'),
    errorScreen: /Что-то пошло не так|Не удалось подключиться|Сервер не отвечает/.test(txt) ? txt.slice(0, 160) : null,
    spinners: document.querySelectorAll('[role=status][aria-busy=true], .animate-spin').length,
    quality: labels,
    path: location.pathname,
  };
})()`;
export const uiState = (p) => p.eval(UI_STATE, 6000).catch((e) => ({ err: String(e).slice(0, 120) }));

// ── сэмплер: getStats каждые 5 с ──
const prev = new Map();
const pcEvIdx = { teacher: 0, student: 0 };
let stopSampler = false, samplerPromise = null;
export let lastSample = {};
export const sampleTag = { v: "" };
async function samplePage(p) {
  let stats, videos, pcev, ui, met;
  try {
    stats = await p.eval("window.__collect ? window.__collect() : null", 8000);
    videos = await p.eval("window.__videos ? window.__videos() : null", 4000);
    pcev = await p.eval(`(window.__pcEvents||[]).slice(${pcEvIdx[p.name]})`, 4000);
    ui = await uiState(p);
    met = await p.metrics().catch(() => null);
  } catch (e) { return { who: p.name, t: Date.now(), error: String(e).slice(0, 200) }; }
  if (pcev) {
    if (pcev.length === 0 && pcEvIdx[p.name] > 0) {
      const n = await p.eval("(window.__pcEvents||[]).length").catch(() => 0);
      if (n < pcEvIdx[p.name]) pcEvIdx[p.name] = 0;
    } else pcEvIdx[p.name] += pcev.length;
    for (const e of pcev) log({ who: p.name, kind: "pc." + e.type, text: `pc${e.pc}=${e.v ?? ""}`, t: e.t, quiet: e.type === "gather" || e.type === "sig" });
  }
  const t = Date.now();
  const last = prev.get(p.name);
  const dt = last ? (t - last.t) / 1000 : null;
  const live = (stats || []).filter((x) => x.conn !== "closed");
  const s = { who: p.name, t, rel: rel(t), tag: sampleTag.v, net: netState[p.name], pcs: (stats || []).map((x) => `${x.pc}:${x.conn}/${x.ice}`),
    ws: p.openWs().map((u) => (u.includes("/livekit/") ? "lk" : u.includes("/ws?") ? "room" : u.includes("/collab") ? "collab" : "other")), ui };
  if (met) s.mem = { heapMB: Math.round(met.JSHeapUsedSize / 1048576), nodes: met.Nodes, listeners: met.JSEventListeners, docs: met.Documents, taskSec: Math.round(met.TaskDuration * 10) / 10, scriptSec: Math.round(met.ScriptDuration * 10) / 10 };
  const byKey = {};
  const lastByKey = last?.byKey || {};
  // LiveKit: один PC на публикацию и один на подписку (или один общий) — суммируем по всем живым.
  s.out = { audio: { kbps: 0, pkts: 0, lostRemote: 0 }, video: { kbps: 0, pkts: 0, layers: [], lostRemote: 0, framesSent: 0 } };
  s.inb = [];
  s.conn = live.map((x) => x.conn).join(",");
  s.ice = live.map((x) => x.ice).join(",");
  for (const pc of live) {
    if (pc.pair) {
      s.rttMs = pc.pair.rtt != null ? Math.round(pc.pair.rtt * 1000) : s.rttMs;
      if (pc.pair.outBw) s.outBwKbps = Math.round(pc.pair.outBw / 1000);
      s.pair = `${pc.pair.local} -> ${pc.pair.remote}`;
    }
    for (const o of pc.outbound || []) {
      const k = `${pc.pc}o${o.ssrc}`; byKey[k] = o;
      const l = lastByKey[k];
      const kbps = l && dt ? Math.max(0, Math.round(((o.bytesSent - l.bytesSent) * 8) / dt / 1000)) : 0;
      const agg = s.out[o.kind] || (s.out[o.kind] = { kbps: 0, pkts: 0, lostRemote: 0 });
      agg.kbps += kbps; agg.pkts += l ? (o.packetsSent - l.packetsSent) : 0;
      if (o.kind === "video") {
        agg.framesSent = (agg.framesSent || 0) + (l && o.framesEncoded != null ? o.framesEncoded - (l.framesEncoded || 0) : 0);
        if (o.active !== false && o.frameWidth) agg.layers.push(`${o.rid || "-"}:${o.frameWidth}x${o.frameHeight}@${Math.round(o.framesPerSecond || 0)}${o.qualityLimitationReason && o.qualityLimitationReason !== "none" ? "[" + o.qualityLimitationReason + "]" : ""}`);
      }
      if (o.remote) { agg.lostRemote += o.remote.lost || 0; if (o.remote.rtt != null) agg.remoteRttMs = Math.round(o.remote.rtt * 1000); if (o.remote.fractionLost != null) agg.fractionLost = Math.max(agg.fractionLost || 0, o.remote.fractionLost); }
    }
    for (const i of pc.inbound || []) {
      const k = `${pc.pc}i${i.ssrc}`; byKey[k] = i;
      const l = lastByKey[k];
      const d = (f) => (l && i[f] != null && l[f] != null ? i[f] - l[f] : null);
      const pk = d("packetsReceived"), ls = d("packetsLost");
      s.inb.push({ kind: i.kind, kbps: dt && d("bytesReceived") != null ? Math.round((d("bytesReceived") * 8) / dt / 1000) : null,
        pkts: pk, lost: ls, lossPct: pk != null && ls != null && pk + ls > 0 ? Math.round((1000 * Math.max(0, ls)) / (pk + Math.max(0, ls))) / 10 : null,
        jitterMs: i.jitter != null ? Math.round(i.jitter * 1000) : null,
        fps: i.framesPerSecond ?? null, res: i.frameWidth ? `${i.frameWidth}x${i.frameHeight}` : null, decoded: d("framesDecoded"), dropped: d("framesDropped"),
        freezes: d("freezeCount"), energy: d("totalAudioEnergy"), concealedPct: d("totalSamplesReceived") ? Math.round((100 * (d("concealedSamples") || 0)) / d("totalSamplesReceived")) : null });
    }
  }
  prev.set(p.name, { t, byKey, videos: (videos || []).map((v) => v.frames) });
  if (videos) {
    const lv = last?.videos || [];
    s.videos = videos.filter((v) => v.visible || v.source).map((v, idx) => ({ src: v.source, local: v.local === "true", res: `${v.w}x${v.h}`, adv: lv[idx] != null && v.frames != null ? v.frames - lv[idx] : null, muted: v.muted }));
  }
  return s;
}
let lkLast = null;
export function startSampler() {
  samplerPromise = (async () => {
    while (!stopSampler) {
      const started = Date.now();
      for (const p of pages) { const s = await samplePage(p); lastSample[p.name] = s; smOut.write(JSON.stringify(s) + "\n"); }
      const lk = await lkParticipants();
      const ids = (lk.list || []).map((x) => x.identity);
      const dup = ids.length !== new Set(ids).size;
      lastSample.livekit = lk;
      smOut.write(JSON.stringify({ who: "livekit", t: Date.now(), rel: rel(), tag: sampleTag.v, ...lk, dup }) + "\n");
      const sig = JSON.stringify((lk.list || []).map((x) => [x.identity, x.state, [...x.tracks].sort().join(",")]));
      if (sig !== lkLast) { log({ who: "livekit", kind: "lk.participants", text: (lk.list || []).map((x) => `${x.name || x.identity}[${x.state}](${x.tracks.join(",")})`).join(" ; ") || lk.error, extra: dup ? { DUPLICATE: ids } : undefined }); lkLast = sig; }
      await sleep(Math.max(200, SAMPLE_MS - (Date.now() - started)));
    }
  })();
}
export async function stopAll() { stopSampler = true; await samplerPromise?.catch(() => {}); }

// ── помощники ──
export async function waitFor(fn, timeoutMs, step = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - start, v }; } catch {}
    await sleep(step);
  }
  return { ok: false, ms: Date.now() - start };
}
/** Что реально передаётся: два снимка getStats + <video> через 3 с. */
export async function flow(p, gapMs = 3000) {
  const snap = () => p.eval("(async()=>({s:await window.__collect(),v:window.__videos()}))()", 8000);
  const a = await snap(); await sleep(gapMs); const b = await snap();
  const sum = (sn, dir, kind, f) => sn.s.filter((x) => x.conn !== "closed").flatMap((x) => x[dir] || []).filter((x) => x.kind === kind).reduce((acc, x) => acc + (x[f] || 0), 0);
  const va = a.v;
  const vid = b.v.map((v, i) => ({ src: v.source, local: v.local === "true", adv: (v.frames || 0) - (va[i]?.frames || 0), res: `${v.w}x${v.h}` }));
  return {
    inAudioBytes: sum(b, "inbound", "audio", "bytesReceived") - sum(a, "inbound", "audio", "bytesReceived"),
    inAudioEnergy: sum(b, "inbound", "audio", "totalAudioEnergy") - sum(a, "inbound", "audio", "totalAudioEnergy"),
    outAudioBytes: sum(b, "outbound", "audio", "bytesSent") - sum(a, "outbound", "audio", "bytesSent"),
    outVideoBytes: sum(b, "outbound", "video", "bytesSent") - sum(a, "outbound", "video", "bytesSent"),
    inVideoFrames: sum(b, "inbound", "video", "framesDecoded") - sum(a, "inbound", "video", "framesDecoded"),
    remoteCam: vid.filter((v) => !v.local && v.src === "camera" && v.adv > 0).map((v) => v.res),
    remoteScreen: vid.filter((v) => !v.local && v.src === "screen_share" && v.adv > 0).map((v) => v.res),
  };
}
export const hears = (f) => f.inAudioBytes > 300 && f.inAudioEnergy > 0.0002;
export const sees = (f) => (f.remoteCam || []).length > 0;
export async function mediaBoth() {
  const [t, s] = await Promise.all([flow(T).catch((e) => ({ err: String(e) })), flow(S).catch((e) => ({ err: String(e) }))]);
  return { t, s, teacherHearsStudent: hears(t), studentHearsTeacher: hears(s), studentSeesTeacher: sees(s), teacherSeesStudent: sees(t) };
}
export const audioBoth = (m) => m.teacherHearsStudent && m.studentHearsTeacher;
export const allMedia = (m) => m.teacherHearsStudent && m.studentHearsTeacher && m.studentSeesTeacher && m.teacherSeesStudent;

const labelOf = (p, labels) => p.eval(`(() => { const L = ${JSON.stringify(labels)}; const b = [...document.querySelectorAll('button[aria-label]')].find(e => e.getBoundingClientRect().width > 0 && L.includes(e.getAttribute('aria-label'))); return b ? b.getAttribute('aria-label') : null; })()`);
export async function press(p, label) { const ok = await p.click(byLabel(label)); if (!ok) log({ who: p.name, kind: "ui.miss", text: `button "${label}" not found` }); return ok; }
export const CAM = { on: "Камера", off: "Включить камеру" };
export const MIC = { on: "Микрофон", off: "Включить звук" };
export const SHARE = { on: "Остановить демонстрацию", off: "Демонстрация" };
export async function setCtl(p, c, want) {
  const cur = await labelOf(p, [c.on, c.off]);
  if (!cur) { log({ who: p.name, kind: "ui.miss", text: `control ${c.on}/${c.off} not found` }); return false; }
  if ((cur === c.on) === want) return true;
  return press(p, cur);
}
export const ctlState = async (p, c) => { const cur = await labelOf(p, [c.on, c.off]); return cur == null ? null : cur === c.on; };
export const inRoom = (p) => p.eval(`!!${byLabel("Чат")}`).catch(() => false);

export async function loginTeacher() {
  // в профиле может жить сессия другого аккаунта — входим заново под E2E-учителем
  await T.send("Network.clearBrowserCookies");
  await T.goto(`${ORIGIN}/login`);
  await waitFor(() => T.eval("!!document.querySelector('input[type=email]') || location.pathname.startsWith('/lessons')"), 60000);
  if (await T.eval("location.pathname.startsWith('/lessons')")) return { ok: true, ms: 0 };
  await T.click("document.querySelector('input[type=email]')"); await T.type(process.env.T_EMAIL || "teacher@school.dev");
  await T.click("document.querySelector('input[type=password]')"); await T.type(process.env.T_PW || "password123");
  await T.click("document.querySelector('button[type=submit]')");
  return waitFor(() => T.eval("location.pathname.startsWith('/lessons')"), 60000);
}
export async function passDeviceCheck(p, cam = true, timeoutMs = 60000) {
  const r = await waitFor(async () => (await inRoom(p)) || p.eval(`!!${byText("button", "Присоединиться")}`), timeoutMs);
  if (!r.ok) return false;
  if (await inRoom(p)) return true;
  await sleep(1500);
  for (const [label, want] of [["Камера", cam], ["Микрофон", true]]) {
    const st = await p.eval(`(() => { const b = ${byLabel(label)}; return b ? b.getAttribute('aria-pressed') : null; })()`);
    if (st !== null && (st === "true") !== want) await p.click(byLabel(label));
  }
  await sleep(500);
  await p.click(byText("button", "Присоединиться"));
  return (await waitFor(() => inRoom(p), timeoutMs)).ok;
}
export async function guestEnter(name = "E2E Ученик") {
  await S.goto(`${ORIGIN}${JOIN}`);
  const r = await waitFor(() => S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]') || !!${byText("button", "Присоединиться")} || !!${byLabel("Чат")}`), 90000);
  if (!r.ok) return false;
  if (await S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`)) {
    await S.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await S.type(name);
    await S.click(`document.querySelector('[role=checkbox]')`);
    await sleep(300);
    await S.click("document.querySelector('button[type=submit]')");
  }
  return true;
}
export async function closeDrawers(p) {
  for (const label of ["Чат", "Участники", "Материалы урока"]) {
    const st = await p.eval(`(() => { const b = ${byLabel(label)}; return b ? b.getAttribute('aria-pressed') : null; })()`).catch(() => null);
    if (st === "true") { await p.click(byLabel(label)); await sleep(400); }
  }
}
export async function openDrawer(p, label) {
  const open = await p.eval(`(() => { const b = ${byLabel(label)}; return b ? b.getAttribute('aria-pressed') : null; })()`);
  if (open !== "true") await press(p, label);
  await sleep(600);
}
/** Сообщение в чат: доставка + ровно одна копия у получателя и у отправителя. */
export async function chat(from, to, tag, timeoutMs = 20000) {
  const text = `e2e-${tag}-${Date.now() % 1000000}`;
  await openDrawer(from, "Чат"); await openDrawer(to, "Чат");
  if (!(await from.click(byLabel("Сообщение классу")))) return { ok: false, why: "no chat input", text };
  await from.type(text);
  const t0 = Date.now();
  await press(from, "Отправить");
  const count = (p) => p.eval(`(document.body.innerText.match(new RegExp(${JSON.stringify(text)}, 'g')) || []).length`);
  const r = await waitFor(async () => (await count(to)) >= 1, timeoutMs, 200);
  const ms = r.ok ? Date.now() - t0 : null;
  await sleep(1500);
  const nTo = await count(to).catch(() => -1), nFrom = await count(from).catch(() => -1);
  const errShown = await from.eval(`document.body.innerText.includes('Сообщение не отправлено')`).catch(() => false);
  return { ok: r.ok && nTo === 1, ms, text, copiesAtReceiver: nTo, copiesAtSender: nFrom, errShown };
}
export const countText = (p, text) => p.eval(`(document.body.innerText.match(new RegExp(${JSON.stringify(text)}, 'g')) || []).length`).catch(() => -1);

/** «Отпечаток» отрисованной доски: контрольная сумма пикселей статического канваса (меняется при любом новом штрихе). */
export const boardInk = (p) => p.eval(`(() => { const cs = [...document.querySelectorAll('.excalidraw canvas')].filter(c => !c.classList.contains('interactive')); const c = cs[0]; if (!c) return null; const w=c.width, h=c.height; const d=c.getContext('2d').getImageData(0,0,w,h).data; let a=0; for (let i=0;i<d.length;i+=7*4) { a = (a * 31 + d[i] + d[i+1]*3 + d[i+2]*7) >>> 0; } return a; })()`).catch(() => null);
export async function drawRect(p, k = 0) {
  const box = await p.eval("(() => { const c = document.querySelector('.excalidraw canvas.interactive') || [...document.querySelectorAll('.excalidraw canvas')].pop(); if (!c) return null; const b = c.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; })()").catch(() => null);
  if (!box) return false;
  const tool = await p.click("document.querySelector('[data-testid=\"toolbar-rectangle\"]')");
  if (!tool) await p.key("r", "KeyR", 82);
  const x = box.x + box.w * (0.15 + ((k * 0.13) % 0.6)), y = box.y + box.h * (0.25 + ((k * 0.17) % 0.45));
  await p.drag(x, y, x + 70, y + 50);
  await sleep(300);
  await p.key("Escape", "Escape", 27);
  return true;
}
export const shot = (name) => Promise.all([T.shot(`${OUT}/shots/${name}-teacher.png`).catch(() => {}), S.shot(`${OUT}/shots/${name}-student.png`).catch(() => {})]);
export function writeSummary(extra = {}) {
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify({ T0, chrome: chromeVersion, checks, ...extra }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\nCHECKS: ${checks.length - failed.length}/${checks.length} OK`);
  for (const f of failed) console.log("FAIL:", f.name, JSON.stringify(f.detail || "").slice(0, 300));
}
export async function finish(extra) { await stopAll(); writeSummary(extra); evOut.end(); smOut.end(); await sleep(300); process.exit(0); }
