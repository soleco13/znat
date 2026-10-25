// 2026-10-25 Э15.4: «Платформа» — фильтр репетиторов, карточка с «Открыть пространство»
// и блокировкой, вход супер-админа в чужое пространство; 1440 и 390.
import { openBrowsers, P, login, finish, sleep, shot, check, mark } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
await login(T, "admin@school.dev");
const click = (t) => T.eval(`(() => { const b = [...document.querySelectorAll("button,a,[role=tab]")].find((e) => e.textContent.trim() === ${JSON.stringify(t)}); b?.click(); return !!b; })()`);
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await T.goto("http://172.31.0.1:3100/platform");
  await sleep(2500);
  check(`tutors filter ${w}`, await click("Репетиторы"));
  await sleep(800);
  await shot(T, `sa-tutors-${w}`);
  await T.eval(`[...document.querySelectorAll("tbody button, li button")].find((b) => /tutor/.test(b.textContent))?.click()`);
  await sleep(1500);
  await shot(T, `sa-sheet-${w}`);
  mark("sheet buttons", await T.eval(`[...document.querySelectorAll("[role=dialog] button")].map((b) => b.textContent.trim())`));
}
check("open space", await click("Открыть пространство"));
await sleep(3000);
mark("after switch", await T.eval(`({ url: location.pathname, text: document.body.innerText.slice(0, 300) })`));
await shot(T, "sa-in-space");
await finish();
