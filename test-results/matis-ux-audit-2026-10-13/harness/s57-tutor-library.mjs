// 2026-10-25 Э15.5: библиотека репетитора с оплаченным тарифом — вкладка «Матис», просмотр без копии.
import { openBrowsers, P, login, finish, sleep, shot, mark } from "./lib.mjs";
await openBrowsers(["s2"]);
const T = P.s2;
await login(T, "tutor@stage.dev");
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await T.goto("http://172.31.0.1:3100/materials");
  await sleep(3000);
  await shot(T, `tutor-library-${w}`);
}
await T.goto(`http://172.31.0.1:3100/materials/edit/${process.env.MID}`);
await sleep(3000);
mark("tutor editor", await T.eval(`({ copy: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("В библиотеку школы")), notice: document.body.innerText.includes("выдайте его на уроке как есть") })`));
await shot(T, "tutor-editor-390");
await finish();
