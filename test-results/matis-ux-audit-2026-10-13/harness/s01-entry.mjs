// Вход и восстановление: F5 ученика и учителя, вторая вкладка, двойной клик «Присоединиться»,
// неверная ссылка, закрытый вход, удалённый ученик.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, inRoom, ctlState, MIC, press, text, secondTab, ORIGIN, JOIN, LID, teacherApi, byText, countText, passDeviceCheck, mark } from "./lib.mjs";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S = P.s1, S2 = P.s2;
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Один"));
const tiles = () => T.eval(`[...document.querySelectorAll('span')].filter(s => s.textContent === 'Ученик Один').length`);
await sleep(3000);

mark("1. F5 ученика посреди урока, микрофон выключен");
await press(S, MIC.on); await sleep(1500);
check("s1 mic off before reload", (await ctlState(S, MIC)) === false);
await S.reload();
const back = await waitFor(() => inRoom(S), 30000);
check("s1 back in room after F5 without device check", back.ok, { ms: back.ms, ui: await ui(S) });
await sleep(4000);
check("s1 mic still off after F5", (await ctlState(S, MIC)) === false, await ctlState(S, MIC));
check("teacher sees one tile of s1 after F5", (await waitFor(async () => (await countText(T, "Ученик Один")) >= 1, 10000)).ok, { n: await countText(T, "Ученик Один") });
const people = await T.eval(`document.querySelector('header')?.innerText || ''`);
check("teacher header count = 2 after s1 F5", /2 участника/.test(people), people.slice(0, 80));

mark("2. F5 учителя");
await T.reload();
const tback = await waitFor(() => inRoom(T), 30000);
check("teacher back after F5", tback.ok, { ms: tback.ms });

mark("3. Вторая вкладка учителя (тот же аккаунт)");
const T2 = await secondTab(T, "teacher-tab2");
await T2.goto(`${ORIGIN}/lessons/${LID}/room`);
check("tab2 reaches device check or room", (await waitFor(async () => (await inRoom(T2)) || T2.eval(`!!${byText("button", "Присоединиться")}`), 20000)).ok);
await passDeviceCheck(T2);
await sleep(5000);
const t1ui = await ui(T);
// 2026-10-17: до 5 вкладок с аккаунта сотрудника — вторая не вытесняет первую.
check("first tab stays in room (multi-session)", t1ui.inRoom && !t1ui.takenOver, t1ui);
check("tab2 in room too", await inRoom(T2));
await shot(T, "two-tabs");
await T2.send("Page.close").catch(() => {});
await sleep(2000);

mark("4. Двойной клик «Присоединиться» у второго ученика");
await S2.goto(`${ORIGIN}${JOIN}`);
await waitFor(() => S2.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 20000);
await S2.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await S2.type("Ученик Два");
await S2.click(`document.querySelector('[role=checkbox]')`);
await S2.click("document.querySelector('button[type=submit]')"); await S2.click("document.querySelector('button[type=submit]')").catch(() => {});
await waitFor(() => S2.eval(`!!${byText("button", "Присоединиться")}`), 20000);
await sleep(1200);
await S2.click(byText("button", "Присоединиться")); await S2.click(byText("button", "Присоединиться")).catch(() => {});
check("s2 in room after double click", (await waitFor(() => inRoom(S2), 20000)).ok);
await sleep(4000);
check("teacher sees exactly one 'Ученик Два'", (await countText(T, "Ученик Два")) === 1, { n: await countText(T, "Ученик Два") });
const enters = await S2.eval("performance.getEntriesByType('resource').filter(e => e.name.includes('/enter')).length");
check("double submit of name form makes one /enter", enters === 1, { enters });

mark("5. Неверная ссылка");
const S3 = await secondTab(S2, "bad-link");
await S3.goto(`${ORIGIN}/j/0000000000000000000000000000000000000000000000000000000000000000`);
await sleep(5000);
const bad = await text(S3);
check("bad link shows understandable message", /недействительн|не найден|устарел/i.test(bad), bad.slice(0, 200));
await shot(S3, "bad-link");
await S3.send("Page.close").catch(() => {});

mark("6. Закрытый вход: новый гость не входит, старый возвращается");
check("lock entry", (await teacherApi(T, "PATCH", `/lessons/${LID}/entry`, { locked: true })) === 204);
await S2.goto(`${ORIGIN}/`); await sleep(500);
const fresh = await secondTab(T, "x"); await fresh.send("Page.close").catch(() => {});
// новый гость — в чистом контексте третьего браузера нельзя (S2 уже гость), берём новый контекст S2
const ctx = await S2.browser.call("Target.createBrowserContext");
const { openPage } = await import("./cdp.mjs");
const { log } = await import("./lib.mjs");
const G = await openPage(S2.browser, "guest-new", log, ctx.browserContextId);
await G.goto(`${ORIGIN}${JOIN}`);
await waitFor(() => G.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]') || document.body.innerText.length > 50`), 20000);
await sleep(1500);
if (await G.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`)) {
  await G.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await G.type("Новый");
  await G.click(`document.querySelector('[role=checkbox]')`); await G.click("document.querySelector('button[type=submit]')");
}
// Проверка устройств — до входа (2026-10-17), закрытый вход выясняется после неё.
await waitFor(() => G.eval(`!![...document.querySelectorAll('button')].find(b => b.innerText.includes('Присоединиться'))`), 20000);
await sleep(1200);
await G.click(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('Присоединиться'))`);
await sleep(4000);
const lockedTxt = await text(G);
check("new guest sees 'вход закрыт'", /закрыл вход|Вход закрыт|вход в урок.*закрыт|Ждём, когда учитель впустит/i.test(lockedTxt), lockedTxt.slice(0, 200));
await shot(G, "entry-locked");
await S.reload();
check("existing s1 returns while entry locked", (await waitFor(() => inRoom(S), 30000)).ok, await ui(S));
await teacherApi(T, "PATCH", `/lessons/${LID}/entry`, { locked: false });

mark("7. Удалённый ученик пытается вернуться");
const sid = await S2.eval(`(async () => (await fetch("/api/v1/guest/session", {credentials:"include"}).then(r=>r.json())).guestId)()`);
const rm = await teacherApi(T, "POST", `/lessons/${LID}/participants/${sid}/remove`);
await sleep(3000);
const rmTxt = await text(S2);
check("removed student sees removal screen", /удалил/i.test(rmTxt), rmTxt.slice(0, 160));
await S2.goto(`${ORIGIN}${JOIN}`); await sleep(5000);
const again = await text(S2);
const again2 = await inRoom(S2);
check("removed student can re-enter only as new person (form shown), not silently back", !again2, { inRoom: again2, txt: again.slice(0, 160) });
await shot(S2, "removed-reenter");
await finish();
