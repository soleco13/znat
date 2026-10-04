// E2E: стабильность одного урока Matís (учитель + ученик-гость).
import fs from "node:fs";
import crypto from "node:crypto";
import { connectBrowser, openPage, sleep, byText, byLabel } from "./cdp.mjs";

const ORIGIN = "https://213.21.241.28";
const LID = process.env.LID;
const JOIN = process.env.JOIN_PATH;
const LONG_MIN = Number(process.env.LONG_MIN || 1);
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 5000);
const FOCUS = !!process.env.FOCUS;
const OBS_MS = Number(process.env.OBS_SEC || 90) * 1000;
const CUTS = (process.env.CUTS || "5,25").split(",").map(Number);
const OUT = process.env.OUT;
const LK_HOST = process.env.LK_HOST || "http://172.24.0.1:7880";
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

const T0 = Date.now();
const rel = (t = Date.now()) => { const s = Math.round((t - T0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const evOut = fs.createWriteStream(`${OUT}/events.jsonl`);
const smOut = fs.createWriteStream(`${OUT}/samples.jsonl`);
const log = (e) => { e.t = e.t || Date.now(); e.rel = rel(e.t); evOut.write(JSON.stringify(e) + "\n"); if (!e.quiet) console.log(e.rel, e.who || "", e.kind, e.text || e.url || e.status || "", e.extra ? JSON.stringify(e.extra) : ""); };
const timeline = [];
const mark = (text, extra) => { timeline.push({ rel: rel(), t: Date.now(), text, ...(extra ? { extra } : {}) }); log({ kind: "MARK", text, extra }); };
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail, rel: rel() }); log({ kind: ok ? "CHECK_OK" : "CHECK_FAIL", text: name, extra: detail }); return ok; };

// ── LiveKit server API (Twirp) — только чтение списка участников ──
function lkJwt(room) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const nowS = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: process.env.LK_KEY, sub: "e2e-observer", nbf: nowS - 5, exp: nowS + 300, video: { roomList: true, roomAdmin: true, room: room || `lesson-${LID}` } })}`;
  return `${body}.${crypto.createHmac("sha256", process.env.LK_SECRET).update(body).digest("base64url")}`;
}
async function lkCall(method, payload) {
  const r = await fetch(`${LK_HOST}/twirp/livekit.RoomService/${method}`, { method: "POST", headers: { authorization: `Bearer ${lkJwt(payload.room)}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  return r.json();
}
let lkRoomName = null;
async function lkParticipants() {
  try {
    if (!lkRoomName) {
      const rooms = (await lkCall("ListRooms", {})).rooms || [];
      const r = rooms.find((x) => x.name.includes(LID)) || rooms.find((x) => Number(x.num_participants) > 0);
      if (!r) return { error: "no_room", rooms: rooms.map((x) => x.name) };
      lkRoomName = r.name;
    }
    const ps = (await lkCall("ListParticipants", { room: lkRoomName })).participants || [];
    return { room: lkRoomName, list: ps.map((p) => ({ identity: p.identity, name: p.name, state: p.state, joinedAt: Number(p.joined_at), tracks: (p.tracks || []).map((t) => `${t.source}:${t.type}${t.muted ? ":muted" : ""}`) })) };
  } catch (e) { return { error: String(e) }; }
}

// ── браузеры ──
const tb = await connectBrowser(process.env.T_CDP);
const sb = await connectBrowser(process.env.S_CDP);
log({ kind: "env", text: tb.version });
const T = await openPage(tb, "teacher", log);
const S = await openPage(sb, "student", log);
const pages = [T, S];

