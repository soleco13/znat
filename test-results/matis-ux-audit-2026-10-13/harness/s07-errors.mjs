// Ошибки сервера: что видит человек при 500 / обрыве / долгом ответе на ключевых действиях.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, mark, LID, intercept, sendChat, countText, text, press, SHARE, labelOf, MIC, ORIGIN, JOIN, inRoom, byText, log } from "./lib.mjs";
const MAT = "78fb5acf-eb79-428c-8830-878400353fe0";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);

mark("1. /join отвечает 500 — первый вход ученика");
await intercept(S, [{ match: /\/lessons\/[^/]+\/join$/, method: "POST", status: 500 }]);
await S.goto(`${ORIGIN}${JOIN}`);
await waitFor(() => S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 20000);
await S.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await S.type("Ученик Ошибки");
await S.click(`document.querySelector('[role=checkbox]')`); await S.click("document.querySelector('button[type=submit]')");
await waitFor(() => S.eval(`!!${byText("button", "Присоединиться")}`), 20000); await sleep(1000);
await S.click(byText("button", "Присоединиться"));
await sleep(6000);
const j = await text(S);
check("join 500: understandable message + retry", /Не удалось войти|Повторить/.test(j), j.slice(0, 160));
await shot(S, "join-500");
await intercept(S, []);
const retry = await S.click(byText("button", "Повторить"));
check("join 500: retry button recovers", retry && (await waitFor(() => inRoom(S), 20000)).ok);

mark("2. чат: отправка отвечает 500");
await intercept(S, [{ match: /\/chat$/, method: "POST", status: 500 }]);
const m1 = `err500-${Date.now() % 100000}`;
await sendChat(S, m1);
await sleep(3000);
const u2 = await ui(S); const draft2 = await S.eval(`document.querySelector('[aria-label="Сообщение классу"]')?.value || ''`);
check("chat 500: error shown", u2.toasts.some((t) => /не отправлено|Не удалось/i.test(t)) || /не отправлено/i.test(await text(S)), u2.toasts);
check("chat 500: text returned to input (not lost)", draft2.includes(m1), draft2);
check("chat 500: teacher did not get phantom message", (await countText(T, m1)) === 0);
await intercept(S, []);

mark("3. чат: ответ сервера потерян (обрыв после отправки) — повтор не создаёт дубль");
await intercept(S, [{ match: /\/chat$/, method: "POST", abort: true }]);
const m2 = `lost-${Date.now() % 100000}`;
await sendChat(S, m2);
await sleep(3000);
await intercept(S, []);
await press(S, "Отправить");
await sleep(4000);
check("chat abort+resend: exactly one copy at teacher", (await countText(T, m2)) === 1, { n: await countText(T, m2) });

mark("4. задание: сохранение ответа отвечает 500, сдача 500");
await T.eval(`(async () => { const r = await fetch("/api/v1/auth/refresh", {method:"POST",credentials:"include"}).then(r=>r.json()); await fetch("/api/v1/lessons/${LID}/activities", {method:"POST", headers:{"content-type":"application/json", authorization:"Bearer "+r.accessToken}, body: JSON.stringify({materialId:"${MAT}"})}); })()`);
await waitFor(() => S.eval(`document.body.innerText.includes('Сколько будет 7 × 8')`), 20000);
await intercept(S, [{ match: /\/activities\/[^/]+\/responses$/, status: 500 }, { match: /\/activities\/[^/]+\/submit$/, status: 500 }]);
await S.click(`[...document.querySelectorAll('label,button,[role=radio]')].find(e => e.getBoundingClientRect().width > 0 && e.textContent.trim() === '56')`);
await sleep(6000);
const st = await S.eval(`(document.body.innerText.match(/(сохраняем ответы…|ответы сохранены|ответы не сохранились, повторим)/) || [null])[0]`);
check("responses 500: student told answers not saved", st === "ответы не сохранились, повторим", st);
for (let i = 0; i < 12; i++) { const ok = await S.click(`[...document.querySelectorAll('button[aria-label]')].find(b => b.getBoundingClientRect().width > 0 && /Следующ/.test(b.getAttribute('aria-label')))`); if (!ok) break; await sleep(200); }
await S.click(byText("button", "Сдать работу"));
await sleep(4000);
const sub = await text(S);
check("submit 500: not shown as submitted", !sub.includes("Работа сдана"));
check("submit 500: understandable error near button", /Не удалось|Проверьте|ошибк/i.test(sub), sub.slice(-300));
await shot(S, "submit-500");
await intercept(S, []);
await sleep(11000);
const st2 = await S.eval(`(document.body.innerText.match(/(сохраняем ответы…|ответы сохранены|ответы не сохранились, повторим)/) || [null])[0]`);
check("after server recovers: answers saved by retry", st2 === "ответы сохранены", st2);

mark("5. учитель: смена прав отвечает 500");
await intercept(T, [{ match: /\/permissions$/, status: 500 }]);
await T.click(`[...document.querySelectorAll('button[aria-label^="Действия — Ученик Ошибки"]')][0]`);
await sleep(800);
await T.click(`[...document.querySelectorAll('[role=menuitem]')].find(e => /рисовать/.test(e.textContent))`);
await sleep(2500);
const tu = await ui(T);
check("permissions 500: teacher sees error toast", tu.toasts.length > 0, tu.toasts);
await shot(T, "perm-500");
await intercept(T, []);

mark("6. медленный сервер: демонстрация ждёт claim 10 с");
await intercept(T, [{ match: /screen-share\/claim$/, status: 200, delayMs: 10000 }]);
await press(T, SHARE.off);
await sleep(2000);
const busy = await T.eval(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find(b => /Демонстрац/.test(b.getAttribute('aria-label'))); return b ? { disabled: b.disabled, busy: b.getAttribute('aria-busy'), spin: !!b.querySelector('.animate-spin, [role=status]') } : null; })()`);
check("slow claim: share button shows progress", busy && (busy.spin || busy.busy === "true" || busy.disabled), busy);
await sleep(10000);
await intercept(T, []);
await finish();
