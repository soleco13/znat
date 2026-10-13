// Регрессия исправлений аудита: F-01 (микрофон после F5), F-02 (текущее задание для вошедших позже).
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, finish, sleep, shot, mark, LID, ctlState, MIC, press, inRoom, text, ORIGIN, JOIN, byText, log } from "./lib.mjs";
const MAT = "78fb5acf-eb79-428c-8830-878400353fe0";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S = P.s1, L = P.s2;
await teacherJoin(T); await resetLesson(T);
const reload = async (p) => { const b = await p.eval("performance.timeOrigin"); await p.reload(); await waitFor(async () => (await p.eval("performance.timeOrigin")) !== b, 15000); return waitFor(() => inRoom(p), 30000); };
const startAct = () => T.eval(`(async () => { const r = await fetch("/api/v1/auth/refresh", {method:"POST",credentials:"include"}).then(r=>r.json()); const res = await fetch("/api/v1/lessons/${LID}/activities", {method:"POST", headers:{"content-type":"application/json", authorization:"Bearer "+r.accessToken}, body: JSON.stringify({materialId:"${MAT}"})}); return (await res.json()).id; })()`);
const inActivity = (p) => p.eval(`document.body.innerText.includes('Все типы заданий на одном уроке')`);

mark("F-01: выключил микрофон через 2 с после входа, F5 через 1 с");
check("s1 joins", await guestEnter(S, "Ученик Регресс"));
await sleep(2000);
await press(S, MIC.on); await sleep(1000);
await reload(S); await sleep(5000);
check("F-01: mic stays off after F5", (await ctlState(S, MIC)) === false, await ctlState(S, MIC));
await press(S, MIC.off); await sleep(1000);
await reload(S); await sleep(5000);
check("F-01: mic stays on after re-enabling + F5", (await ctlState(S, MIC)) === true, await ctlState(S, MIC));

mark("F-02a: задание выдано, ученик входит через 8 с");
await startAct();
await sleep(8000);
check("late joins", await guestEnter(L, "Ученик Опоздал"));
check("F-02a: late joiner sees current activity", (await waitFor(() => inActivity(L), 10000)).ok, (await text(L)).slice(0, 120));
await shot(L, "late-sees");

mark("F-02b: ученик закрыл задание, переподключение канала не выдёргивает обратно");
await L.click(`document.querySelector('button[aria-label="Свернуть задание"]')`);
await sleep(1500);
const closed = !(await inActivity(L));
check("student closed activity", closed);
await L.eval(`(() => { for (const ws of (window.__ws || [])) ws.close(); })()`);
await L.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await sleep(3000);
await L.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await sleep(8000);
check("F-02b: not yanked back into activity after reconnect", !(await inActivity(L)));

mark("F-02c: учитель закрыл задание — новый ученик его не получает");
// учитель открывает и закрывает задание у себя
const tClose = await waitFor(() => T.eval(`!!${byText("button", "Свернуть")}`), 10000);
check("teacher has 'Свернуть' on activity", tClose.ok);
await T.click(byText("button", "Свернуть"));
await sleep(2000);
await L.goto("about:blank");
const ctx = await L.browser.call("Target.createBrowserContext");
const { openPage } = await import("./cdp.mjs");
const { log: lg } = await import("./lib.mjs");
const N = await openPage(L.browser, "newbie", lg, ctx.browserContextId);
check("newbie joins", await guestEnter(N, "Новенький"));
await sleep(4000);
check("F-02c: closed activity is not pushed to newcomer", !(await inActivity(N)));
await finish();
