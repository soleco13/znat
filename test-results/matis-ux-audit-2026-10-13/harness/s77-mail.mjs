// Письмо «тариф подключён»: тестовая оплата на стенде, письмо из SMTP-приёмника стенда — снимок на ПК и телефоне.
import fs from "node:fs";
import { connectBrowser, openPage, sleep } from "./cdp.mjs";
const ORIGIN = "http://172.31.0.1:3100";
const OUT = process.env.OUT; fs.mkdirSync(OUT, { recursive: true });
const b = await connectBrowser(process.env.CDP);
const { browserContextId } = await b.call("Target.createBrowserContext");
const p = await openPage(b, "m", () => {}, browserContextId);
if (process.env.PAY === "1") {
  await p.goto(`${ORIGIN}/login`); await sleep(2500);
  await p.click("document.querySelector('input[type=email]')"); await p.type(process.env.EMAIL);
  await p.click("document.querySelector('input[type=password]')"); await p.type(process.env.PW);
  await p.click("document.querySelector('button[type=submit]')"); await sleep(3500);
  await p.goto(`${ORIGIN}/billing`); await sleep(3000);
  await p.click(`[...document.querySelectorAll('button')].find(b => /Продлить|Оплатить/.test(b.textContent||''))`); await sleep(2500);
  await p.click(`[...document.querySelectorAll('button')].find(b => /\\(тест\\)/.test(b.textContent||''))`); await sleep(5000);
  console.log("paid", await p.eval("location.pathname + location.search"));
  process.exit(0);
}
const html = fs.readFileSync(process.env.HTML, "utf8");
for (const [w, mobile] of [[900, false], [390, true]]) {
  await p.send("Emulation.setDeviceMetricsOverride", { width: w, height: 1100, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await p.goto("data:text/html;charset=utf-8;base64," + Buffer.from(html).toString("base64")); await sleep(1500);
  await p.shot(`${OUT}/payment-email${mobile ? "-m" : ""}.png`);
}
process.exit(0);
