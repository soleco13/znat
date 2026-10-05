// Классный нагрузочный стенд Матис (2026-10-05).
// Ученики-боты проходят тот же путь API/WS, что браузер ученика (записан
// capture.mjs), медиа публикуют `lk room join` под своим identity — для
// LiveKit и для сетки учителя это настоящие участники урока.
import fs from "node:fs";
import { spawn } from "node:child_process";

export const ORIGIN = "https://213.21.241.28";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const OUT = process.env.OUT;
fs.mkdirSync(OUT, { recursive: true });
const evOut = fs.createWriteStream(`${OUT}/events.jsonl`, { flags: "a" });
export const T0 = Date.now();
export const rel = (t = Date.now()) => {
  const s = Math.round((t - T0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export function log(e) {
  e.t = e.t || Date.now();
  e.rel = rel(e.t);
  evOut.write(JSON.stringify(e) + "\n");
  if (!e.quiet) console.log(e.rel, e.kind, e.text || "", e.extra ? JSON.stringify(e.extra).slice(0, 700) : "");
}
export const mark = (text, extra) => log({ kind: "MARK", text, extra });
export const checks = [];
export function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail, rel: rel() });
  log({ kind: ok ? "CHECK_OK" : "CHECK_FAIL", text: name, extra: detail });
  fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify(checks, null, 2));
  return !!ok;
}
export async function waitFor(fn, ms, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return { ok: true, v, ms: Date.now() - t0 };
    } catch {}
    await sleep(step);
  }
  return { ok: false, ms: Date.now() - t0 };
}
export const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
export const stats = (arr) => ({ n: arr.length, p50: pct(arr, 50), p95: pct(arr, 95), max: arr.length ? Math.max(...arr) : null });

