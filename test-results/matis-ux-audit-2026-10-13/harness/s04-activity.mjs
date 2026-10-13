// Задание: ответ → F5 посреди работы → ответы на месте; сохранение без сети; двойная «Сдать»;
// учитель выдаёт новое задание, пока ученик отвечает.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, inRoom, mark, block, LID, teacherApi, text, sql, byText, log } from "./lib.mjs";
const MAT = "78fb5acf-eb79-428c-8830-878400353fe0";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Задание"));
await sleep(2000);
const startAct = () => T.eval(`(async () => { const r = await fetch("/api/v1/auth/refresh", {method:"POST",credentials:"include"}).then(r=>r.json()); const res = await fetch("/api/v1/lessons/${LID}/activities", {method:"POST", headers:{"content-type":"application/json", authorization:"Bearer "+r.accessToken}, body: JSON.stringify({materialId:"${MAT}"})}); return await res.json(); })()`);
const act = await startAct();
check("activity started", !!act.id, act);
const shown = await waitFor(() => S.eval(`document.body.innerText.includes('Сколько будет 7 × 8')`), 20000);
check("student sees activity", shown.ok, { ms: shown.ms });
const pid = (await sql(`select participant_id from responses where activity_id='${act.id}' limit 1`))[0];
const saveStatus = () => S.eval(`(document.body.innerText.match(/(сохраняем ответы…|ответы сохранены|ответы не сохранились, повторим)/) || [null])[0]`);

mark("1. ответ → F5 → ответ на месте");
await S.click(`[...document.querySelectorAll('label,button,[role=radio]')].find(e => e.getBoundingClientRect().width > 0 && e.textContent.trim() === '56')`);
const saved = await waitFor(async () => (await saveStatus()) === "ответы сохранены", 15000);
check("autosave shows 'ответы сохранены'", saved.ok, await saveStatus());
const rows1 = await sql(`select question_id, response from responses where activity_id='${act.id}'`);
check("answer stored on server", rows1.length >= 1, rows1);
const before = await S.eval("performance.timeOrigin"); await S.reload(); await waitFor(async () => (await S.eval("performance.timeOrigin")) !== before, 15000);
await waitFor(() => S.eval(`document.body.innerText.includes('Сколько будет 7 × 8')`), 30000);
await sleep(2000);
const checkedAfter = await S.eval(`(() => { const r = [...document.querySelectorAll('input[type=radio],[role=radio]')].find(x => (x.checked || x.getAttribute('aria-checked') === 'true')); return r ? (r.closest('label')?.textContent || r.parentElement?.textContent || 'checked').trim().slice(0,20) : null; })()`);
check("after F5 the chosen answer is still selected", !!checkedAfter && checkedAfter.includes("56"), checkedAfter);
await shot(S, "after-f5");

mark("2. сохранение при недоступном приложении");
await block("s1", "app");
await S.click(`[...document.querySelectorAll('label,button,[role=checkbox]')].find(e => e.getBoundingClientRect().width > 0 && e.textContent.trim() === '17')`);
await sleep(12000);
const st2 = await saveStatus();
check("offline: student sees 'не сохранились, повторим' (not 'сохранены')", st2 === "ответы не сохранились, повторим" || st2 === "сохраняем ответы…", st2);
await shot(S, "offline-save");
await block("s1", "none");
const back = await waitFor(async () => (await saveStatus()) === "ответы сохранены", 40000);
check("after recovery autosave catches up", back.ok, { ms: back.ms, st: await saveStatus() });

mark("3. двойное «Сдать работу»");
// до кнопки сдачи — последняя страница
for (let i = 0; i < 12; i++) { const ok = await S.click(`[...document.querySelectorAll('button[aria-label]')].find(b => b.getBoundingClientRect().width > 0 && /Следующ/.test(b.getAttribute('aria-label')))`); if (!ok) break; await sleep(250); }
const hasSubmit = await S.eval(`!!${byText("button", "Сдать работу")}`);
check("submit button reachable", hasSubmit);
if (hasSubmit) {
  await S.click(byText("button", "Сдать работу")); await S.click(byText("button", "Сдать работу")).catch(() => {});
  await sleep(1500);
  // подтверждение, если есть
  const confirm = await S.eval(`[...document.querySelectorAll('[role=alertdialog] button, [role=dialog] button')].map(b=>b.textContent.trim())`);
  log({ kind: "info", text: "confirm buttons: " + JSON.stringify(confirm) });
  if (confirm.length) { await S.click(`[...document.querySelectorAll('[role=alertdialog] button, [role=dialog] button')].find(b => /Сдать|Да|Отправить/.test(b.textContent))`); await S.click(`[...document.querySelectorAll('[role=alertdialog] button, [role=dialog] button')].find(b => /Сдать|Да|Отправить/.test(b.textContent))`).catch(() => {}); }
  const done = await waitFor(() => S.eval(`document.body.innerText.includes('Работа сдана')`), 20000);
  check("student sees 'Работа сдана'", done.ok, (await text(S)).slice(0, 200));
  const attempts = await sql(`select count(distinct attempt_number), count(*) filter (where submitted) from responses where activity_id='${act.id}'`);
  check("double submit -> single attempt", attempts[0]?.startsWith("1|"), attempts);
  await shot(S, "submitted");
}

mark("4. учитель выдаёт новое задание, пока ученик в первом");
const act2 = await startAct();
await sleep(5000);
const sTxt = await text(S);
check("student switched to new activity (or told)", sTxt.includes("Сколько будет 7 × 8"), sTxt.slice(0, 150));
const first = await sql(`select count(*) from responses where activity_id='${act.id}'`);
check("first activity answers preserved", Number(first[0]) >= 2, first);
await finish({ act: act.id, act2: act2.id });
