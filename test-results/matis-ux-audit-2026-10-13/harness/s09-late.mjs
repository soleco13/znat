// Ученик входит ПОСЛЕ выдачи задания: видит ли он текущее задание?
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, finish, sleep, shot, mark, LID, text, log } from "./lib.mjs";
const MAT = "78fb5acf-eb79-428c-8830-878400353fe0";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
await T.eval(`(async () => { const r = await fetch("/api/v1/auth/refresh", {method:"POST",credentials:"include"}).then(r=>r.json()); await fetch("/api/v1/lessons/${LID}/activities", {method:"POST", headers:{"content-type":"application/json", authorization:"Bearer "+r.accessToken}, body: JSON.stringify({materialId:"${MAT}"})}); })()`);
await sleep(10000);
mark("ученик входит через 10 с после выдачи");
check("late student joins", await guestEnter(S, "Ученик Опоздал"));
const act = await waitFor(() => S.eval(`document.body.innerText.includes('Все типы заданий на одном уроке')`), 15000);
check("late joiner sees the current activity", act.ok, (await text(S)).slice(0, 200));
await shot(S, "late");
// а что в «Материалах урока»?
await S.click(`document.querySelector('button[aria-label="Материалы урока"]')`); await sleep(1500);
log({ kind: "info", text: "materials panel", extra: (await text(S)).slice(0, 400) });
await shot(S, "late-materials");
await finish();