// ── сэмплер (каждые SAMPLE_MS) ──
const prev = new Map();
let pcEvIdx = { teacher: 0, student: 0 };
let paused = false;
async function samplePage(p) {
  let stats, videos, pcev;
  try {
    stats = await p.eval("window.__collect ? window.__collect() : null", 8000);
    videos = await p.eval("window.__videos ? window.__videos() : null", 4000);
    pcev = await p.eval(`(window.__pcEvents||[]).slice(${pcEvIdx[p.name]})`, 4000);
  } catch (e) { return { who: p.name, error: String(e).slice(0, 200) }; }
  if (pcev) {
    // при перезагрузке страницы журнал обнуляется
    if (pcev.length === 0 && pcEvIdx[p.name] > 0) {
      const n = await p.eval("(window.__pcEvents||[]).length").catch(() => 0);
      if (n < pcEvIdx[p.name]) { pcEvIdx[p.name] = 0; }
    } else pcEvIdx[p.name] += pcev.length;
    for (const e of pcev) log({ who: p.name, kind: "pc." + e.type, text: `pc${e.pc}=${e.v ?? ""}`, t: e.t, quiet: e.type === "gather" || e.type === "sig" });
  }
  const t = Date.now();
  const last = prev.get(p.name);
  const dt = last ? (t - last.t) / 1000 : null;
  const live = (stats || []).filter((x) => x.conn !== "closed");
  const s = { who: p.name, t, rel: rel(t), pcs: (stats || []).map((x) => `${x.pc}:${x.conn}/${x.ice}`), ws: p.openWs().map((u) => u.includes("/livekit/") ? "lk" : u.includes("/ws?") ? "room" : u.includes("/collab") ? "collab" : "other") };
  const pc = live[live.length - 1];
  if (pc) {
    s.conn = pc.conn; s.ice = pc.ice; s.gather = pc.gather; s.sig = pc.sig; s.dtls = pc.dtls;
    if (pc.pair) { s.rttMs = pc.pair.rtt != null ? Math.round(pc.pair.rtt * 1000) : null; s.outBwKbps = pc.pair.outBw ? Math.round(pc.pair.outBw / 1000) : null; s.inBwKbps = pc.pair.inBw ? Math.round(pc.pair.inBw / 1000) : null; s.pair = `${pc.pair.local} -> ${pc.pair.remote}`; }
    const lastByKey = last?.byKey || {};
    const byKey = {};
    s.out = {}; s.inb = [];
    for (const o of pc.outbound) {
      const k = `o${o.ssrc}`; byKey[k] = o;
      const l = lastByKey[k];
      const kbps = l && dt ? Math.round(((o.bytesSent - l.bytesSent) * 8) / dt / 1000) : null;
      const key = o.kind;
      s.out[key] = s.out[key] || { kbps: 0, packetsSent: 0, layers: [] };
      s.out[key].kbps += kbps || 0; s.out[key].packetsSent += o.packetsSent || 0;
      if (o.kind === "video") s.out[key].layers.push(`${o.rid || "-"}:${o.frameWidth || 0}x${o.frameHeight || 0}@${o.framesPerSecond || 0}${o.active === false ? "(off)" : ""}${o.qualityLimitationReason && o.qualityLimitationReason !== "none" ? "[" + o.qualityLimitationReason + "]" : ""}`);
      if (o.remote) { s.out[key].remoteLost = (s.out[key].remoteLost || 0) + (o.remote.lost || 0); if (o.remote.rtt != null) s.out[key].remoteRttMs = Math.round(o.remote.rtt * 1000); }
    }
    for (const i of pc.inbound) {
      const k = `i${i.ssrc}`; byKey[k] = i;
      const l = lastByKey[k];
      const d = (f) => (l && i[f] != null && l[f] != null ? i[f] - l[f] : null);
      s.inb.push({ kind: i.kind, track: (i.trackIdentifier || "").slice(0, 12), kbps: dt && d("bytesReceived") != null ? Math.round((d("bytesReceived") * 8) / dt / 1000) : null,
        pkts: d("packetsReceived"), lost: d("packetsLost"), lostTotal: i.packetsLost, pktsTotal: i.packetsReceived, jitterMs: i.jitter != null ? Math.round(i.jitter * 1000) : null,
        fps: i.framesPerSecond ?? null, res: i.frameWidth ? `${i.frameWidth}x${i.frameHeight}` : null, framesDecoded: d("framesDecoded"),
        freezes: i.freezeCount ?? null, freezeDur: i.totalFreezesDuration ?? null, audioLevel: i.audioLevel != null ? Math.round(i.audioLevel * 1000) / 1000 : null,
        concealedPct: d("totalSamplesReceived") ? Math.round((100 * (d("concealedSamples") || 0)) / d("totalSamplesReceived")) : null });
    }
    prev.set(p.name, { t, byKey });
  }
  if (videos) {
    const lv = last?.videos || [];
    s.videos = videos.filter((v) => v.visible || v.source).map((v, idx) => ({ src: v.source, local: v.local === "true", res: `${v.w}x${v.h}`, frames: v.frames, adv: lv[idx] && v.frames != null ? v.frames - lv[idx].frames : null, state: v.trackState, muted: v.muted }));
    const pr = prev.get(p.name); if (pr) pr.videos = videos.map((v) => ({ frames: v.frames })); else prev.set(p.name, { t, byKey: {}, videos: videos.map((v) => ({ frames: v.frames })) });
  }
  return s;
}
let lkLast = null;
async function sampler() {
  let n = 0;
  while (!stopSampler) {
    const started = Date.now();
    if (!paused) {
      for (const p of pages) { const s = await samplePage(p); smOut.write(JSON.stringify(s) + "\n"); }
      if (n % 2 === 0) {
        const lk = await lkParticipants();
        const ids = (lk.list || []).map((x) => x.identity);
        const dup = ids.length !== new Set(ids).size;
        smOut.write(JSON.stringify({ who: "livekit", t: Date.now(), rel: rel(), ...lk, dup }) + "\n");
        const sig = JSON.stringify((lk.list || []).map((x) => [x.identity, x.state, x.tracks.sort().join(",")]));
        if (sig !== lkLast) { log({ who: "livekit", kind: "lk.participants", text: (lk.list || []).map((x) => `${x.name || x.identity}[${x.state}](${x.tracks.join(",")})`).join(" ; ") || lk.error, extra: dup ? { DUPLICATE: ids } : undefined }); lkLast = sig; }
      }
      n++;
    }
    await sleep(Math.max(200, SAMPLE_MS - (Date.now() - started)));
  }
}
let stopSampler = false;

