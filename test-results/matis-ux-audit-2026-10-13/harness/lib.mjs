// Общая часть сценариев UX-аудита 2026-10-13 (основа — обвязка 2026-10-04).
// Взаимодействие с приложением — настоящими событиями мыши/клавиатуры через CDP;
// из страницы только читаем (DOM, getStats, <video>). Сеть — через netctl.py.
import fs from "node:fs";
import { connectBrowser, openPage, sleep, byText, byLabel } from "./cdp.mjs";
export { sleep, byText, byLabel };

export const ORIGIN = process.env.ORIGIN || "http://172.31.0.1:3100";
export const LID = process.env.LID || "7df1a7ae-fa77-4ab4-acb7-db7943e9188d";
export const JOIN = process.env.JOIN_PATH || "/j/758e82a0bbca21932a07183e3f35a90f630d8f7a1ce8c3a21f575af8fadb8ca2";
export const OUT = process.env.OUT || "/out";
const CTL = process.env.CTL || "/w/ctl";
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

export const T0 = Date.now();
export const rel = (t = Date.now()) => ((t - T0) / 1000).toFixed(1).padStart(6);
const evOut = fs.createWriteStream(`${OUT}/events.jsonl`);
export const log = (e) => {
  e.t = e.t || Date.now();
  e.rel = rel(e.t);
  evOut.write(JSON.stringify(e) + "\n");
  if (!e.quiet) console.log(e.rel, e.who || "", e.kind, e.text || e.url || e.status || "", e.extra ? JSON.stringify(e.extra).slice(0, 500) : "");
};
export const mark = (text, extra) => log({ kind: "MARK", text, extra });
export const checks = [];
export const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail, rel: rel() });
  log({ kind: ok ? "CHECK_OK" : "CHECK_FAIL", text: name, extra: detail });
  return !!ok;
};

// ── сеть и оракул БД стенда (netctl.py на хосте) ──
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
export const profile = async (who, p) => { const r = await ctl({ cmd: "profile", who, profile: p }); log({ kind: "NET", text: `${who} -> ${p}` }); return r; };
export const clearNet = async (who) => { await ctl({ cmd: "clear", who }); log({ kind: "NET", text: `${who} -> clear` }); };
export const cut = async (who, on) => { await ctl({ cmd: "cut", who, on }); log({ kind: "NET", text: `${who} ${on ? "CUT" : "restored"}` }); };
export const block = async (who, mode) => { await ctl({ cmd: "block", who, mode }); log({ kind: "NET", text: `${who} block=${mode}` }); };
export const sql = async (q) => (await ctl({ cmd: "sql", q })).rows || [];

// ── браузеры ──
export const P = {};
export let chromeVersion;
export async function openBrowsers(names = ["teacher", "s1"]) {
  for (const n of names) {
    const b = await connectBrowser(process.env[`CDP_${n}`]);
    chromeVersion = b.version;
    const { targetInfos } = await b.call("Target.getTargets");
    for (const ti of targetInfos) if (ti.type === "page") await b.call("Target.closeTarget", { targetId: ti.targetId }).catch(() => {});
    // Отдельный контекст на прогон — чистые куки/хранилище, без хвостов прошлых сценариев.
    const { browserContextId } = await b.call("Target.createBrowserContext");
    P[n] = await openPage(b, n, log, browserContextId);
    P[n].browser = b;
    P[n].ctx = browserContextId;
    await P[n].send("Browser.grantPermissions", { browserContextId, origin: ORIGIN, permissions: ["audioCapture", "videoCapture", "displayCapture", "clipboardReadWrite", "clipboardSanitizedWrite"] }, ).catch(() => {});
  }
  log({ kind: "env", text: chromeVersion });
  return P;
}
/** Вторая вкладка в том же браузере и контексте (общие куки и localStorage). */
export async function secondTab(p, name) {
  const t = await openPage(p.browser, name, log, p.ctx);
  t.browser = p.browser;
  t.ctx = p.ctx;
  return t;
}

// ── что видит человек ──
const UI_STATE = `(() => {
  const txt = document.body ? document.body.innerText : '';
  const has = (s) => txt.includes(s);
  const toasts = [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.innerText.trim().replace(/\\s+/g,' ').slice(0,140));
  return {
    path: location.pathname,
    inRoom: !!document.querySelector('[aria-label="Чат"]'),
    deviceCheck: [...document.querySelectorAll('button')].some(b => b.innerText.includes('Присоединиться')),
    overlayReconnect: has('Связь прервалась'),
    pills: ['Переподключение…','Подключение…','Восстанавливаем звук и видео…'].filter(has),
    takenOver: has('Урок открыт в другом окне'),
    blocked: /Вас удалили|Вход закрыт|Ссылка недействительна|мест нет|Нет доступа/.test(txt) ? txt.slice(0, 160) : null,
    error: /Что-то пошло не так|Не удалось/.test(txt) ? (txt.match(/(Что-то пошло не так|Не удалось[^\\n]*)/) || [])[0] : null,
    toasts,
    spinners: document.querySelectorAll('.animate-spin').length,
  };
})()`;
export const ui = (p) => p.eval(UI_STATE, 8000).catch((e) => ({ err: String(e).slice(0, 120) }));
export const text = (p) => p.eval("document.body.innerText", 8000).catch(() => "");
export const countText = (p, t) => p.eval(`(document.body.innerText.split(${JSON.stringify(t)}).length - 1)`).catch(() => -1);

