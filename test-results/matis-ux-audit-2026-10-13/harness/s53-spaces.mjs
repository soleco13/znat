// 2026-10-25 Э15.1: переключатель пространств у учителя (личный кабинет + «Школа Б» учитель и методист).
import { openBrowsers, P, login, finish, sleep, shot, check } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
await login(T, "teacher@school.dev");
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await T.goto("http://172.31.0.1:3100/lessons");
await sleep(2500);
await T.eval(`document.querySelector('button[aria-label="Аккаунт"]')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))`);
await sleep(800);
await shot(T, "spaces-menu");
check("menu lists both spaces", /Школа Б/.test(await T.eval("document.body.innerText")));
await T.eval(`[...document.querySelectorAll('[role="menuitem"]')].find(e => /Школа Б/.test(e.textContent))?.click()`);
await sleep(3500);
const nav = await T.eval(`[...document.querySelectorAll("aside a")].map(a => a.textContent.trim()).join(" | ")`);
check("switched: editor visible for teacher+methodist", /Редактор/.test(nav), { nav });
await shot(T, "spaces-school-b");
await finish();
