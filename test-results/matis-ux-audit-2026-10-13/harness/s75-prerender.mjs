// Лендинг с предрендером (локальная сборка): ошибки «оживления» React, вид на ПК и телефоне.
import fs from "node:fs";
import { connectBrowser, openPage, sleep } from "./cdp.mjs";
const OUT = process.env.OUT; fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://127.0.0.1:8791";
const errs = [];
const b = await connectBrowser(process.env.CDP);
const { browserContextId } = await b.call("Target.createBrowserContext");
const p = await openPage(b, "land", (e) => { if (["console.error", "console.warn", "exception", "http4xx", "http5xx", "net.fail"].includes(e.kind)) errs.push(e); }, browserContextId);
for (const [u, n] of [["/", "home"], ["/pricing", "pricing"], ["/contacts", "contacts"]]) {
  for (const mobile of [false, true]) {
    await p.send("Emulation.setDeviceMetricsOverride", mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.goto(`${BASE}${u}`);
    await sleep(3000);
    const info = await p.eval(`({ title: document.title, h1: [...document.querySelectorAll('h1')].map(h=>h.innerText).join(' | '), h2: document.querySelectorAll('h2').length, height: document.documentElement.scrollHeight })`);
    await p.shot(`${OUT}/${n}${mobile ? "-m" : ""}.png`);
    console.log(n, mobile ? "mobile" : "desktop", JSON.stringify(info));
  }
}
console.log("errors", JSON.stringify(errs.map((e) => `${e.kind} ${(e.url || e.text || "").slice(0, 300)}`)));
process.exit(0);
