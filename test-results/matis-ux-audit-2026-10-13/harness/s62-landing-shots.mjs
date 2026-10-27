// 2026-10-27: лендинг — полные страницы на 360/390/768/1440, горизонтальный скролл, мелкие кликабельные цели, картинки без размеров.
import fs from "node:fs";
import { openBrowsers, P, finish, sleep, mark } from "./lib.mjs";
const BASE = process.env.SITE; const OUT = process.env.OUT || "/out"; const TAG = process.env.TAG || "";
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
await openBrowsers(["teacher"]);
const T = P.teacher;
await T.send("Page.enable");
const AUDIT = `(() => { const vw = innerWidth; const over = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && getComputedStyle(e).position !== "fixed" && !e.closest("[aria-hidden=true], .overflow-x-auto, [class*=overflow-]"); }).slice(0, 5).map((e) => e.tagName + "." + String(e.className).slice(0, 50));
  const small = [...document.querySelectorAll("a,button,[role=tab],[role=radio],input,select,summary")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32) && getComputedStyle(e).visibility !== "hidden"; }).slice(0, 8).map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 28) + " " + Math.round(e.getBoundingClientRect().width) + "×" + Math.round(e.getBoundingClientRect().height));
  const imgs = [...document.querySelectorAll("img")].filter((i) => !i.getAttribute("width") && !i.getAttribute("height")).length;
  const noAlt = [...document.querySelectorAll("img:not([alt])")].length;
  const h1 = document.querySelectorAll("h1").length;
  const tiny = [...document.querySelectorAll("p,li,span,a,button,td,th,label,dd,dt")].filter((e) => e.childElementCount === 0 && e.innerText.trim() && parseFloat(getComputedStyle(e).fontSize) < 12 && e.getBoundingClientRect().width > 0).slice(0, 4).map((e) => e.innerText.trim().slice(0, 24) + " " + getComputedStyle(e).fontSize);
  return { scrollW: document.documentElement.scrollWidth, vw, hscroll: document.documentElement.scrollWidth > vw + 1, over, small, imgs, noAlt, h1, tiny, height: document.documentElement.scrollHeight, title: document.title }; })()`;
for (const w of [360, 390, 768, 1440]) {
  const mobile = w < 768;
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: mobile ? 800 : 900, deviceScaleFactor: 1, mobile });
  for (const [n, p] of [["home", "/"], ["pricing", "/pricing"], ["contacts", "/contacts"]]) {
    await T.goto("about:blank"); await T.goto(BASE + p);
    await sleep(1800);
    // прокрутка, чтобы сработали появления по IntersectionObserver
    const h = await T.eval("document.documentElement.scrollHeight");
    for (let y = 0; y < h; y += 500) { await T.eval(`window.scrollTo(0, ${y})`); await sleep(120); }
    await T.eval("window.scrollTo(0, 0)"); await sleep(600);
    const a = await T.eval(AUDIT);
    mark(`${n} ${w}`, a);
    const full = await T.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(a.height, 9000), scale: 1 } });
    fs.writeFileSync(`${OUT}/shots/${TAG}${n}-${w}.png`, Buffer.from(full.data, "base64"));
  }
}
await finish();
