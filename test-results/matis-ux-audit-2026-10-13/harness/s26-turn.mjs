// T7 (2026-10-17, стенд): ученик-браузер s2 в сети без UDP (MODE=noudp) или
// только TCP 443 для медиа (MODE=only443; сайт и сигнализация стенда — как будто
// на 443) входит в урок; учитель — обычный Chrome. Проверяем вход, путь медиа
// (тип кандидата и протокол из getStats), звук и видео в обе стороны.
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, flow, hears } from "./lib.mjs";
const SAMPLE = fs.readFileSync("/w/sample.js", "utf8");
await openBrowsers(["teacher", "s2"]);
const T = P.teacher, S = P.s2;
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
fs.writeFileSync("/w/ctl/start-shape", String(Date.now()));
await sleep(1500);
const t0 = Date.now();
check(`s2 joins (${process.env.MODE})`, await guestEnter(S, `TURN-тест ${process.env.MODE}`, { cam: true, mic: true }));
mark(`вошёл за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
await sleep(15000);
const PATH = `(async () => {
  const out = [];
  for (const pc of (window.__matisPcs || [])) {}
  return out;
})()`;
const path = await S.eval(`(async () => {
  const r = performance.getEntriesByType('resource').length; return r;
})()`).catch(() => null);
const out = fs.createWriteStream(`${process.env.OUT}/samples.jsonl`);
for (let i = 0; i < 12; i++) {
  await Promise.all([["a", T], ["b", S]].map(async ([who, p]) => {
    try { out.write(JSON.stringify({ who, ...JSON.parse(await p.eval(SAMPLE)) }) + "\n"); } catch {}
  }));
  await sleep(5000);
}
out.end();
const [ft, fs_] = await Promise.all([flow(T), flow(S)]);
check("s2 hears teacher", hears(fs_), fs_);
check("teacher hears s2", hears(ft), ft);
check("s2 sees teacher video", fs_.remoteVideoPlaying > 0, fs_);
check("teacher sees s2 video", ft.remoteVideoPlaying > 0, ft);
await finish();
