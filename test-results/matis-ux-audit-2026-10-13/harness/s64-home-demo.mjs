import fs from "node:fs";
import { openBrowsers, P, finish, sleep, mark } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher; await T.send("Page.enable");
fs.mkdirSync(`${process.env.OUT}/shots`, { recursive: true });
for (const run of [1, 2, 3]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await T.goto("about:blank"); await T.goto(process.env.SITE + "/"); await sleep(1800);
  const h = await T.eval("document.documentElement.scrollHeight");
  for (let y = 0; y < h; y += 500) { await T.eval(`window.scrollTo(0, ${y})`); await sleep(120); }
  await T.eval("window.scrollTo(0, 700)"); await sleep(2500);
  mark(`run ${run}`, await T.eval(`(() => { const w = document.querySelector(".lesson-ui"); return w ? { svg: w.querySelectorAll("svg").length, text: w.innerText.length, tiles: w.querySelectorAll("[class*=tile]").length, canvas: document.querySelectorAll("canvas").length } : null; })()`));
  const s = await T.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${process.env.OUT}/shots/demo-${run}.png`, Buffer.from(s.data, "base64"));
}
await finish();
