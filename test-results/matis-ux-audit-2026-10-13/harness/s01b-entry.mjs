// Перепроверка: F5 после выключения микрофона (сразу / через 20 с), возврат при закрытом входе, удаление ученика.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, inRoom, ctlState, MIC, press, text, ORIGIN, JOIN, LID, teacherApi, mark } from "./lib.mjs";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S = P.s1, S2 = P.s2;
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Один"));
check("s2 joins", await guestEnter(S2, "Ученик Два"));
const reload = async (p) => { const before = await p.eval("performance.timeOrigin"); await p.reload(); await waitFor(async () => (await p.eval("performance.timeOrigin")) !== before, 15000); return waitFor(() => inRoom(p), 30000); };

mark("A. выключил микрофон через 20 с после входа, F5 через 7 с");
await sleep(16000);
await press(S, MIC.on); await sleep(7000);
await reload(S); await sleep(5000);
check("A: mic stays off after F5 (muted 20 s after join, waited 7 s)", (await ctlState(S, MIC)) === false, await ctlState(S, MIC));

mark("B. выключил и сразу F5 (1 с)");
if ((await ctlState(S, MIC)) === false) { await press(S, MIC.off); await sleep(3000); }
await sleep(16000);
await press(S, MIC.on); await sleep(1000);
await reload(S); await sleep(5000);
check("B: mic stays off after immediate F5", (await ctlState(S, MIC)) === false, await ctlState(S, MIC));

mark("C. закрытый вход: уже бывший ученик возвращается после F5");
await teacherApi(T, "PATCH", `/lessons/${LID}/entry`, { locked: true });
const r = await reload(S);
check("C: existing student back in room while entry locked", r.ok, await ui(S));
await teacherApi(T, "PATCH", `/lessons/${LID}/entry`, { locked: false });

mark("D. удаление ученика");
const sid = await S2.eval(`(async () => (await fetch("/api/v1/guest/session", {credentials:"include"}).then(r=>r.json())).guestId)()`);
await teacherApi(T, "POST", `/lessons/${LID}/participants/${sid}/remove`);
const rm = await waitFor(async () => /удалил/i.test(await text(S2)), 10000);
check("D: removed student sees removal screen", rm.ok, (await text(S2)).slice(0, 200));
await shot(S2, "removed");
await S2.goto(`${ORIGIN}${JOIN}`); await sleep(5000);
check("D: after removal, link shows name form (new person), not silent return", !(await inRoom(S2)), (await text(S2)).slice(0, 120));
await finish();
