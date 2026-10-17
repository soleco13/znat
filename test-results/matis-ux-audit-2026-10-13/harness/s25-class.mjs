// T3 (2026-10-17): класс на 30 на одной машине. Учитель и два ученика — настоящие
// Chrome (s1 урезан до CPU=$CPU ядра снаружи), остальные 27 учеников с камерами —
// синтетические (Go matis-loadgen, запускает run-class.sh). Режим «Обсуждение»:
// все видят всех. Замеры sample.js раз в 5 с, CPU контейнеров пишет run-class.sh.
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, teacherApi, LID } from "./lib.mjs";
const SAMPLE = fs.readFileSync("/w/sample.js", "utf8");
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S1 = P.s1, S2 = P.s2;
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
await teacherApi(T, "PATCH", `/lessons/${LID}/mode`, { mode: "discussion" });
check("s1 joins", await guestEnter(S1, "Слабый ученик", { cam: true, mic: true }));
check("s2 joins", await guestEnter(S2, "Ученик", { cam: true, mic: true }));
fs.writeFileSync("/w/ctl/start-shape", String(Date.now()));
mark("браузеры в уроке — старт синтетических учеников");
const out = fs.createWriteStream(`${process.env.OUT}/samples.jsonl`);
const N = Number(process.env.SAMPLES || 110);
for (let i = 0; i < N; i++) {
  await Promise.all([["a", T], ["b", S1], ["c", S2]].map(async ([who, p]) => {
    try { out.write(JSON.stringify({ who, ...JSON.parse(await p.eval(SAMPLE)) }) + "\n"); } catch {}
  }));
  await sleep(5000);
}
out.end();
await teacherApi(T, "PATCH", `/lessons/${LID}/mode`, { mode: "lecture" });
await finish();