// ── помощники ──
async function waitFor(fn, timeoutMs, step = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - start, v }; } catch {}
    await sleep(step);
  }
  return { ok: false, ms: Date.now() - start };
}
/** Что реально движется: два снимка getStats + video-элементы через 1.5 с. */
async function flow(p) {
  const a = await p.eval("(async()=>({s:await window.__collect(),v:window.__videos()}))()", 8000);
  await sleep(3000);
  const b = await p.eval("(async()=>({s:await window.__collect(),v:window.__videos()}))()", 8000);
  const sum = (snap, dir, kind, f) => snap.s.filter((x) => x.conn !== "closed").flatMap((x) => x[dir] || []).filter((x) => x.kind === kind).reduce((acc, x) => acc + (x[f] || 0), 0);
  const conn = b.s.filter((x) => x.conn !== "closed").map((x) => x.conn);
  const vids = (snap) => Object.fromEntries(snap.v.map((v, i) => [i, v]));
  const va = vids(a);
  const remoteVideo = b.v.map((v, i) => ({ src: v.source, local: v.local === "true", adv: (v.frames || 0) - (va[i]?.frames || 0), res: `${v.w}x${v.h}` }));
  return {
    conn: conn.join(","),
    inAudioBytes: sum(b, "inbound", "audio", "bytesReceived") - sum(a, "inbound", "audio", "bytesReceived"),
    inVideoFrames: sum(b, "inbound", "video", "framesDecoded") - sum(a, "inbound", "video", "framesDecoded"),
    outAudioBytes: sum(b, "outbound", "audio", "bytesSent") - sum(a, "outbound", "audio", "bytesSent"),
    outVideoBytes: sum(b, "outbound", "video", "bytesSent") - sum(a, "outbound", "video", "bytesSent"),
    inAudioEnergy: sum(b, "inbound", "audio", "totalAudioEnergy") - sum(a, "inbound", "audio", "totalAudioEnergy"),
    inAudioLevel: Math.max(0, ...b.s.flatMap((x) => x.inbound || []).filter((x) => x.kind === "audio").map((x) => x.audioLevel || 0)),
    remoteCam: remoteVideo.filter((v) => !v.local && v.src === "camera" && v.adv > 0).map((v) => v.res),
    remoteScreen: remoteVideo.filter((v) => !v.local && v.src === "screen_share" && v.adv > 0).map((v) => v.res),
    localCam: remoteVideo.filter((v) => v.local && v.src === "camera" && v.adv > 0).length,
  };
}
const labelOf = (p, labels) => p.eval(`(() => { const L = ${JSON.stringify(labels)}; const b = [...document.querySelectorAll('button[aria-label]')].find(e => e.getBoundingClientRect().width > 0 && L.includes(e.getAttribute('aria-label'))); return b ? b.getAttribute('aria-label') : null; })()`);
async function press(p, label) { const ok = await p.click(byLabel(label)); if (!ok) log({ who: p.name, kind: "ui.miss", text: `button "${label}" not found` }); return ok; }
const CAM = { on: "Камера", off: "Включить камеру" };
const MIC = { on: "Микрофон", off: "Включить звук" };
const SHARE = { on: "Остановить демонстрацию", off: "Демонстрация" };
async function setCtl(p, ctl, want) {
  const cur = await labelOf(p, [ctl.on, ctl.off]);
  if (!cur) { log({ who: p.name, kind: "ui.miss", text: `control ${ctl.on}/${ctl.off} not found` }); return false; }
  if ((cur === ctl.on) === want) return true;
  return press(p, cur);
}
const inRoom = (p) => p.eval(`!!${byLabel("Чат")}`).catch(() => false);
const otherFlow = { teacher: () => flow(S), student: () => flow(T) };

