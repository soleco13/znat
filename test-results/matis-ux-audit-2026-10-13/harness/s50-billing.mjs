// 2026-10-25: страница «Тариф» — путь покупки (тариф, цена, «Оплатить») на 1440 и 390.
import { openBrowsers, P, login, finish, sleep, shot, check } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
await login(T, process.env.EMAIL || "admin@school.dev");
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await T.goto("http://172.31.0.1:3100/billing" + (process.env.Q || ""));
  await sleep(2500);
  if (process.env.MODE) { await T.eval(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Автопродление")?.click()`); await sleep(500); }
  await shot(T, `billing-${process.env.TAG || "on"}-${w}`);
}
if (process.env.CLICK) {
  await T.eval(`[...document.querySelectorAll("button")].find(b => /Оплатить/.test(b.textContent))?.click()`);
  await sleep(2000);
  check("after click", true, { url: await T.eval("location.href"), text: await T.eval("document.body.innerText.slice(0,400)") });
  await shot(T, `billing-${process.env.TAG}-click`);
}
await finish();
