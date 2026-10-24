// 2026-10-24: окно связи участника по клику на имя. Учитель открывает окно
// ученицы (у неё «плохой 3G»), потом своё. Проверяем цифры, остановку запросов
// после закрытия и объём данных.
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, shot, profile, clearNet } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
check("s1 joins", await guestEnter(S, "Амелия Тестова", { cam: true, mic: true }));
await profile("s1", "BAD_3G");
await sleep(8000);
// Счётчик сообщений канала данных у ученицы (ответы) — через обёртку publishData нельзя,
// считаем байты data-channel в getStats.
const DC = `(async () => { let sent = 0, msgs = 0; for (const pc of window.__pcs.filter(p => p.connectionState !== 'closed')) { const r = await pc.getStats(); r.forEach(s => { if (s.type === 'data-channel') { sent += s.bytesSent || 0; msgs += s.messagesSent || 0; } }); } return { sent, msgs }; })()`;
const before = await S.eval(DC);
await sleep(4000);
await T.click(`[...document.querySelectorAll('button[aria-label^="Связь участника"]')].find(b => b.innerText.includes('Амелия'))`);
await sleep(5000);
const TEXT = `document.querySelector('[data-radix-popper-content-wrapper]')?.innerText ?? null`;
const txt = await T.eval(TEXT);
mark("popover text (student)", txt);
await shot(T, "popover-student");
const during = await S.eval(DC);
check("popover opened", !!txt);
check("shows score", /\d+ \/ 100/.test(txt ?? ""), txt);
check("shows bitrate both ways", /↑ \d+ кбит\/с/.test(txt ?? "") && /↓ \d+ кбит\/с/.test(txt ?? ""), txt);
check("shows RTT", /\d+ мс/.test(txt ?? ""), txt);
check("shows send quality and codecs", /\d+p/.test(txt ?? "") && /opus|red/.test(txt ?? ""), txt);
mark("student data-channel while open (5 s)", { msgs: during.msgs - before.msgs, bytes: during.sent - before.sent });
await T.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(1500);
const closed1 = await S.eval(DC);
await sleep(5000);
const closed2 = await S.eval(DC);
mark("student data-channel after close (5 s)", { msgs: closed2.msgs - closed1.msgs, bytes: closed2.sent - closed1.sent });
check("no replies after close", closed2.msgs - closed1.msgs <= 1, { msgs: closed2.msgs - closed1.msgs });
await clearNet("s1");
await T.click(`[...document.querySelectorAll('button[aria-label^="Связь участника"]')].find(b => b.innerText.includes('(вы)'))`);
await sleep(3500);
const own = await T.eval(TEXT);
mark("popover text (self)", own);
await shot(T, "popover-self");
check("self popover shows score", /\d+ \/ 100/.test(own ?? ""), own);
await finish();