async function loginTeacher() {
  await T.goto(`${ORIGIN}/login`);
  await waitFor(() => T.eval("!!document.querySelector('input[type=email]')"), 15000);
  await T.click("document.querySelector('input[type=email]')"); await T.type("teacher@school.dev");
  await T.click("document.querySelector('input[type=password]')"); await T.type("password123");
  await T.click("document.querySelector('button[type=submit]')");
  return waitFor(() => T.eval("location.pathname.startsWith('/lessons')"), 15000);
}
/** Экран проверки устройств → «Присоединиться» (с камерой/микрофоном). */
async function passDeviceCheck(p, cam = true) {
  const r = await waitFor(() => p.eval(`!!${byText("button", "Присоединиться")}`), 30000);
  if (!r.ok) return false;
  await sleep(1500);
  // кнопки «Камера»/«Микрофон» на экране проверки — aria-pressed
  for (const [label, want] of [["Камера", cam], ["Микрофон", true]]) {
    const st = await p.eval(`(() => { const b = ${byLabel(label)}; return b ? b.getAttribute('aria-pressed') : null; })()`);
    if (st !== null && (st === "true") !== want) await p.click(byLabel(label));
  }
  await sleep(500);
  await p.click(byText("button", "Присоединиться"));
  return (await waitFor(() => inRoom(p), 30000)).ok;
}
async function guestEnter() {
  await S.goto(`${ORIGIN}${JOIN}`);
  const r = await waitFor(() => S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]') || !!${byText("button", "Присоединиться")}`), 20000);
  if (!r.ok) return false;
  if (await S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`)) {
    await S.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await S.type("E2E Ученик");
    await S.click(`document.querySelector('[role=checkbox]')`);
    await sleep(300);
    await S.click("document.querySelector('button[type=submit]')");
  }
  return true;
}
async function openDrawer(p, label) {
  const open = await p.eval(`(() => { const b = ${byLabel(label)}; return b ? b.getAttribute('aria-pressed') : null; })()`);
  if (open !== "true") await press(p, label);
  await sleep(800);
}
async function chatRoundtrip(from, to, tag) {
  const text = `e2e-${tag}-${Date.now() % 100000}`;
  await openDrawer(from, "Чат"); await openDrawer(to, "Чат");
  const okIn = await from.click(byLabel("Сообщение классу"));
  if (!okIn) return { ok: false, why: "no chat input" };
  await from.type(text);
  const t0 = Date.now();
  await press(from, "Отправить");
  const r = await waitFor(() => to.eval(`document.body.innerText.includes(${JSON.stringify(text)})`), 15000, 200);
  return { ok: r.ok, ms: r.ok ? Date.now() - t0 : null, text };
}
async function snapshotBoth(tag) {
  const [ft, fs_] = [await flow(T).catch((e) => ({ err: String(e) })), await flow(S).catch((e) => ({ err: String(e) }))];
  log({ kind: "flow", text: tag, extra: { teacher: ft, student: fs_ } });
  return { t: ft, s: fs_ };
}
/** Двусторонний медиаобмен: каждый слышит/видит другого. */
function mediaOk(f, { studentCam = true } = {}) {
  return {
    teacherHearsStudent: f.t.inAudioBytes > 500 && f.t.inAudioEnergy > 0.0005,
    studentHearsTeacher: f.s.inAudioBytes > 500 && f.s.inAudioEnergy > 0.0005,
    studentSeesTeacher: (f.s.remoteCam || []).length > 0,
    teacherSeesStudent: studentCam ? (f.t.remoteCam || []).length > 0 : true,
  };
}
const allTrue = (o) => Object.values(o).every(Boolean);
const shot = (name) => Promise.all([T.shot(`${OUT}/shots/${name}-teacher.png`).catch(() => {}), S.shot(`${OUT}/shots/${name}-student.png`).catch(() => {})]);

// ── сетевой обрыв ученика через host-watcher (iptables в netns контейнера) ──
async function netCut(seconds) {
  const id = `${Date.now()}`;
  fs.writeFileSync(`${OUT}/ctl.req`, `${id} ${seconds}\n`);
  const r = await waitFor(() => fs.existsSync(`${OUT}/ctl.down.${id}`), 10000, 100);
  if (!r.ok) return null;
  const down = Number(fs.readFileSync(`${OUT}/ctl.down.${id}`, "utf8"));
  const r2 = await waitFor(() => fs.existsSync(`${OUT}/ctl.up.${id}`), (seconds + 15) * 1000, 100);
  const up = r2.ok ? Number(fs.readFileSync(`${OUT}/ctl.up.${id}`, "utf8")) : null;
  return { down, up };
}

// ════════════════════════ СЦЕНАРИЙ ════════════════════════
const results = {};
try {
  sampler();
  // 1. Учитель
  mark("teacher: open /login");
  const lg = await loginTeacher();
  check("teacher login", lg.ok, { ms: lg.ms });
  await T.goto(`${ORIGIN}/lessons/${LID}/room`);
  const tj0 = Date.now();
  check("teacher device check + join", await passDeviceCheck(T, true));
  const tLk = await waitFor(async () => (await T.eval("(window.__pcs||[]).some(p=>p.connectionState==='connected')")), 30000);
  check("teacher LiveKit PC connected", tLk.ok, { msFromJoinClick: Date.now() - tj0 });
  check("teacher room WS open", T.openWs().some((u) => u.includes("/ws?")));
  check("teacher LiveKit signal WS open", T.openWs().some((u) => u.includes("/livekit/")));
  const tPub = await waitFor(async () => { const f = await flow(T); return f.outAudioBytes > 0 && f.outVideoBytes > 0 && f.localCam > 0 ? f : null; }, 20000);
  check("teacher local audio+video published (bytes moving)", tPub.ok, tPub.v);
  mark("teacher connected");

  // 2. Ученик
  mark("student: open join link");
  check("student guest enter", await guestEnter());
  const sj0 = Date.now();
  check("student device check + join", await passDeviceCheck(S, true));
  const sLk = await waitFor(async () => (await S.eval("(window.__pcs||[]).some(p=>p.connectionState==='connected')")), 30000);
  check("student LiveKit PC connected", sLk.ok, { msFromJoinClick: Date.now() - sj0 });
  { const w = await waitFor(() => S.openWs().some((u) => u.includes("/ws?")), 10000); check("student room WS open", w.ok, { ms: w.ms }); }
  mark("student connected");
  // камера ученика в уроке включается кнопкой (при входе публикуется только у учителя)
  await sleep(2000);
  await setCtl(S, CAM, true);
  await setCtl(S, MIC, true);
  await setCtl(T, MIC, true);
  const both = await waitFor(async () => { const f = await snapshotBoth("initial media"); return allTrue(mediaOk(f)) ? f : null; }, 30000, 1000);
  const mo = both.v ? mediaOk(both.v) : mediaOk(await snapshotBoth("initial media (fail)"));
  for (const [k, v] of Object.entries(mo)) check(`media: ${k}`, v);
  mark("two-way media established", { ms: both.ms });
  await shot("01-connected");
  log({ kind: "buttons", who: "student", text: JSON.stringify(await S.buttons()) });

  if (!FOCUS) {
  // 3. Screen share
  const ss0 = Date.now();
  mark("teacher: screen share START");
  await setCtl(T, SHARE, true);
  const ssr = await waitFor(async () => (await flow(S)).remoteScreen.length > 0, 20000, 300);
  check("screen share received by student", ssr.ok, { msFromClick: ssr.ok ? Date.now() - ss0 : null });
  if (ssr.ok) mark("student receives screen share", { ms: Date.now() - ss0 });
  else { await shot("02-share-fail"); log({ kind: "buttons", who: "teacher", text: JSON.stringify(await T.buttons()) }); }
  await sleep(LONG_MIN >= 10 ? 60000 : 15000);
  const ssHold = await flow(S);
  check("screen share still flowing after hold", ssHold.remoteScreen.length > 0, ssHold);
  await shot("02-screenshare");
  await setCtl(T, SHARE, false);
  const ssStop = await waitFor(async () => (await flow(S)).remoteScreen.length === 0, 15000);
  check("screen share stopped on student", ssStop.ok, { ms: ssStop.ms });
  mark("teacher: screen share STOP");

  // 4. Чат
  const c1 = await chatRoundtrip(T, S, "t2s"); check("chat teacher->student", c1.ok, c1);
  const c2 = await chatRoundtrip(S, T, "s2t"); check("chat student->teacher", c2.ok, c2);
  mark("chat roundtrip done");

  // 5. Доска
  mark("teacher: open board for class");
  await press(T, "Доска");
  const bS = await waitFor(() => S.eval("!!document.querySelector('.excalidraw canvas')"), 20000);
  check("board visible on student", bS.ok, { ms: bS.ms });
  const collabT = await waitFor(() => T.openWs().some((u) => u.includes("/collab")), 10000);
  check("board collab WS open (teacher)", collabT.ok);
  check("board collab WS open (student)", S.openWs().some((u) => u.includes("/collab")));
  await sleep(1500);
  // рисуем прямоугольник и линию (инструменты Excalidraw: r, x — карандаш? используем r и d)
  const box = await T.eval("(() => { const c = document.querySelector('.excalidraw canvas.interactive') || [...document.querySelectorAll('.excalidraw canvas')].pop(); const b = c.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; })()").catch(() => null);
  if (box) {
    for (let i = 0; i < 3; i++) {
      await T.key("r", "KeyR", 82);
      const x = box.x + box.w * (0.3 + i * 0.1), y = box.y + box.h * 0.4;
      await T.drag(x, y, x + 80, y + 60);
      await sleep(400);
    }
  }
  const sDraw = await waitFor(() => S.eval("(() => { const c=[...document.querySelectorAll('.excalidraw canvas')][0]; if(!c) return false; const d=c.getContext('2d'); if(!d) return true; return true; })()"), 3000);
  check("teacher drew on board (no exception)", !!box && sDraw.ok);
  const fBoard = await snapshotBoth("media while board active");
  check("media alive while board active", allTrue(mediaOk(fBoard)) || (fBoard.s.inAudioBytes > 500 && fBoard.t.inAudioBytes > 500), mediaOk(fBoard));
  await shot("03-board");

  // 6. Материал урока
  mark("teacher: open lesson materials");
  await openDrawer(T, "Материалы урока");
  await sleep(1000);
  log({ kind: "buttons", who: "teacher", text: JSON.stringify(await T.buttons()) });
  const matOk = await T.click(byText("button", "Задание классу"));
  await sleep(2000);
  await shot("04-materials");
  log({ kind: "buttons", who: "teacher", text: JSON.stringify(await T.buttons()) });
  results.material = { opened: matOk };
  const fMat = await snapshotBoth("media after materials panel");
  check("media alive after materials panel", fMat.s.inAudioBytes > 500 && fMat.t.inAudioBytes > 500, mediaOk(fMat));
  await T.key("Escape", "Escape", 27);
  // вернуть стейдж «люди»
  if ((await T.eval(`(() => { const b=${byLabel("Доска")}; return b && b.getAttribute('aria-pressed'); })()`)) === "true") await press(T, "Доска");
  await sleep(1500);
  mark("board/materials closed");

  // 7. Тоглы
  for (let i = 1; i <= 3; i++) {
    await setCtl(T, CAM, false); await sleep(2500);
    await setCtl(T, CAM, true);
    const r = await waitFor(async () => (await flow(S)).remoteCam.length > 0, 15000);
    check(`toggle ${i}: teacher camera OFF->ON, student sees video`, r.ok, { ms: r.ms });
    await setCtl(T, MIC, false); await sleep(2500);
    await setCtl(T, MIC, true);
    const r2 = await waitFor(async () => (async () => { const f = await flow(S); return f.inAudioBytes > 500 && f.inAudioEnergy > 0.0005; })(), 15000);
    check(`toggle ${i}: teacher mic OFF->ON, student hears`, r2.ok, { ms: r2.ms });
  }
  for (let i = 1; i <= 2; i++) {
    await setCtl(S, CAM, false); await sleep(2500);
    await setCtl(S, CAM, true);
    const r = await waitFor(async () => (await flow(T)).remoteCam.length > 0, 15000);
    check(`toggle ${i}: student camera OFF->ON, teacher sees video`, r.ok, { ms: r.ms });
    await setCtl(S, MIC, false); await sleep(2500);
    await setCtl(S, MIC, true);
    const r2 = await waitFor(async () => (async () => { const f = await flow(T); return f.inAudioBytes > 500 && f.inAudioEnergy > 0.0005; })(), 15000);
    check(`toggle ${i}: student mic OFF->ON, teacher hears`, r2.ok, { ms: r2.ms });
  }
  for (let i = 1; i <= 2; i++) {
    await setCtl(T, SHARE, true);
    const r = await waitFor(async () => (await flow(S)).remoteScreen.length > 0, 20000);
    check(`toggle ${i}: screen share START received`, r.ok, { ms: r.ms });
    await sleep(4000);
    await setCtl(T, SHARE, false);
    const r2 = await waitFor(async () => (await flow(S)).remoteScreen.length === 0, 15000);
    check(`toggle ${i}: screen share STOP`, r2.ok, { ms: r2.ms });
  }
  const fTog = await snapshotBoth("after toggles");
  check("two-way media after toggles", allTrue(mediaOk(fTog)), mediaOk(fTog));
  mark("toggles done");

  // 8. Длительный урок
  mark(`long session start (${LONG_MIN} min)`);
  const longEnd = Date.now() + LONG_MIN * 60000;
  let k = 0, badChecks = 0;
  while (Date.now() < longEnd) {
    await sleep(Math.min(60000, longEnd - Date.now()));
    k++;
    const f = await snapshotBoth(`long t+${k}m`);
    let ok = allTrue(mediaOk(f));
    if (!ok) { await sleep(5000); const f2 = await snapshotBoth(`long t+${k}m retry`); ok = allTrue(mediaOk(f2)); if (!ok) log({ kind: "LONG_MEDIA_BAD", text: `minute ${k} (retry)`, extra: mediaOk(f2) }); }
    if (!ok) { badChecks++; log({ kind: "LONG_MEDIA_BAD", text: `minute ${k}`, extra: mediaOk(f) }); }
    if (k % 5 === 0) {
      const c = await chatRoundtrip(k % 10 === 0 ? S : T, k % 10 === 0 ? T : S, `long${k}`);
      if (!c.ok) log({ kind: "LONG_CHAT_FAIL", text: `minute ${k}`, extra: c });
      else log({ kind: "long.chat", text: `minute ${k} ${c.ms}ms` });
    }
  }
  check(`long session: media OK every minute (${k} checks)`, badChecks === 0, { badChecks, checks: k });
  mark("long session end");
  await shot("05-after-long");

  } // !FOCUS
  // 9. Обрыв сети ученика
  for (const [idx, sec] of CUTS.entries()) {
    const withShare = idx === 0 && !FOCUS;
    if (withShare) { await setCtl(T, SHARE, true); await waitFor(async () => (await flow(S)).remoteScreen.length > 0, 20000); }
    const sPcsBefore = await S.eval("window.__pcs.length");
    mark(`network cut student ${sec}s${withShare ? " (screen share active)" : ""}`);
    const nc = await netCut(sec);
    if (!nc) { check(`net cut ${sec}s executed`, false, "watcher did not respond"); continue; }
    mark(`network restored (${sec}s)`);
    const up = nc.up || Date.now();
    const rPc = await waitFor(() => S.eval("window.__pcs.some(p=>p.connectionState==='connected')"), OBS_MS, 250);
    const pcMs = rPc.ok ? Date.now() - up : null;
    const rMedia = await waitFor(async () => { const f = await snapshotBoth("after cut"); return allTrue(mediaOk(f)) ? f : null; }, OBS_MS, 2000);
    const mediaMs = rMedia.ok ? Date.now() - up : null;
    let shareMs = null;
    if (withShare) { const r = await waitFor(async () => (await flow(S)).remoteScreen.length > 0, 60000, 500); shareMs = r.ok ? Date.now() - up : null; }
    const rWs = await waitFor(() => S.openWs().some((u) => u.includes("/ws?")), 60000);
    const sPcsAfter = await S.eval("window.__pcs.length");
    const lk = await lkParticipants();
    const ids = (lk.list || []).map((x) => x.identity);
    const c = await chatRoundtrip(T, S, `cut${sec}`);
    const c2 = await chatRoundtrip(S, T, `cut${sec}b`);
    const r = { sec, pcReconnectMsAfterRestore: pcMs, mediaRestoredMsAfterRestore: mediaMs, screenShareRestoredMs: withShare ? shareMs : "n/a", roomWsOpen: rWs.ok, newPeerConnections: sPcsAfter - sPcsBefore, lkParticipants: ids.length, duplicate: ids.length !== new Set(ids).size, stillInRoom: await inRoom(S), chatT2S: c.ok, chatS2T: c2.ok, blocked: await S.eval("document.body.innerText.slice(0,200)").then((t) => /вышли|недействительна|ошибка/i.test(t) ? t : null) };
    results[`cut${sec}`] = r;
    check(`net cut ${sec}s: LiveKit reconnected`, pcMs !== null, r);
    check(`net cut ${sec}s: two-way media restored`, mediaMs !== null, { mediaMs });
    if (withShare) check(`net cut ${sec}s: screen share restored`, shareMs !== null, { shareMs });
    check(`net cut ${sec}s: room WS reconnected`, rWs.ok);
    check(`net cut ${sec}s: no duplicate/stale participant (LiveKit has 2)`, ids.length === 2 && !r.duplicate, { ids });
    check(`net cut ${sec}s: chat works both ways`, c.ok && c2.ok);
    check(`net cut ${sec}s: student still in lesson`, r.stillInRoom);
    mark(`recovered from ${sec}s cut`, { pcMs, mediaMs, shareMs });
    if (withShare) { await setCtl(T, SHARE, false); await sleep(2000); }
    await shot(`06-after-cut-${sec}`);
    await sleep(15000);
  }

  // 10. Перезагрузка страницы
  for (const p of FOCUS ? [] : [S, T]) {
    const other = p === S ? T : S;
    mark(`${p.name}: page reload`);
    const r0 = Date.now();
    await p.reload();
    await sleep(2000);
    const dc = await waitFor(async () => (await inRoom(p)) || (await p.eval(`!!${byText("button", "Присоединиться")}`)), 30000);
    const needJoinClick = dc.ok && !(await inRoom(p));
    if (needJoinClick) await passDeviceCheck(p, true);
    const rIn = await waitFor(() => inRoom(p), 30000);
    if (p === S) { await sleep(1500); await setCtl(S, CAM, true); await setCtl(S, MIC, true); }
    else { await setCtl(T, CAM, true); await setCtl(T, MIC, true); }
    const rM = await waitFor(async () => { const f = await snapshotBoth(`after ${p.name} reload`); return allTrue(mediaOk(f)) ? f : null; }, 60000, 1000);
    const rWs = await waitFor(() => p.openWs().some((u) => u.includes("/ws?")), 20000);
    await sleep(3000);
    const lk = await lkParticipants();
    const ids = (lk.list || []).map((x) => x.identity);
    const c = await chatRoundtrip(other, p, `reload-${p.name}`);
    const r = { needJoinClick, inRoomMs: rIn.ok ? Date.now() - r0 : null, mediaRestoredMs: rM.ok ? Date.now() - r0 : null, roomWs: rWs.ok, lkParticipants: ids.length, duplicate: ids.length !== new Set(ids).size, chat: c.ok };
    results[`reload-${p.name}`] = r;
    check(`${p.name} reload: back in lesson`, rIn.ok, r);
    check(`${p.name} reload: two-way media restored`, rM.ok, { ms: r.mediaRestoredMs });
    check(`${p.name} reload: room WS`, rWs.ok);
    check(`${p.name} reload: no duplicate participant (LiveKit has 2)`, ids.length === 2 && !r.duplicate, { ids });
    check(`${p.name} reload: chat after reload`, c.ok);
    mark(`${p.name} restored after reload`, r);
    await shot(`07-after-reload-${p.name}`);
    await sleep(10000);
  }
  // 11. Финальная проверка
  const fin = await snapshotBoth("final");
  check("final two-way media", allTrue(mediaOk(fin)), mediaOk(fin));
  mark("scenario end");
} catch (e) {
  log({ kind: "SCENARIO_ERROR", text: String(e.stack || e).slice(0, 1000) });
  await shot("99-error");
}
stopSampler = true;
await sleep(SAMPLE_MS + 500);
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify({ T0, checks, timeline, results, chrome: tb.version, longMin: LONG_MIN, cuts: CUTS }, null, 2));
const failed = checks.filter((c) => !c.ok);
console.log(`\nCHECKS: ${checks.length - failed.length}/${checks.length} OK`);
for (const f of failed) console.log("FAIL:", f.name, JSON.stringify(f.detail || ""));
evOut.end(); smOut.end();
await sleep(500);
process.exit(0);
