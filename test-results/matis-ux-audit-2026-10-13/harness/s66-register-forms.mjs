import fs from "node:fs";
import { openBrowsers, P, finish, sleep, mark } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher; await T.send("Page.enable");
fs.mkdirSync(`${process.env.OUT}/shots`, { recursive: true });
await T.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
for (const path of ["/register/individual", "/register/organization", "/terms", "/privacy", "/consent", "/billing?plan=mini&period=month", "/register/check-email"]) {
  await T.goto("about:blank"); await T.goto("https://matis-edu.ru" + path); await sleep(3000);
  const r = await T.eval(`({ url: location.pathname + location.search, text: document.body.innerText.replace(/\\n+/g, " | ").slice(0, 220) })`);
  mark(path, r);
  const s = await T.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${process.env.OUT}/shots/${path.replace(/[^a-z]+/g, "_")}.png`, Buffer.from(s.data, "base64"));
}
await finish();
