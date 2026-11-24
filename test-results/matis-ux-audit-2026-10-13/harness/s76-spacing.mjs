// Замер отступов раздела «История платежей» (Better Design inspect-spacing): снимок
// геометрии на 1440, 1728 и 390, только поддерево раздела, загрузка по ссылке инструмента.
import fs from "node:fs";
import { connectBrowser, openPage, sleep } from "./cdp.mjs";
const ORIGIN = "http://172.31.0.1:3100";
const CAP = fs.readFileSync(new URL("./bd-capture.js", import.meta.url), "utf8");
const b = await connectBrowser(process.env.CDP);
const { browserContextId } = await b.call("Target.createBrowserContext");
const p = await openPage(b, "sp", () => {}, browserContextId);
await p.goto(`${ORIGIN}/login`); await sleep(2500);
await p.click("document.querySelector('input[type=email]')"); await p.type(process.env.EMAIL);
await p.click("document.querySelector('input[type=password]')"); await p.type(process.env.PW);
await p.click("document.querySelector('button[type=submit]')"); await sleep(3500);
const SEL = process.env.SEL || 'section[aria-labelledby="payments-title"]';
const TITLE = process.env.TITLE_ID || "#payments-title";
const ids = [];
for (const [w, mobile] of [[1440, false], [1728, false], [390, true]]) {
  await p.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile });
  await p.goto(`${ORIGIN}/billing`); await sleep(3500);
  await p.eval(`document.querySelector(${JSON.stringify(SEL)}).scrollIntoView()`); await sleep(500);
  const state = await p.eval(CAP, 30000);
  const titleEl = state.elements.find((e) => e.id === TITLE);
  // Заголовок плашки вложен глубже — поднимаемся до section.
  let root = titleEl?.parentId;
  while (root && !state.elements.find((e) => e.id === root)?.id.startsWith("section")) root = state.elements.find((e) => e.id === root)?.parentId;
  const keep = new Set([root]);
  for (const e of state.elements) if (keep.has(e.parentId)) keep.add(e.id);
  state.elements = state.elements.filter((e) => keep.has(e.id));
  state.scope = SEL;
  state.name = `viewport-${w} ${SEL}`.slice(0, 100);
  const r = await fetch(process.env.UPLOAD, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(state) }).then((x) => x.json()).catch((e) => ({ err: String(e) }));
  console.log(w, state.elements.length, JSON.stringify(r));
  if (r.captureId) ids.push(r.captureId);
}
console.log("IDS", JSON.stringify(ids));
process.exit(0);
