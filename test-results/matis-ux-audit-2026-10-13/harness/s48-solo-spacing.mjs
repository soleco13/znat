// 2026-10-24: снимки DOM для inspect-spacing — учитель один в уроке (камера и
// карточка со ссылкой — две плитки одной сетки, как у Толка) на 1440, 1728 и 390 px.
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, check, finish, sleep, shot } from "./lib.mjs";
const CAP = fs.readFileSync("/w/bd-capture.js", "utf8");
await openBrowsers(["teacher"]);
const T = P.teacher;
check("teacher joins", await teacherJoin(T, { cam: true, mic: false }));
await resetLesson(T);
for (const [w, h, mobile] of [[1440, 900, false], [1728, 1080, false], [390, 844, true]]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(2500);
  const st = await T.eval(CAP, 20000);
  fs.writeFileSync(`${process.env.OUT}/spacing-${w}.json`, JSON.stringify(st));
  await shot(T, `spacing-${w}`);
}
await finish();
