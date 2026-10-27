import fs from "node:fs";
import { openBrowsers, P, finish, sleep, mark } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher; await T.send("Page.enable");
fs.mkdirSync(`${process.env.OUT}/shots`, { recursive: true });
for (const [label, w, mobile] of [["десктоп", 1440, false], ["телефон", 390, true]]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile });
  for (const [name, path] of [["landing-click", "/"], ["register", "/register"], ["login", "/login"]]) {
    await T.goto("about:blank"); await T.goto("https://matis-edu.ru" + path); await sleep(2500);
    if (name === "landing-click") {
      await T.eval(`[...document.querySelectorAll("a")].find((a) => /Начать/.test(a.innerText) && a.getBoundingClientRect().width)?.click()`);
      await sleep(3500);
    }
    const r = await T.eval(`({ url: location.pathname, title: document.title, text: document.body.innerText.slice(0, 160) })`);
    mark(`${label} ${name}`, r);
    const s = await T.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`${process.env.OUT}/shots/${label === "десктоп" ? "d" : "m"}-${name}.png`, Buffer.from(s.data, "base64"));
  }
}
await finish();
