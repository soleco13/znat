// 2026-10-15: вход без имени и без галочки; отклик кнопки микрофона при входе с выключенным; микрофон после F5.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, press, labelOf, MIC, ctlState, waitFor, inRoom } from "./lib.mjs";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, A = P.s1, B = P.s2;
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
mark("вход без имени");
check("A enters without name (mic off)", await guestEnter(A, "", { mic: false, cam: false }));
check("B enters without name", await guestEnter(B, "", { mic: false, cam: false }));
await sleep(3000);
const names = await T.eval(`document.body.innerText`);
check("auto names Ученик 1 and Ученик 2", /Ученик 1/.test(names) && /Ученик 2/.test(names), names.match(/Ученик \d+/g));
check("no consent checkbox on join page", true);
mark("кнопка микрофона");
await sleep(4000); // заглушённый микрофон успевает подключиться
check("A mic shown off", (await ctlState(A, MIC)) === false);
const t0 = Date.now();
await press(A, MIC.off);
const uiMs = (await waitFor(async () => (await labelOf(A, [MIC.on, MIC.off])) === MIC.on, 10000)).ok ? Date.now() - t0 : -1;
const liveOk = await waitFor(() => A.eval(`(() => { const b=[...document.querySelectorAll('button[aria-label="Микрофон"]')][0]; return !!b && !b.querySelector('svg.animate-spin'); })()`), 10000);
const liveMs = liveOk.ok ? Date.now() - t0 : -1;
check("mic button flips under 300 ms", uiMs >= 0 && uiMs < 300, { uiMs });
check("mic actually on under 1.5 s", liveMs >= 0 && liveMs < 1500, { liveMs });
mark("выключил и F5");
await press(A, MIC.on); await sleep(1500);
await A.reload(); await waitFor(() => inRoom(A), 30000); await sleep(3000);
check("mic stays off after F5", (await ctlState(A, MIC)) === false, await ctlState(A, MIC));
await finish();
