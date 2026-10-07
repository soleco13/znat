// Web perf / network weight: холодный контекст на страницу, учёт всех ответов по CDP.
import fs from "node:fs";
import { connectBrowser, sleep, byText } from "./cdp.mjs";
const ORIGIN = "https://213.21.241.28";
const { LID, JOIN_PATH, T_EMAIL, T_PW, OUT, MAT_ID, PROFILE = "none", PAGES = "landing,login,classroom,student,material,editor", CPU = "1" } = process.env;
fs.mkdirSync(OUT, { recursive: true });
const PROFILES = { // down/up kbit/s, RTT ms
  none: null,
  fast4g: { d: 9000, u: 1500, rtt: 60 }, slow4g: { d: 1600, u: 750, rtt: 150 },
  "3g": { d: 750, u: 250, rtt: 300 }, slow3g: { d: 400, u: 400, rtt: 400 },
};
const prof = PROFILES[PROFILE];
const B = await connectBrowser(process.env.CDP);
const PERF = `(() => { const P = window.__perf = { fcp: null, lcp: null, lt: [] };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') P.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
})();`;
async function api(method, path, body, token) {
  const r = await fetch(ORIGIN + "/api/v1" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), cookie: r.headers.get("set-cookie") };
}
async function fresh(name) {
  const { browserContextId } = await B.call("Target.createBrowserContext", { disposeOnDetach: false });
  const { targetId } = await B.call("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await B.call("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p, t) => B.call(m, p, sessionId, t);
  const reqs = new Map(); const st = { phase: "load" };
  B.listeners.set(sessionId, (m, p) => {
    if (m === "Network.requestWillBeSent") reqs.set(p.requestId, { url: p.request.url, type: p.type, phase: st.phase, t0: p.timestamp, prio: p.request.initialPriority, redirect: !!p.redirectResponse });
    else if (m === "Network.responseReceived") { const r = reqs.get(p.requestId); if (r) { r.status = p.response.status; r.mime = p.response.mimeType; r.proto = p.response.protocol; r.sw = p.response.fromServiceWorker; r.cache = p.response.fromDiskCache; const h = {}; for (const [k, v] of Object.entries(p.response.headers)) h[k.toLowerCase()] = v; r.enc = h["content-encoding"] || ""; r.cc = h["cache-control"] || ""; r.etag = !!h.etag; r.lm = !!h["last-modified"]; r.clen = h["content-length"]; } }
    else if (m === "Network.loadingFinished") { const r = reqs.get(p.requestId); if (r) { r.bytes = Math.max(p.encodedDataLength || 0, r.enc2 || 0); r.t1 = p.timestamp; } }
    else if (m === "Network.loadingFailed") { const r = reqs.get(p.requestId); if (r) { r.failed = p.errorText; r.t1 = p.timestamp; } }
    else if (m === "Network.dataReceived") { const r = reqs.get(p.requestId); if (r) { r.raw = (r.raw || 0) + p.dataLength; r.enc2 = (r.enc2 || 0) + (p.encodedDataLength || 0); } }
  });
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable", { maxTotalBufferSize: 0 });
  await send("Network.setCacheDisabled", { cacheDisabled: false });
  if (process.env.BYPASS_SW !== "0") await send("Network.setBypassServiceWorker", { bypass: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: PERF });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  if (CPU !== "1") await send("Emulation.setCPUThrottlingRate", { rate: Number(CPU) });
  if (prof) await send("Network.emulateNetworkConditions", { offline: false, latency: prof.rtt, downloadThroughput: prof.d * 1000 / 8, uploadThroughput: prof.u * 1000 / 8 });
  const page = { name, send, reqs, st, browserContextId,
    async eval(e, t = 30000) { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, t); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; },
    async click(expr) { const pt = await page.eval(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return b.width ? { x: b.x + b.width/2, y: b.y + b.height/2 } : null; })()`); if (!pt) return false; for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 }); return true; },
    async type(t) { await send("Input.insertText", { text: t }); },
  };
  return page;
}
async function waitFor(fn, ms, step = 250) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - t0 }; } catch {} await sleep(step); } return { ok: false, ms: Date.now() - t0 }; }
// сеть «затихла»: нет новых завершений N мс (WebSocket не считаются)
async function quiet(p, ms = 3000, max = 240000) { const t0 = Date.now(); let since = Date.now(), lastN = -1;
  const isPoll = (r) => /\/ping(\?|$)/.test(r.url) || r.type === "WebSocket" || r.type === "EventSource" || /\/(ws|collab|livekit)/.test(r.url);
  while (Date.now() - t0 < max) {
    const cnt = new Map(); for (const r of p.reqs.values()) { const k = r.url.split("?")[0]; cnt.set(k, (cnt.get(k) || 0) + 1); }
    const rel = [...p.reqs.values()].filter(r => !isPoll(r) && cnt.get(r.url.split("?")[0]) < 3);
    const n = rel.length + rel.filter(r => r.t1 || r.failed).length * 100000;
    if (n !== lastN) { lastN = n; since = Date.now(); }
    const pending = rel.some(r => !r.t1 && !r.failed);
    if (!pending && Date.now() - since > ms) return Date.now() - t0;
    await sleep(250); }
  return -1; }
async function metrics(p) {
  return p.eval(`(() => { const n = performance.getEntriesByType('navigation')[0] || {}; const P = window.__perf || {}; const fcp = P.fcp || 0;
    const tbt = (P.lt || []).filter(([s]) => s >= fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
    const lastLt = (P.lt || []).reduce((a, [s, d]) => Math.max(a, s + d), 0);
    return { dcl: Math.round(n.domContentLoadedEventEnd || 0), load: Math.round(n.loadEventEnd || 0), fcp: Math.round(P.fcp || 0), lcp: Math.round(P.lcp || 0), tbt: Math.round(tbt), longtasks: (P.lt || []).length, ttiApprox: Math.round(Math.max(lastLt, n.domContentLoadedEventEnd || 0)), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null, lt: P.lt, now: Math.round(performance.now()) }; })()`);
}
const results = [];
function dump(p, label, url, m, extra = {}) {
  const rows = [...p.reqs.values()].filter(r => !r.url.startsWith("data:") && r.type !== "WebSocket");
  fs.writeFileSync(`${OUT}/${PROFILE}${CPU !== "1" ? "-cpu" + CPU : ""}-${label}.requests.json`, JSON.stringify(rows, null, 1));
  results.push({ label, url, profile: PROFILE, m, n: rows.length, extra });
  console.log(label, PROFILE, rows.length, rows.reduce((a, r) => a + (r.bytes || 0), 0), JSON.stringify(m), JSON.stringify(extra));
}
async function nav(p, url) { const t0 = Date.now(); await p.send("Page.navigate", { url }); return t0; }
async function setRefresh(p, cookie) { const v = cookie.match(/refresh_token=([^;]+)/)[1]; await p.send("Network.setCookie", { name: "refresh_token", value: v, url: ORIGIN + "/api/v1/auth", path: "/api/v1/auth", secure: true, httpOnly: true, sameSite: "Lax" }); }
async function teacherCookie() { const r = await api("POST", "/auth/login", { email: T_EMAIL, password: T_PW }); if (!r.cookie) throw new Error("login failed " + r.status); return r; }
async function passDeviceCheck(p, ms) { const r = await waitFor(() => p.eval(`!!${byText("button", "Присоединиться")}`), ms); if (!r.ok) return false; await sleep(800); await p.click(byText("button", "Присоединиться")); return (await waitFor(() => p.eval(`!![...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === 'Чат')`), ms)).ok; }
const T_MAX = prof && prof.d < 1000 ? 600000 : 240000;
const pages = PAGES.split(",");
let teacherRoom = null, studentPage = null, tok = null;
try {
  if (pages.includes("landing")) { const p = await fresh("landing"); const t0 = await nav(p, ORIGIN + "/"); await waitFor(() => p.eval("document.readyState==='complete'"), T_MAX); await quiet(p, 3000, T_MAX); dump(p, "landing", "/", await metrics(p), { wall: Date.now() - t0 }); }
  if (pages.includes("login")) { const p = await fresh("login"); const t0 = await nav(p, ORIGIN + "/login"); await waitFor(() => p.eval("!!document.querySelector('input[type=email]')"), T_MAX); const vis = Date.now() - t0; await quiet(p, 3000, T_MAX); dump(p, "login", "/login", await metrics(p), { formVisibleMs: vis, wall: Date.now() - t0 }); }
  if (pages.includes("classroom") || pages.includes("student") || pages.includes("material")) {
    const lg = await teacherCookie(); tok = lg.json.accessToken;
    const p = await fresh("classroom"); await setRefresh(p, lg.cookie);
    const t0 = await nav(p, `${ORIGIN}/lessons/${LID}/room`);
    const pre = await waitFor(() => p.eval(`!!${byText("button", "Присоединиться")}`), T_MAX); const preMs = Date.now() - t0;
    await quiet(p, 3000, T_MAX); const mPre = await metrics(p);
    p.st.phase = "room"; const t1 = Date.now(); const inRoom = await passDeviceCheck(p, T_MAX); const roomMs = Date.now() - t1;
    await quiet(p, 5000, T_MAX);
    let boardMs = null;
    if (process.env.BOARD !== "0") { p.st.phase = "board"; const tb = Date.now();
      const clicked = await p.click(`[...document.querySelectorAll('button')].find(e => e.getBoundingClientRect().width > 0 && ((e.getAttribute('aria-label')||'') === 'Доска' || (e.textContent||'').trim() === 'Доска'))`);
      const ok = clicked && (await waitFor(() => p.eval(`!!document.querySelector('.excalidraw canvas')`), T_MAX)).ok; boardMs = ok ? Date.now() - tb : (clicked ? -1 : -2);
      await quiet(p, 4000, T_MAX);
      p.st.phase = "after"; await p.click(`[...document.querySelectorAll('button')].find(e => e.getBoundingClientRect().width > 0 && ((e.getAttribute('aria-label')||'') === 'Доска' || (e.textContent||'').trim() === 'Доска'))`); await sleep(1500); }
    dump(p, "classroom", `/lessons/${LID}/room`, mPre, { prejoinMs: preMs, inRoom, roomMs, boardMs, wall: Date.now() - t0 });
    teacherRoom = p;
  }
  if (pages.includes("student") || pages.includes("material")) {
    const p = await fresh("student"); const t0 = await nav(p, ORIGIN + JOIN_PATH);
    const f = await waitFor(() => p.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), T_MAX); const formMs = Date.now() - t0;
    if (process.env.FASTJOIN !== "1") await quiet(p, 3000, T_MAX); const mPre = await metrics(p);
    p.st.phase = "join";
    await p.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await p.type("Perf Ученик");
    await p.click(`document.querySelector('[role=checkbox]')`); await sleep(300);
    await p.click(`document.querySelector('button[type=submit]')`);
    const t1 = Date.now(); const inRoom = await passDeviceCheck(p, T_MAX); const roomMs = Date.now() - t1;
    await quiet(p, 5000, T_MAX);
    dump(p, process.env.FASTJOIN === "1" ? "student-fastjoin" : "student", JOIN_PATH.replace(/[0-9a-f]{20,}/, "<token>"), mPre, { formMs, inRoom, roomMs, wall: Date.now() - t0 });
    studentPage = p;
  }
  if (pages.includes("material") && studentPage) {
    const p = studentPage; p.st.phase = "material"; for (const r of p.reqs.values()) r.prev = true;
    const r = await api("POST", `/lessons/${LID}/activities`, { materialId: MAT_ID }, tok);
    const t0 = Date.now();
    const shown = await waitFor(() => p.eval(`!!document.querySelector('.tb, [class*="tb-page"]')`), T_MAX); const shownMs = Date.now() - t0;
    await quiet(p, 4000, T_MAX);
    const rows = [...p.reqs.values()].filter(x => !x.prev);
    const save = p.reqs; p.reqs = new Map(rows.map((x, i) => [i, x])); dump(p, "material", "(in-lesson activity)", await metrics(p), { activity: r.status, shown: shown.ok, shownMs }); p.reqs = save;
    // закрыть выдачу
    if (r.json?.id) await api("POST", `/activities/${r.json.id}/stop`, {}, tok).catch(() => {});
  }
  if (pages.includes("editor")) {
    const lg = await teacherCookie(); const p = await fresh("editor"); await setRefresh(p, lg.cookie);
    const t0 = await nav(p, `${ORIGIN}/materials/edit/${MAT_ID}`);
    const ok = await waitFor(() => p.eval(`!!document.body.innerText.includes('Витрина конструкций')`), T_MAX); const vis = Date.now() - t0;
    await quiet(p, 4000, T_MAX); dump(p, "editor", `/materials/edit/<id>`, await metrics(p), { editorVisible: ok.ok, editorMs: vis, wall: Date.now() - t0 });
  }
} catch (e) { console.error("ERR", e); }
fs.writeFileSync(`${OUT}/${PROFILE}${CPU !== "1" ? "-cpu" + CPU : ""}-summary.json`, JSON.stringify(results, null, 1));
for (const id of [teacherRoom, studentPage]) if (id) await B.call("Target.disposeBrowserContext", { browserContextId: id.browserContextId }).catch(() => {});
process.exit(0);
