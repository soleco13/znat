// Регрессия F-03: техническая ошибка сервера показывается человеку по-русски.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, shot, mark, intercept, ui } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Текст"));
await sleep(2000);
mark("смена прав отвечает 500");
await intercept(T, [{ match: /\/permissions$/, status: 500 }]);
await T.click(`[...document.querySelectorAll('button[aria-label^="Действия — Ученик Текст"]')][0]`);
await sleep(800);
await T.click(`[...document.querySelectorAll('[role=menuitem]')].find(e => /рисовать/.test(e.textContent))`);
await sleep(2500);
const t = (await ui(T)).toasts;
check("F-03: error toast is human Russian text", t.length > 0 && t.every((x) => /[а-яё]/i.test(x) && !/Internal|Server Error/.test(x)), t);
await shot(T, "err-text");
await intercept(T, []);
await finish();
