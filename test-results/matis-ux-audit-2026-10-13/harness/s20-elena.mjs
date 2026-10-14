// Матис в условиях Елены (2026-10-14): учитель — обычный ПК и сеть; ученик s1 — урезанный CPU и сеть по shape.py.
// Сравнение с Контур Толком (test-results/kontur-research-2026-10-14) теми же замерами (sample.js).
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark } from "./lib.mjs";
const SAMPLE = fs.readFileSync("/w/sample.js", "utf8");
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
check("s1 joins", await guestEnter(S, "Елена-стенд", { cam: true, mic: true }));
await sleep(25000);
fs.writeFileSync("/w/ctl/start-shape", String(Date.now()));
mark("сеть Елены: старт расписания");
const out = fs.createWriteStream(`${process.env.OUT}/samples.jsonl`);
for (let i = 0; i < 125; i++) {
  await Promise.all([["a", T], ["b", S]].map(async ([who, p]) => {
    try { out.write(JSON.stringify({ who, ...JSON.parse(await p.eval(SAMPLE)) }) + "\n"); } catch {}
  }));
  await sleep(2000);
}
out.end();
await finish();
