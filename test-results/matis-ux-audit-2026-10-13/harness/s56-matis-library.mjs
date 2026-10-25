// 2026-10-25 Э15.5: библиотека «Матиса» — вкладки у методиста, просмотр с копией,
// кнопка в «Платформе» у супер-админа; 1440 и 390.
import { openBrowsers, P, login, finish, sleep, shot, check, mark } from "./lib.mjs";
const MID = process.env.MID;
await openBrowsers(["teacher", "s1"]);
const M = P.s1;
const click = (p, t) => p.eval(`(() => { const b = [...document.querySelectorAll("button,a,[role=tab]")].find((e) => e.textContent.trim() === ${JSON.stringify(t)}); if (b?.getAttribute("role") === "tab") b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); else b?.click(); return !!b; })()`);
await login(M, "methodist@school.dev");
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await M.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await M.goto("http://172.31.0.1:3100/materials");
  await sleep(2500);
  check(`tab ${w}`, await click(M, "Материалы Матиса"));
  await sleep(1500);
  await shot(M, `lib-matis-${w}`);
  await M.goto(`http://172.31.0.1:3100/materials/edit/${MID}`);
  await sleep(3000);
  mark(`editor ${w}`, await M.eval(`({ copy: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("В библиотеку школы")), editTab: [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim()) })`));
  await shot(M, `editor-matis-${w}`);
}
await M.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
check("copy from editor", await M.eval(`(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("В библиотеку школы")); b?.click(); return !!b; })()`));
await sleep(3000);
mark("after copy", await M.eval(`({ url: location.pathname })`));
await shot(M, "after-copy");
const T = P.teacher;
await login(T, "admin@school.dev");
await T.goto("http://172.31.0.1:3100/platform");
await sleep(2500);
await shot(T, "platform-header");
check("open library", await click(T, "Библиотека Матиса"));
await sleep(4000);
mark("in library", await T.eval(`({ url: location.pathname, text: document.body.innerText.slice(0, 260) })`));
await shot(T, "library-space");
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
mark("library nav", await T.eval(`[...document.querySelectorAll("aside a, nav a")].map((a) => a.textContent.trim()).filter(Boolean)`));
await login(T, "tutor@stage.dev");
await T.goto("http://172.31.0.1:3100/materials");
await sleep(3000);
await shot(T, "tutor-library");
await T.goto(`http://172.31.0.1:3100/materials/edit/${MID}`);
await sleep(3000);
mark("tutor editor", await T.eval(`({ copy: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("В библиотеку школы")), notice: document.body.innerText.includes("выдайте его на уроке как есть") })`));
await finish();
