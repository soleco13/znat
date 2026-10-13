import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, mark, LID, intercept, sendChat, press, SHARE, text, sql, log, openDrawer } from "./lib.mjs";
const MAT = "78fb5acf-eb79-428c-8830-878400353fe0";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Ошибки2"));

mark("A. чат: сервер принял, ответ потерян → повторная отправка");
await intercept(S, [{ match: /\/chat$/, method: "POST", abort: true, stage: "Response" }]);
const m = `lostresp-${Date.now() % 100000}`;
await sendChat(S, m);
await sleep(3000);
const t1 = await ui(S);
log({ kind: "info", text: "after lost response", extra: t1.toasts });
await intercept(S, []);
await press(S, "Отправить");
await sleep(3000);
const rows = await sql(`select count(*) from chat_messages where body = '${m}'`);
check("lost response + resend: one message in DB", rows[0] === "1", rows);
await openDrawer(T, "Чат");
check("teacher sees it once", (await T.eval(`document.body.innerText.split(${JSON.stringify(m)}).length - 1`)) === 1);

mark("B. задание грузится при перехвате (контроль)");
await T.eval(`(async () => { const r = await fetch("/api/v1/auth/refresh", {method:"POST",credentials:"include"}).then(r=>r.json()); await fetch("/api/v1/lessons/${LID}/activities", {method:"POST", headers:{"content-type":"application/json", authorization:"Bearer "+r.accessToken}, body: JSON.stringify({materialId:"${MAT}"})}); })()`);
const shown = await waitFor(() => S.eval(`document.body.innerText.includes('Все типы заданий на одном уроке')`), 25000);
for (let i = 0; i < 4 && !(await S.eval(`document.body.innerText.includes('Сколько будет 7 × 8')`)); i++) { await S.click(`[...document.querySelectorAll('button[aria-label]')].find(b => b.getBoundingClientRect().width > 0 && /Следующ/.test(b.getAttribute('aria-label')))`); await sleep(500); }
check("activity shown (no interception)", shown.ok, (await text(S)).slice(0, 120));
await intercept(S, [{ match: /\/activities\/[^/]+\/responses$/, status: 500 }]);
await S.click(`[...document.querySelectorAll('label,button,[role=radio]')].find(e => e.getBoundingClientRect().width > 0 && e.textContent.trim() === '56')`);
await sleep(6000);
const st = await S.eval(`(document.body.innerText.match(/(сохраняем ответы…|ответы сохранены|ответы не сохранились, повторим)/) || [null])[0]`);
check("responses 500: student told answers not saved", st === "ответы не сохранились, повторим", st);
await shot(S, "responses-500");
await intercept(S, []);
const ok = await waitFor(async () => (await S.eval(`(document.body.innerText.match(/ответы сохранены/) || [null])[0]`)) !== null, 20000);
check("after server recovers: answers saved by retry", ok.ok, { ms: ok.ms });

mark("C. медленный claim демонстрации");
await intercept(T, [{ match: /screen-share\/claim$/, status: 200, delayMs: 8000 }]);
await press(T, SHARE.off);
await sleep(1500);
const busy = await T.eval(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find(b => /Демонстрац/.test(b.getAttribute('aria-label'))); return b ? { disabled: b.disabled, svgLoader: !!b.querySelector('svg mask, svg [mask]') , html: b.innerHTML.slice(0, 160) } : null; })()`);
check("slow claim: share button shows progress", busy && (busy.svgLoader || busy.disabled), busy);
await shot(T, "slow-claim");
await sleep(9000);
await intercept(T, []);
await finish();
