// 2026-10-25: раздел «Платформа» супер-админа на 1440 и 390, карточка школы.
import { openBrowsers, P, login, finish, sleep, shot } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
await login(T, "admin@school.dev");
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await T.goto("http://172.31.0.1:3100/platform");
  await sleep(2500);
  await shot(T, `platform-${w}`);
}
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await T.goto("http://172.31.0.1:3100/platform");
await sleep(2000);
await T.eval(`document.querySelector("tbody button")?.click()`);
await sleep(1500);
await shot(T, "platform-school");
await finish();