export async function waitFor(fn, timeoutMs, step = 400) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - start, v }; } catch {}
    await sleep(step);
  }
  return { ok: false, ms: Date.now() - start };
}

/** Звук/видео за 3 с: что реально приходит и уходит (getStats). */
export async function flow(p, gapMs = 3000) {
  const snap = () => p.eval("(async()=>({s:await window.__collect(),v:window.__videos()}))()", 10000);
  const a = await snap(); await sleep(gapMs); const b = await snap();
  const sum = (sn, dir, kind, f) => sn.s.filter((x) => x.conn !== "closed").flatMap((x) => x[dir] || []).filter((x) => x.kind === kind).reduce((acc, x) => acc + (x[f] || 0), 0);
  const vid = b.v.map((v, i) => ({ local: v.local === "true", adv: (v.frames || 0) - (a.v[i]?.frames || 0), res: `${v.w}x${v.h}` }));
  return {
    inAudioBytes: sum(b, "inbound", "audio", "bytesReceived") - sum(a, "inbound", "audio", "bytesReceived"),
    inAudioEnergy: sum(b, "inbound", "audio", "totalAudioEnergy") - sum(a, "inbound", "audio", "totalAudioEnergy"),
    outAudioBytes: sum(b, "outbound", "audio", "bytesSent") - sum(a, "outbound", "audio", "bytesSent"),
    outVideoBytes: sum(b, "outbound", "video", "bytesSent") - sum(a, "outbound", "video", "bytesSent"),
    inVideoFrames: sum(b, "inbound", "video", "framesDecoded") - sum(a, "inbound", "video", "framesDecoded"),
    remoteVideoPlaying: vid.filter((v) => !v.local && v.adv > 0).length,
  };
}
export const hears = (f) => f.inAudioBytes > 300 && f.inAudioEnergy > 0.0002;

// ── действия ──
export async function press(p, label) {
  const ok = await p.click(byLabel(label));
  if (!ok) log({ who: p.name, kind: "ui.miss", text: `button "${label}" not found` });
  return ok;
}
export const pressed = (p, label) => p.eval(`(() => { const b = ${byLabel(label)}; return b ? b.getAttribute('aria-pressed') : null; })()`).catch(() => null);
export const labelOf = (p, labels) => p.eval(`(() => { const L = ${JSON.stringify(labels)}; const b = [...document.querySelectorAll('button[aria-label]')].find(e => e.getBoundingClientRect().width > 0 && L.includes(e.getAttribute('aria-label'))); return b ? b.getAttribute('aria-label') : null; })()`).catch(() => null);
export const MIC = { on: "Микрофон", off: "Включить звук" };
export const CAM = { on: "Камера", off: "Включить камеру" };
export const SHARE = { on: "Остановить демонстрацию", off: "Демонстрация" };
export const ctlState = async (p, c) => { const cur = await labelOf(p, [c.on, c.off]); return cur == null ? null : cur === c.on; };
export const inRoom = (p) => p.eval(`!!${byLabel("Чат")}`).catch(() => false);

