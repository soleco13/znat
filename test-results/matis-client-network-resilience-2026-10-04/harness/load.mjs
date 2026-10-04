// Загрузка клиента с холодным кэшем на разных скоростях (браузер ученика, его netns).
// Каждый профиль — новый изолированный browser context (без кэша/кук).
import fs from "node:fs";
import { connectBrowser, openPage, sleep, byText, byLabel } from "./cdp.mjs";
import * as L from "./lib.mjs";

const PERF = `(() => { window.__perf = { fcp: null, lcp: null, lcpSize: 0, longTasks: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__perf.lcp = e.startTime; window.__perf.lcpSize = e.size; } }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { window.__perf.longTasks += l.getEntries().length; }).observe({ type: 'longtask', buffered: true }); } catch {}
})();`;
const RES = `(() => { const nav = performance.getEntriesByType('navigation')[0]; const r = performance.getEntriesByType('resource').map(e => ({ n: e.name.replace(location.origin, '').slice(0, 90), t: e.initiatorType, start: Math.round(e.startTime), end: Math.round(e.responseEnd), kb: Math.round((e.transferSize || 0) / 102.4) / 10, decKb: Math.round((e.decodedBodySize || 0) / 1024) }));
  return { nav: nav ? { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), kb: Math.round(nav.transferSize / 102.4) / 10 } : null, res: r, perf: window.__perf, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller) }; })()`;

const profiles = (process.env.PROFILES || "NORMAL,BAD_4G,3G,BAD_3G,EXTREME,HORRIBLE").split(",");
const sb = await connectBrowser(process.env.S_CDP);
for (const ti of (await sb.call("Target.getTargets")).targetInfos) if (ti.type === "page") await sb.call("Target.closeTarget", { targetId: ti.targetId }).catch(() => {});
const out = {};
for (const prof of profiles) {
  await L.setProfile("student", prof);
  const { browserContextId } = await sb.call("Target.createBrowserContext", { disposeOnDetach: true });
  const fails = [];
  const p = await openPage(sb, `load-${prof}`, (e) => { if (e.kind === "net.fail" || e.kind === "http5xx" || e.kind === "http4xx" || e.kind === "exception") fails.push({ k: e.kind, u: (e.url || "").replace(L.ORIGIN, "").slice(0, 80), s: e.status, txt: e.text }); L.log({ ...e, quiet: true }); }, browserContextId);
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: PERF });
  // DEBUG: все запросы (старт/конец) и скриншот раз в 5 с — разбор застреваний
  const reqLog = new Map();
  if (process.env.DEBUG) {
    const orig = sb.listeners.get(p.sessionId);
    sb.listeners.set(p.sessionId, (m, x) => {
      if (m === "Network.requestWillBeSent") reqLog.set(x.requestId, { u: x.request.url.replace(L.ORIGIN, "").slice(0, 90), m: x.request.method, t0: Date.now(), prio: x.request.initialPriority, type: x.type });
      if (m === "Network.loadingFinished" || m === "Network.loadingFailed") { const r = reqLog.get(x.requestId); if (r) { r.t1 = Date.now(); r.fail = x.errorText; r.bytes = x.encodedDataLength; } }
      orig(m, x);
    });
  }
  let shotN = 0;
  const shooter = process.env.DEBUG ? setInterval(() => { p.shot(`${L.OUT}/shots/load-${prof}-${String(shotN++).padStart(3, "0")}.png`).catch(() => {}); }, 5000) : null;
  const t0 = Date.now();
  await p.goto(`${L.ORIGIN}${L.JOIN}`);
  const TO = 240000;
  const form = await L.waitFor(() => p.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]') && !document.querySelector('input[placeholder="Имя и фамилия"]').disabled`), TO, 200);
  const formMs = form.ok ? Date.now() - t0 : null;
  let devMs = null, roomMs = null, audioMs = null;
  if (form.ok) {
    await p.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await p.type(`E2E Загрузка ${prof}`);
    await p.click(`document.querySelector('[role=checkbox]')`); await sleep(200);
    await p.click("document.querySelector('button[type=submit]')");
    const dev = await L.waitFor(() => p.eval(`!!${byText("button", "Присоединиться")}`), TO, 300);
    devMs = dev.ok ? Date.now() - t0 : null;
    if (dev.ok) {
      await sleep(800);
      await p.click(byText("button", "Присоединиться"));
      const room = await L.waitFor(() => p.eval(`!!${byLabel("Чат")}`), TO, 300);
      roomMs = room.ok ? Date.now() - t0 : null;
      // «урок пригоден»: звук учителя реально приходит (учителя в уроке может не быть — тогда только room)
      const au = await L.waitFor(async () => { const s = await p.eval("window.__collect ? window.__collect() : []"); return s.some((x) => (x.inbound || []).some((i) => i.kind === "audio" && i.bytesReceived > 2000)); }, 90000, 1000);
      audioMs = au.ok ? Date.now() - t0 : null;
    }
  }
  if (shooter) clearInterval(shooter);
  if (process.env.DEBUG) fs.writeFileSync(`${L.OUT}/requests-${prof}.json`, JSON.stringify([...reqLog.values()].map((r) => ({ ...r, startS: Math.round((r.t0 - t0) / 100) / 10, endS: r.t1 ? Math.round((r.t1 - t0) / 100) / 10 : null })), null, 1));
  await sleep(1500);
  const res = await p.eval(RES, 20000).catch((e) => ({ err: String(e) }));
  const byType = {}; let total = 0;
  for (const r of res.res || []) { byType[r.t] = byType[r.t] || { n: 0, kb: 0 }; byType[r.t].n++; byType[r.t].kb = Math.round((byType[r.t].kb + r.kb) * 10) / 10; total += r.kb; }
  const beforeForm = (res.res || []).filter((r) => formMs && r.end <= formMs);
  const heavy = [...(res.res || [])].sort((a, b) => b.kb - a.kb).slice(0, 12);
  out[prof] = { formMs, devCheckMs: devMs, inRoomMs: roomMs, audioMs, fcp: res.perf?.fcp && Math.round(res.perf.fcp), lcp: res.perf?.lcp && Math.round(res.perf.lcp), longTasks: res.perf?.longTasks, nav: res.nav, requests: (res.res || []).length + 1, totalKb: Math.round(total + (res.nav?.kb || 0)), byType,
    beforeForm: { n: beforeForm.length, kb: Math.round(beforeForm.reduce((a, r) => a + r.kb, 0)) }, heavy, fails, sw: res.sw };
  L.log({ kind: "LOAD", text: prof, extra: { formMs, devMs, roomMs, audioMs, fcp: out[prof].fcp, lcp: out[prof].lcp, req: out[prof].requests, kb: out[prof].totalKb, fails: fails.length } });
  fs.writeFileSync(`${L.OUT}/load.json`, JSON.stringify(out, null, 2));
  await p.send("Page.navigate", { url: "about:blank" }).catch(() => {});
  await sb.call("Target.closeTarget", { targetId: p.targetId }).catch(() => {});
  await sb.call("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
}
await L.ctl({ cmd: "clear", who: "student" });
process.exit(0);
