// 2026-10-25: тестовая оплата — «Оплатить» → тестовая форма → тариф включён.
import { openBrowsers, P, login, finish, sleep, shot, check } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
await login(T, "admin@school.dev");
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await T.goto("http://172.31.0.1:3100/billing");
await sleep(2500);
await shot(T, "tp-billing");
await T.eval(`[...document.querySelectorAll("button")].find(b => /^Оплатить 990/.test(b.textContent.trim()))?.click()`);
await sleep(3000);
check("on test form", (await T.eval("location.pathname")) === "/billing/test-pay", { url: await T.eval("location.href") });
await shot(T, "tp-form");
await T.eval(`[...document.querySelectorAll("button")].find(b => /\\(тест\\)/.test(b.textContent))?.click()`);
await sleep(3000);
check("back on billing, confirmed", /Оплата прошла/.test(await T.eval("document.body.innerText")), { url: await T.eval("location.href") });
await shot(T, "tp-done");
await finish();
