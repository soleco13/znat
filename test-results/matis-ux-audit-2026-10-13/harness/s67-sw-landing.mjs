import fs from "node:fs";
import { openBrowsers, P, finish, sleep, mark } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher; await T.send("Page.enable");
fs.mkdirSync(`${process.env.OUT}/shots`, { recursive: true });
await T.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const state = async (label) => { const r = await T.eval(`({ url: location.pathname, title: document.title, h1: document.querySelector("h1")?.innerText || null, text: document.body.innerText.replace(/\\n+/g, " | ").slice(0, 140), sw: !!navigator.serviceWorker?.controller })`); mark(label, r); const s = await T.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${process.env.OUT}/shots/${label.replace(/[^a-z0-9]+/gi, "_")}.png`, Buffer.from(s.data, "base64")); return r; };
// 1. как у возвращающегося пользователя: приложение открыто, service worker установлен
await T.goto("https://matis-edu.ru/login"); await sleep(4000);
await T.goto("https://matis-edu.ru/login"); await sleep(3000);
await state("1 login (SW)");
// 2. лендинг после этого
for (const p of ["/", "/pricing", "/contacts"]) { await T.goto("https://matis-edu.ru" + p); await sleep(3000); await state(`2 ${p}`); }
// 3. «Начать бесплатно» со страницы тарифов
await T.goto("https://matis-edu.ru/pricing"); await sleep(2500);
await T.eval(`[...document.querySelectorAll("a")].find((a) => /Начать бесплатно/.test(a.innerText) && a.getBoundingClientRect().width)?.click()`); await sleep(3500);
await state("3 после «Начать бесплатно» с /pricing");
await finish();
