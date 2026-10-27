// 2026-10-27: лендинг (новый дизайн) — вес, скорость и нагрузка на устройство при слабом интернете и процессоре.
import fs from "node:fs";
import { openBrowsers, P, finish, sleep, mark, shot } from "./lib.mjs";
const BASE = process.env.SITE || "http://172.31.0.1:3100";
await openBrowsers(["teacher"]);
const T = P.teacher;
const PROFILES = {
  "slow3g_cpu6": { net: { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 }, cpu: 6 },
  "fast3g_cpu4": { net: { offline: false, latency: 150, downloadThroughput: (1600 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }, cpu: 4 },
  "fast_cpu1": { net: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, cpu: 1 },
};
const OBS = `(() => { const m = (window.__m = { lcp: 0, cls: 0, tbt: 0, fcp: 0, long: 0 });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") m.fcp = Math.round(e.startTime); }).observe({ type: "paint", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) m.lcp = Math.round(e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) m.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { m.long++; m.tbt += Math.max(0, e.duration - 50); } }).observe({ type: "longtask", buffered: true }); } catch {}
})()`;
await T.send("Page.enable");
await T.send("Network.enable");
await T.send("Performance.disable").catch(() => {});
await T.send("Performance.enable", { timeDomain: "timeTicks" }).catch(() => {});
await T.send("Page.addScriptToEvaluateOnNewDocument", { source: OBS });
const metric = async (name) => ((await T.send("Performance.getMetrics")).metrics.find((x) => x.name === name) || {}).value || 0;
const out = [];
async function load(pageName, path, prof, extra = {}) {
  await T.send("Network.setCacheDisabled", { cacheDisabled: true });
  await T.send("Network.emulateNetworkConditions", PROFILES[prof].net);
  await T.send("Emulation.setCPUThrottlingRate", { rate: PROFILES[prof].cpu });
  await T.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await T.goto("about:blank");
  const t0 = Date.now();
  await T.goto(BASE + path);
  // ждём конца загрузки (но не дольше 90 с)
  for (let i = 0; i < 180; i++) { if (await T.eval(`document.readyState === "complete"`).catch(() => false)) break; await sleep(500); }
  const loadMs = Date.now() - t0;
  await sleep(3000);
  const r = await T.eval(`(() => { const e = performance.getEntriesByType("resource"); const nav = performance.getEntriesByType("navigation")[0];
    return { m: window.__m, req: e.length + 1, bytes: Math.round(e.reduce((s, x) => s + (x.transferSize || 0), nav?.transferSize || 0)),
      files: e.map((x) => [x.name.replace(location.origin, ""), x.transferSize, Math.round(x.startTime), Math.round(x.responseEnd)]),
      dcl: Math.round(nav?.domContentLoadedEventEnd || 0), rootEmptyAtDcl: null, docH: document.documentElement.scrollHeight,
      webgl: !!document.querySelector("canvas") } })()`);
  const row = { page: pageName, prof, loadMs, fcp: r.m.fcp, lcp: r.m.lcp, cls: +r.m.cls.toFixed(3), tbt: Math.round(r.m.tbt), long: r.m.long, dcl: r.dcl, req: r.req, kb: +(r.bytes / 1024).toFixed(1), canvas: r.webgl, ...extra };
  out.push({ ...row, files: r.files });
  console.log(JSON.stringify(row));
  return r;
}
for (const prof of Object.keys(PROFILES)) for (const [n, p] of [["home", "/"], ["pricing", "/pricing"], ["contacts", "/contacts"]]) await load(n, p, prof);

// Нагрузка на устройство: простой после загрузки (3D-знак «перетекает» раз в ~9 с), с прокруткой, свёрнутая вкладка, reduced-motion.
async function idleCpu(label, seconds, setup) {
  await T.send("Network.emulateNetworkConditions", PROFILES.fast_cpu1.net);
  await T.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await T.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await T.goto("about:blank");
  if (setup?.before) await setup.before();
  await T.goto(BASE + "/");
  for (let i = 0; i < 60; i++) { if (await T.eval(`document.readyState === "complete"`).catch(() => false)) break; await sleep(300); }
  await sleep(2500);
  const t0 = Date.now(), task0 = await metric("TaskDuration"), scr0 = await metric("ScriptDuration");
  if (setup?.during) await setup.during(seconds);
  else await sleep(seconds * 1000);
  const dt = (Date.now() - t0) / 1000;
  const cpu = ((await metric("TaskDuration")) - task0) / dt * 100, scr = ((await metric("ScriptDuration")) - scr0) / dt * 100;
  const row = { idle: label, seconds: Math.round(dt), cpuPctOfCore: +cpu.toFixed(2), scriptPct: +scr.toFixed(2), heapMB: +((await metric("JSHeapUsedSize")) / 1048576).toFixed(1), nodes: await metric("Nodes") };
  out.push(row); console.log(JSON.stringify(row));
}
await idleCpu("home, стоим на первом экране", 30);
await idleCpu("home, прокрутка вниз-вверх", 30, { during: async (s) => { const end = Date.now() + s * 1000; while (Date.now() < end) { await T.eval(`window.scrollBy(0, 400)`); await sleep(400); if (await T.eval(`window.innerHeight + scrollY >= document.documentElement.scrollHeight - 5`)) await T.eval(`window.scrollTo(0, 0)`); } } });
await idleCpu("home, prefers-reduced-motion", 20, { before: async () => T.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }) });
await T.send("Emulation.setEmulatedMedia", { features: [] });
await idleCpu("home, вкладка скрыта", 20, { during: async (s) => { await T.send("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {}); await T.send("Page.setWebLifecycleState", { state: "frozen" }).catch(() => {}); await sleep(s * 1000); await T.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); } });
fs.writeFileSync(`${process.env.OUT || "/out"}/perf.json`, JSON.stringify(out, null, 1));
await T.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await finish();
