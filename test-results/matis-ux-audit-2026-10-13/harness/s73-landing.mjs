// Лендинг прода: вид на ПК и телефоне, куда ведут кнопки, ошибки страницы (только чтение).
import fs from "node:fs";
import { connectBrowser, openPage, sleep } from "./cdp.mjs";
const OUT = process.env.OUT; fs.mkdirSync(OUT, { recursive: true });
const errs = [];
const b = await connectBrowser(process.env.CDP);
const { browserContextId } = await b.call("Target.createBrowserContext");
const p = await openPage(b, "land", (e) => { if (["console.error", "exception", "http4xx", "http5xx", "net.fail"].includes(e.kind)) errs.push(e); }, browserContextId);
for (const [u, n] of [["/", "home"], ["/pricing", "pricing"], ["/contacts", "contacts"]]) {
  for (const mobile of [false, true]) {
    await p.send("Emulation.setDeviceMetricsOverride", mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const t = Date.now();
    await p.goto(`https://matis-edu.ru${u}`);
    await sleep(4000);
    const info = await p.eval(`({ title: document.title, h1: [...document.querySelectorAll('h1')].map(h=>h.innerText).join(' | '),
      ctas: [...document.querySelectorAll('a')].filter(a=>a.getBoundingClientRect().width>0).map(a=>a.innerText.trim().replace(/\\s+/g,' ').slice(0,40)+' -> '+a.getAttribute('href')).filter((x,i,arr)=>arr.indexOf(x)===i).slice(0,40),
      height: document.documentElement.scrollHeight, meta: document.querySelector('meta[name=description]')?.content })`);
    await p.shot(`${OUT}/${n}${mobile ? "-m" : ""}.png`);
    console.log(n, mobile ? "mobile" : "desktop", Date.now() - t, "ms", JSON.stringify(info).slice(0, 2500));
  }
}
console.log("errors", JSON.stringify(errs.map((e) => `${e.kind} ${e.status || ""} ${(e.url || e.text || "").slice(0, 120)}`)));
process.exit(0);