export async function login(p, email = "teacher@school.dev", pw = "password123") {
  await p.goto(`${ORIGIN}/login`);
  await waitFor(() => p.eval("!!document.querySelector('input[type=email]') || location.pathname.startsWith('/lessons')"), 30000);
  if (await p.eval("location.pathname.startsWith('/lessons')")) return true;
  await p.click("document.querySelector('input[type=email]')"); await p.type(email);
  await p.click("document.querySelector('input[type=password]')"); await p.type(pw);
  await p.click("document.querySelector('button[type=submit]')");
  return (await waitFor(() => p.eval("location.pathname.startsWith('/lessons')"), 30000)).ok;
}
/** Экран проверки устройств: выставить камеру/микрофон и нажать «Присоединиться». */
export async function passDeviceCheck(p, { cam = true, mic = true } = {}, timeoutMs = 45000) {
  const r = await waitFor(async () => (await inRoom(p)) || p.eval(`!!${byText("button", "Присоединиться")}`), timeoutMs);
  if (!r.ok) return false;
  if (await inRoom(p)) return true;
  await sleep(1200);
  for (const [label, want] of [["Камера", cam], ["Микрофон", mic]]) {
    const st = await pressed(p, label);
    if (st !== null && (st === "true") !== want) await p.click(byLabel(label));
  }
  await sleep(400);
  await p.click(byText("button", "Присоединиться"));
  return (await waitFor(() => inRoom(p), timeoutMs)).ok;
}
export async function teacherJoin(p, opts) {
  if (!(await login(p))) return false;
  await p.goto(`${ORIGIN}/lessons/${LID}/room`);
  return passDeviceCheck(p, opts);
}
export async function guestEnter(p, name, opts) {
  await p.goto(`${ORIGIN}${JOIN}`);
  const r = await waitFor(() => p.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]') || !!${byText("button", "Присоединиться")} || !!${byLabel("Чат")}`), 45000);
  if (!r.ok) return false;
  if (await p.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`)) {
    await p.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await p.type(name);
    await p.click(`document.querySelector('[role=checkbox]')`);
    await sleep(300);
    await p.click("document.querySelector('button[type=submit]')");
  }
  return passDeviceCheck(p, opts);
}
export async function openDrawer(p, label) {
  if ((await pressed(p, label)) !== "true") await press(p, label);
  await sleep(500);
}
export async function sendChat(p, msg) {
  await openDrawer(p, "Чат");
  if (!(await p.click(byLabel("Сообщение классу")))) return false;
  await p.type(msg);
  return press(p, "Отправить");
}
export const shot = (p, name) => p.shot(`${OUT}/shots/${name}-${p.name}.png`).catch(() => {});
export async function finish(extra = {}) {
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify({ T0, chrome: chromeVersion, checks, ...extra }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\nCHECKS: ${checks.length - failed.length}/${checks.length} OK`);
  for (const f of failed) console.log("FAIL:", f.name, JSON.stringify(f.detail ?? "").slice(0, 300));
  evOut.end();
  await sleep(300);
  process.exit(0);
}

/** Запрос API от имени вошедшего учителя (access-токен — через refresh-куку). */
export async function teacherApi(p, method, path, body) {
  return p.eval(`(async () => {
    const r = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" }).then(r => r.json());
    const res = await fetch("/api/v1${path}", { method: ${JSON.stringify(method)}, headers: ${body === undefined ? `{ authorization: "Bearer " + r.accessToken }` : `{ "content-type": "application/json", authorization: "Bearer " + r.accessToken }`}, body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} });
    return res.status;
  })()`);
}
/** Исходное состояние урока стенда: чат открыт, вход открыт, стейдж — участники, лекция. */
export async function resetLesson(p) {
  const r = {};
  r.chat = await teacherApi(p, "PATCH", `/lessons/${LID}/chat-lock`, { locked: false });
  r.entry = await teacherApi(p, "PATCH", `/lessons/${LID}/entry`, { locked: false });
  r.stage = await teacherApi(p, "PATCH", `/lessons/${LID}/stage`, { stage: "people" });
  r.mode = await teacherApi(p, "PATCH", `/lessons/${LID}/mode`, { mode: "lecture" });
  log({ kind: "reset", extra: r });
  return r;
}

/** Подмена ответов сервера в вкладке (CDP Fetch): [{ match: /re/, method?, status?, abort?, delayMs? }]. */
export async function intercept(p, rules) {
  if (!rules.length) { await p.send("Fetch.disable").catch(() => {}); p.__rules = []; return; }
  p.__rules = rules;
  if (!p.__fetchHooked) {
    p.__fetchHooked = true;
    const prev = p.browser.listeners.get(p.sessionId);
    p.browser.listeners.set(p.sessionId, async (method, params) => {
      if (method !== "Fetch.requestPaused") return prev?.(method, params);
      const r = (p.__rules || []).find((x) => x.match.test(params.request.url) && (!x.method || x.method === params.request.method));
      if (!r) return p.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
      log({ who: p.name, kind: "intercept", text: `${params.request.method} ${params.request.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 80)} -> ${r.abort ? "abort" : r.status}` });
      if (r.delayMs) await sleep(r.delayMs);
      if (r.abort) return p.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionReset" }).catch(() => {});
      const body = Buffer.from(JSON.stringify({ error: "internal_error", message: "Internal Server Error" })).toString("base64");
      return p.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: r.status, responseHeaders: [{ name: "content-type", value: "application/json" }], body }).catch(() => {});
    });
  }
  // stage "Response": запрос дошёл до сервера, теряем/подменяем уже ответ.
  const stages = [...new Set(rules.map((r) => r.stage || "Request"))];
  await p.send("Fetch.enable", { patterns: stages.map((requestStage) => ({ urlPattern: "*/api/v1/*", requestStage })) });
}
