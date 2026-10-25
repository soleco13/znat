// 2026-10-25 Э15.6: «Тариф» — что доступно сейчас; админ школы и репетитор, 1440 и 390.
import { openBrowsers, P, login, finish, sleep, shot, mark } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
for (const [who, email] of [["teacher", "admin@school.dev"], ["s1", "tutor@stage.dev"]]) {
  const T = P[who];
  await login(T, email);
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    await T.goto("http://172.31.0.1:3100/billing");
    await sleep(2500);
    mark(`${email} ${w}`, await T.eval(`[...document.querySelectorAll("dl > div")].map((d) => d.innerText.replace(/\\n/g, ": "))`));
    await shot(T, `billing-${who}-${w}`);
  }
}
await finish();
