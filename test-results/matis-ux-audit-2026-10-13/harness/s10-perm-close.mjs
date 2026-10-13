// Запрет камеры/микрофона на экране проверки; учитель случайно закрывает вкладку — что видят ученики.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, mark, ORIGIN, JOIN, byText, inRoom, text, log, login, LID } from "./lib.mjs";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S = P.s1, D = P.s2;
await teacherJoin(T); await resetLesson(T);

mark("1. ученику запрещены камера и микрофон");
await D.send("Browser.setPermission", { permission: { name: "microphone" }, setting: "denied", origin: ORIGIN, browserContextId: D.ctx }).catch((e) => log({ kind: "info", text: "setPermission: " + e.message }));
await D.send("Browser.setPermission", { permission: { name: "camera" }, setting: "denied", origin: ORIGIN, browserContextId: D.ctx }).catch(() => {});
await D.goto(`${ORIGIN}${JOIN}`);
await waitFor(() => D.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 20000);
await D.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await D.type("Ученик Без Доступа");
await D.click(`document.querySelector('[role=checkbox]')`); await D.click("document.querySelector('button[type=submit]')");
await waitFor(() => D.eval(`!!${byText("button", "Присоединиться")}`), 20000);
await sleep(3000);
const dc = await text(D);
check("denied: device check explains how to allow access", /разреш|доступ/i.test(dc), dc.slice(0, 300));
await shot(D, "denied-devicecheck");
await D.click(byText("button", "Присоединиться"));
check("denied: can still join (listen only)", (await waitFor(() => D.eval(`!!document.querySelector('[aria-label="Выйти"], [aria-label="Выйти из урока"]') || document.body.innerText.includes('Выйти')`), 20000)).ok);
await sleep(3000);
const ru = await ui(D);
log({ kind: "info", text: "denied in room", extra: ru });
await D.click(`document.querySelector('button[aria-label="Включить звук"]')`); await sleep(2000);
const ru2 = await ui(D);
check("denied: pressing mic explains why it does not work", ru2.toasts.length > 0 || /доступ/i.test(await text(D)), ru2.toasts);
await shot(D, "denied-room");

mark("2. ученик в уроке; учитель случайно закрывает вкладку");
check("s1 joins", await guestEnter(S, "Ученик Ждёт"));
await sleep(3000);
await T.send("Page.close").catch(() => {});
const t0 = Date.now(); const seen = [];
while (Date.now() - t0 < 40000) { const tx = await text(S); const tag = /Тимур Учителев/.test(tx) ? "teacher-tile" : "no-teacher-tile"; const rec = /Переподключ/.test(tx) ? "+reconnecting" : ""; if (seen.at(-1)?.s !== tag + rec) seen.push({ s: tag + rec, at: Math.round((Date.now() - t0) / 1000) }); await sleep(2000); }
log({ kind: "info", text: "student view after teacher tab closed", extra: seen });
await shot(S, "teacher-closed");
await finish();