// ── HTTP с кукой и замером ───────────────────────────────────────────────
export const api = []; // {who, route, status, ms, t}
const routeOf = (p) => p.replace(/\?.*$/, "").replace(/[0-9a-f]{40,}/g, ":token").replace(/[0-9a-f-]{36}/g, ":id");
export class Http {
  constructor(who) {
    this.who = who;
    this.cookies = new Map();
    this.bearer = null;
  }
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async req(method, path, body, { timeoutMs = 30000 } = {}) {
    const headers = { Origin: ORIGIN };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookies.size) headers.Cookie = this.cookieHeader();
    if (this.bearer) headers.Authorization = `Bearer ${this.bearer}`;
    const t0 = Date.now();
    let status = 0, json = null, err = null;
    try {
      const res = await fetch(`${ORIGIN}/api/v1${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(";");
        const i = kv.indexOf("=");
        this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
      }
      const text = await res.text();
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    } catch (e) {
      err = String(e.name || e);
    }
    const ms = Date.now() - t0;
    api.push({ who: this.who, route: `${method} ${routeOf(path)}`, status, ms, t: t0, err });
    // Access-токен живёт ~15 мин: персонал входит заново (как браузер через refresh).
    if (status === 401 && this.credentials && path !== "/auth/login") {
      const r = await this.req("POST", "/auth/login", this.credentials);
      if (r.json?.accessToken) { this.bearer = r.json.accessToken; return this.req(method, path, body, { timeoutMs }); }
    }
    return { status, json, ms, err };
  }
}

// ── Ученик-бот ───────────────────────────────────────────────────────────
const LK = { url: process.env.LK_URL, key: process.env.LK_KEY, secret: process.env.LK_SECRET };
export const VIDEO_FILE = process.env.VIDEO_FILE || "/media/video.h264";

export class Bot {
  constructor(i, { lessonId, joinPath }) {
    this.i = i;
    this.name = `Ученик ${String(i).padStart(2, "0")}`;
    this.http = new Http(`s${i}`);
    this.lessonId = lessonId;
    this.joinPath = joinPath;
    this.identity = null;
    this.ws = null;
    this.wsState = "closed";
    this.wsConnects = 0;
    this.wsOpenedAt = 0;
    this.msgs = []; // {type, t, extra}
    this.lk = null;
    this.lkWanted = null;
    this.lkStarts = 0;
    this.left = true;
    this.timeline = {};
  }
  async enter() {
    const tok = this.joinPath.replace("/j/", "");
    const t0 = Date.now();
    const info = await this.http.req("GET", `/j/${tok}`);
    await this.http.req("POST", "/auth/refresh"); // hasStaffSession() у реального клиента
    const enter = await this.http.req("POST", `/j/${tok}/enter`, { name: this.name, personalDataConsent: true });
    this.timeline.enterMs = Date.now() - t0;
    if (enter.status !== 201 && enter.status !== 200) throw new Error(`enter ${enter.status} ${JSON.stringify(enter.json)?.slice(0, 120)} info=${info.status}`);
    return enter;
  }
  async join() {
    const t0 = Date.now();
    const r = await this.http.req("POST", `/lessons/${this.lessonId}/join`);
    if (r.status !== 200) throw new Error(`join ${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
    const payload = JSON.parse(Buffer.from(r.json.media.token.split(".")[1], "base64url").toString());
    this.identity = payload.sub;
    this.room = payload.video?.room;
    this.timeline.joinMs = Date.now() - t0;
    this.left = false;
    // То же, что делает страница урока сразу после входа.
    await Promise.all([
      this.http.req("GET", `/lessons/${this.lessonId}/activities`),
      this.http.req("GET", `/lessons/${this.lessonId}/chat`),
    ]);
    return r.json;
  }
  openWs() {
    if (this.left) return;
    const url = `${ORIGIN.replace("https", "wss")}/ws?lessonId=${this.lessonId}&cs=bot-${this.i}&attempt=${this.wsConnects}`;
    const t0 = Date.now();
    this.wsState = this.wsConnects === 0 ? "connecting" : "reconnecting";
    this.wsConnects += 1;
    const ws = new WebSocket(url, { headers: { Cookie: this.http.cookieHeader(), Origin: ORIGIN } });
    this.ws = ws;
    let last = Date.now();
    ws.onopen = () => {
      this.wsState = "connected";
      this.wsOpenedAt = Date.now();
      if (this.timeline.wsOpenMs === undefined) this.timeline.wsOpenMs = Date.now() - t0;
    };
    ws.onmessage = (e) => {
      last = Date.now();
      try {
        const m = JSON.parse(e.data);
        this.msgs.push({ type: m.type, t: Date.now(), body: m.message?.body, id: m.message?.id, extra: m.mode || m.stage || m.activityId || undefined });
        if (this.msgs.length > 5000) this.msgs.splice(0, 1000);
        if (m.type === "presence" && this.timeline.presenceAt === undefined) this.timeline.presenceAt = Date.now();
      } catch {}
    };
    ws.onclose = (e) => {
      if (ws !== this.ws) return;
      clearInterval(stale);
      if (this.holdWs) { this.wsState = "reconnecting"; return; }
      this.wsState = "reconnecting";
      log({ kind: "bot.ws.closed", text: `s${this.i} code=${e.code}`, quiet: true });
      if (this.left || e.code === 4005) { this.wsState = "closed"; return; }
      const delay = Math.min(1000 * 2 ** Math.min(this.wsFails = (this.wsFails || 0) + 1, 4), 16000);
      setTimeout(async () => {
        if (this.left) return;
        if (e.code === 4003) await this.http.req("POST", `/lessons/${this.lessonId}/join`).catch(() => {});
        this.openWs();
      }, delay);
    };
    ws.onerror = () => {};
    // Как клиент: 50 с без сообщений (пульс сервера 20 с) — сокет мёртв.
    const stale = setInterval(() => {
      if (ws !== this.ws) return clearInterval(stale);
      if (ws.readyState === 1 && Date.now() - last > 50000) { try { ws.close(4000); } catch {} }
      if (ws.readyState === 1) this.wsFails = 0;
    }, 5000);
  }
  /** Обрыв только канала урока на `ms` (медиа LiveKit живёт): как короткий разрыв сокета на мобильной сети. */
  dropWs(ms) {
    this.holdWs = true;
    try { this.ws?.close(4000, "test-drop"); } catch {}
    setTimeout(() => { this.holdWs = false; this.openWs(); }, ms);
  }
  /** Медиа: видео-файл (камера) и/или аудио-файл (говорит по расписанию файла). */
  startMedia({ video = false, audio = null, presence = false } = {}) {
    this.stopMedia();
    // presence — в комнате LiveKit без треков (камера и микрофон выключены).
    if (!video && !audio && !presence) return;
    const args = ["room", "join", "--url", LK.url, "--api-key", LK.key, "--api-secret", LK.secret, "--identity", this.identity];
    if (video) args.push("--publish", VIDEO_FILE, "--fps", "15");
    if (audio) args.push("--publish", audio);
    args.push(this.room);
    const p = spawn("lk", args, { stdio: ["ignore", "ignore", "pipe"] });
    this.lkWanted = { video, audio };
    this.lkStarts += 1;
    let tail = "";
    p.stderr.on("data", (d) => { tail = (tail + d).slice(-600); });
    p.on("exit", (code) => {
      if (this.lk === p) {
        this.lk = null;
        log({ kind: "bot.lk.exit", text: `s${this.i} code=${code}`, extra: { tail: tail.slice(-300) }, quiet: code === null });
      }
    });
    this.lk = p;
  }
  stopMedia() {
    const p = this.lk;
    this.lk = null;
    this.lkWanted = null;
    if (p) p.kill("SIGINT");
  }
  async leave() {
    this.left = true;
    this.stopMedia();
    const r = await this.http.req("POST", `/lessons/${this.lessonId}/leave`);
    try { this.ws?.close(); } catch {}
    this.wsState = "closed";
    return r;
  }
  async chat(body) {
    return this.http.req("POST", `/lessons/${this.lessonId}/chat`, { body, clientMessageId: crypto.randomUUID() });
  }
  firstMsg(pred, since) {
    return this.msgs.find((m) => m.t >= since && pred(m));
  }
}

// ── Браузер учителя: зонд производительности ─────────────────────────────
export const PROBE = `(() => {
  if (window.__probe) return;
  const P = window.__probe = { commits: 0, fnRenders: 0, videoRenders: 0, videoMounts: 0, mut: 0, longN: 0, longMs: 0, frames: 0,
    events: [], videosAdded: 0, videosRemoved: 0, layout: [], tileMoves: 0, lastTiles: null, lastGrid: '' };
  // React: счётчик коммитов и перерисовок через крючок DevTools (работает и в прод-сборке).
  const visit = (f) => {
    for (let c = f; c; c = c.sibling) {
      const a = c.alternate;
      if (typeof c.type === 'function' && (!a || (c.flags & 1))) P.fnRenders++;
      if (c.type === 'video') { if (!a) P.videoMounts++; else if (a.memoizedProps !== c.memoizedProps) P.videoRenders++; }
      if (c.child && (!a || c.child !== a.child)) visit(c.child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), inject() { return 1; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
    onCommitFiberRoot(id, root) { P.commits++; try { visit(root.current.child); } catch {} } };
  const loop = () => { P.frames++; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { P.longN++; P.longMs += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.interactionId || e.name === 'click' || e.name === 'pointerdown' || e.name === 'keydown') P.events.push({ n: e.name, d: Math.round(e.duration), delay: Math.round(e.processingStart - e.startTime), t: Math.round(e.startTime) }); } if (P.events.length > 500) P.events.splice(0, 200); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
  const mo = new MutationObserver((recs) => { P.mut += recs.length; for (const r of recs) { for (const n of r.addedNodes) { if (n.nodeName === 'VIDEO') P.videosAdded++; else if (n.querySelectorAll) P.videosAdded += n.querySelectorAll('video').length; } for (const n of r.removedNodes) { if (n.nodeName === 'VIDEO') P.videosRemoved++; else if (n.querySelectorAll) P.videosRemoved += n.querySelectorAll('video').length; } } });
  const start = () => mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  // Сетка: колонки/ребро и сдвиги плиток (по подписи с именем) каждые 200 мс.
  const gridEl = () => [...document.querySelectorAll('div.grid')].find((d) => /repeat\\(/.test(d.style.gridTemplateColumns || ''));
  setInterval(() => {
    const g = gridEl();
    const key = g ? g.style.gridTemplateColumns + '|' + g.children.length : 'none';
    if (key !== P.lastGrid) { P.layout.push({ t: Math.round(performance.now()), key }); P.lastGrid = key; if (P.layout.length > 400) P.layout.splice(0, 100); }
    const tiles = {};
    for (const el of (g ? g.children : [])) { const r = el.getBoundingClientRect(); const name = (el.innerText || '').split('\\n').pop().trim() || '?'; tiles[name] = Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width); }
    if (P.lastTiles) for (const k in tiles) if (P.lastTiles[k] && P.lastTiles[k] !== tiles[k]) P.tileMoves++;
    P.lastTiles = tiles;
  }, 200);
  window.__snap = () => {
    const vids = [...document.querySelectorAll('video')];
    let dec = 0, drop = 0, playing = 0, visible = 0;
    for (const v of vids) { const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null; if (q) { dec += q.totalVideoFrames; drop += q.droppedVideoFrames; } if (!v.paused && v.readyState >= 2) playing++; const r = v.getBoundingClientRect(); if (r.width > 0 && r.height > 0) visible++; }
    const g = gridEl();
    return { commits: P.commits, fnRenders: P.fnRenders, videoRenders: P.videoRenders, videoMounts: P.videoMounts, mut: P.mut, longN: P.longN, longMs: Math.round(P.longMs), frames: P.frames,
      videos: vids.length, videosVisible: visible, videosPlaying: playing, framesDecoded: dec, framesDropped: drop, videosAdded: P.videosAdded, videosRemoved: P.videosRemoved,
      grid: g ? g.style.gridTemplateColumns : null, gridChildren: g ? g.children.length : 0, layoutChanges: P.layout.length, tileMoves: P.tileMoves,
      dom: document.getElementsByTagName('*').length, heap: performance.memory ? performance.memory.usedJSHeapSize : null, events: P.events.splice(0) };
  };
})();`;

/** Сэмпл производительности вкладки: зонд + Performance.getMetrics. */
export async function perfSample(page) {
  const snap = await page.eval("window.__snap ? window.__snap() : null", 15000).catch((e) => ({ err: String(e).slice(0, 100) }));
  const m = await page.send("Performance.getMetrics", {}, 15000).catch(() => null);
  const pm = {};
  for (const x of m?.metrics ?? []) pm[x.name] = x.value;
  return {
    t: Date.now(),
    ...snap,
    cdp: {
      nodes: pm.Nodes, heapUsed: pm.JSHeapUsedSize, heapTotal: pm.JSHeapTotalSize, listeners: pm.JSEventListeners,
      layoutCount: pm.LayoutCount, recalcCount: pm.RecalcStyleCount, layoutMs: Math.round((pm.LayoutDuration || 0) * 1000),
      recalcMs: Math.round((pm.RecalcStyleDuration || 0) * 1000), scriptMs: Math.round((pm.ScriptDuration || 0) * 1000), taskMs: Math.round((pm.TaskDuration || 0) * 1000),
    },
  };
}

/** Разница двух сэмплов → скорости за интервал. */
export function perfDelta(a, b) {
  const s = (b.t - a.t) / 1000;
  const d = (k) => (b[k] ?? 0) - (a[k] ?? 0);
  const dc = (k) => (b.cdp?.[k] ?? 0) - (a.cdp?.[k] ?? 0);
  return {
    sec: Math.round(s), fps: +(d("frames") / s).toFixed(1), commitsPerSec: +(d("commits") / s).toFixed(1), fnRendersPerSec: Math.round(d("fnRenders") / s),
    videoRenders: d("videoRenders"), videoMounts: d("videoMounts"), mutPerSec: Math.round(d("mut") / s), longTasks: d("longN"), longTaskMs: d("longMs"),
    longTaskPct: +((d("longMs") / (s * 1000)) * 100).toFixed(1), decodedFps: +(d("framesDecoded") / s).toFixed(1), droppedFrames: d("framesDropped"),
    layoutPerSec: +(dc("layoutCount") / s).toFixed(1), recalcPerSec: +(dc("recalcCount") / s).toFixed(1), layoutMsPerSec: Math.round(dc("layoutMs") / s),
    recalcMsPerSec: Math.round(dc("recalcMs") / s), scriptPct: +((dc("scriptMs") / (s * 1000)) * 100).toFixed(1), taskPct: +((dc("taskMs") / (s * 1000)) * 100).toFixed(1),
    tileMoves: d("tileMoves"), gridChanges: d("layoutChanges"), videosAdded: d("videosAdded"), videosRemoved: d("videosRemoved"),
    videos: b.videos, videosVisible: b.videosVisible, videosPlaying: b.videosPlaying, dom: b.dom, heapMB: b.heap ? +(b.heap / 1048576).toFixed(1) : null, grid: b.grid, gridChildren: b.gridChildren,
  };
}

/** WebRTC-статистика вкладки (обёртка INSTRUMENT из cdp.mjs). */
export async function rtcSummary(page) {
  const pcs = await page.eval("window.__collect ? window.__collect() : []", 20000).catch(() => []);
  let inV = 0, inA = 0, lost = 0, recv = 0, jitter = [], freezes = 0, dropped = 0, decoded = 0, inKbps = 0, rtt = [];
  for (const pc of pcs) {
    if (pc.pair?.rtt != null) rtt.push(pc.pair.rtt * 1000);
    for (const r of pc.inbound || []) {
      if (r.kind === "video") { inV++; dropped += r.framesDropped || 0; decoded += r.framesDecoded || 0; freezes += r.freezeCount || 0; }
      else inA++;
      lost += r.packetsLost || 0; recv += r.packetsReceived || 0;
      if (r.jitter != null) jitter.push(r.jitter * 1000);
      inKbps += r.bytesReceived || 0;
    }
  }
  return { pcs: pcs.length, inVideo: inV, inAudio: inA, lossPct: recv ? +((lost / (lost + recv)) * 100).toFixed(2) : 0, jitterP95Ms: pct(jitter, 95), rttMs: rtt.length ? Math.round(Math.max(...rtt)) : null, freezes, framesDropped: dropped, framesDecoded: decoded, bytesIn: inKbps };
}
