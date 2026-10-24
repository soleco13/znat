// 2026-10-24: снимки DOM для inspect-spacing (Better Design) — урок с тремя
// участниками на 1440, 1728 и 390 px.
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, shot, teacherApi, LID } from "./lib.mjs";
const CAP = fs.readFileSync("/w/bd-capture.js", "utf8");
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher;
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
await teacherApi(T, "PATCH", `/lessons/${LID}/mode`, { mode: "discussion" });
check("s1 joins", await guestEnter(P.s1, "Юля Тестова", { cam: true, mic: true }));
check("s2 joins", await guestEnter(P.s2, "Елена Тестова", { cam: true, mic: true }));
for (const [w, h, mobile] of [[1440, 900, false], [1728, 1080, false], [390, 844, true]]) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(2500);
  const st = await T.eval(CAP, 20000);
  fs.writeFileSync(`${process.env.OUT}/spacing-${w}.json`, JSON.stringify(st));
  await shot(T, `spacing-${w}`);
}
await finish();
