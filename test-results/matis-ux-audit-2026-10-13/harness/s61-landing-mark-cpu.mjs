// 2026-10-27: 3D-знак на главной — загрузка процессора по секундам (программный WebGL в headless).
import { openBrowsers, P, finish, sleep } from "./lib.mjs";
const BASE = process.env.SITE;
await openBrowsers(["teacher"]);
const T = P.teacher;
await T.send("Page.enable"); await T.send("Performance.disable").catch(() => {}); await T.send("Performance.enable", { timeDomain: "timeTicks" }).catch(() => {});
const metric = async (n) => ((await T.send("Performance.getMetrics")).metrics.find((x) => x.name === n) || {}).value || 0;
for (const [label, w, h, mobile] of [["десктоп 1280×800", 1280, 800, false], ["телефон 390×844 ×2", 390, 844, true]]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await T.goto("about:blank"); await T.goto(BASE + "/");
  await sleep(500);
  const rows = []; let prev = await metric("TaskDuration"); const t0 = Date.now();
  for (let i = 0; i < 40; i++) { await sleep(1000); const c = await metric("TaskDuration"); rows.push(Math.round((c - prev) * 100)); prev = c; }
  const cv = await T.eval(`(() => { const c = document.querySelector("canvas"); return c ? [c.width, c.height, getComputedStyle(c).opacity] : null; })()`);
  console.log(label, "canvas", JSON.stringify(cv), "\nCPU % ядра по секундам:", rows.join(" "));
  const calm = rows.slice(20).filter((x) => x <= 3).length;
  console.log("секунд покоя (≤3 %) из последних 20:", calm, " среднее за последние 20 с:", (rows.slice(20).reduce((a, b) => a + b, 0) / 20).toFixed(1), "%");
}
await finish();
