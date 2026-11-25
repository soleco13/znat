// Новые страницы сайта (/doska, статья) и главная: скриншоты целиком, ошибки, замер отступов (Better Design).
import fs from "node:fs";
import { connectBrowser, openPage, sleep } from "./cdp.mjs";
const OUT = process.env.OUT; fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://127.0.0.1:8791";
const CAPTURE = process.env.CAPTURE ? fs.readFileSync(process.env.CAPTURE, "utf8") : null;
const errs = [];
const b = await connectBrowser(process.env.CDP);
const { browserContextId } = await b.call("Target.createBrowserContext");
const p = await openPage(b, "seo", (e) => { if (["console.error", "console.warn", "exception", "http4xx", "http5xx", "net.fail"].includes(e.kind)) errs.push(e); }, browserContextId);
const pages = (process.env.PAGES ?? "/doska,/blog/kak-provodit-onlajn-uroki,/").split(",");
const ids = [];
for (const u of pages) {
  for (const w of [1440, 1728, 390]) {
    const mobile = w < 500;
    await p.send("Emulation.setDeviceMetricsOverride", { width: w, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
    await p.goto(`${BASE}${u}`);
    await sleep(1500);
    // Прокрутка вниз — чтобы сработали появления (Reveal) по IntersectionObserver.
    const h = await p.eval(`document.documentElement.scrollHeight`);
    for (let y = 0; y < h; y += 500) { await p.eval(`window.scrollTo(0, ${y})`); await sleep(120); }
    await p.eval(`window.scrollTo(0, 0)`); await sleep(600);
    const name = `${u.replace(/\W+/g, "_") || "home"}-${w}`;
    if (w !== 1728) {
      const full = await p.eval(`document.documentElement.scrollHeight`);
      const { data } = await p.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: full, scale: 1 } }, 60000);
      fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
    }
    if (CAPTURE && u !== "/") {
      const r = await p.eval(CAPTURE);
      ids.push({ page: u, w, id: r && r.captureId ? r.captureId : `NO-UPLOAD(${JSON.stringify(r).length}b)` });
    }
    const info = await p.eval(`({ title: document.title, h1: [...document.querySelectorAll('h1')].map(h=>h.innerText).join(' | '), h2: document.querySelectorAll('h2').length, overflowX: document.documentElement.scrollWidth > innerWidth })`);
    console.log(name, JSON.stringify(info));
  }
}
console.log("captures", JSON.stringify(ids));
console.log("errors", JSON.stringify(errs.map((e) => `${e.kind} ${(e.url || e.text || "").slice(0, 300)}`)));
process.exit(0);
