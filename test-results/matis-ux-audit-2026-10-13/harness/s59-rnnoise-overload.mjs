// 2026-10-27: RNNoise при перегрузке процессора (урок 26.10, Александрио):
// вход на полном CPU (сильное устройство → RNNoise), потом run-скрипт урезает
// процессор контейнера; ждём noise_suppression_stats и переход на встроенное.
import fs from "node:fs";
import { openBrowsers, P, teacherJoin, check, finish, sleep, mark, resetLesson } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
check("teacher joins with mic", await teacherJoin(T, { cam: false, mic: true }));
await resetLesson(T);
await sleep(25_000);
mark("shape");
fs.writeFileSync("/w/ctl/start-shape", "1");
await sleep(Number(process.env.SECS || 150) * 1000);
await finish();
