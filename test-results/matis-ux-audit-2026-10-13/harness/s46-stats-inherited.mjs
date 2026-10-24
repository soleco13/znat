// 2026-10-24: у учителя хорошая сеть, у ученицы — плохая отдача (BAD_3G). Своё окно
// учителя: хорошая оценка + пояснение «потери у собеседника»; окно ученицы — низкая.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, shot, profile, clearNet } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик 1", { cam: true, mic: true }));
await profile("s1", "BAD_3G");
await sleep(15000);
const TEXT = `document.querySelector('[data-radix-popper-content-wrapper]')?.innerText ?? ''`;
const score = (t) => Number((t.match(/(\d+) \/ 100/) || [])[1] ?? -1);
await T.click(`[...document.querySelectorAll('button[aria-label^="Связь участника"]')].find(b => b.innerText.includes('(вы)'))`);
await sleep(4000);
const own = await T.eval(TEXT);
mark("teacher own", own);
await shot(T, "own-popover");
check("teacher own score stays good (≥ 70)", score(own) >= 70, own);
await T.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(800);
await T.click(`[...document.querySelectorAll('button[aria-label^="Связь участника"]')].find(b => b.innerText.includes('Ученик 1'))`);
await sleep(4000);
const st = await T.eval(TEXT);
mark("student", st);
await shot(T, "student-popover");
check("student score low (< 70)", score(st) >= 0 && score(st) < 70, st);
await clearNet("s1");
await finish();
