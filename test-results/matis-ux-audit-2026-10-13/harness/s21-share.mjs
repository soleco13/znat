// Демонстрация экрана у ведущего со слабым ПК и узким исходящим каналом (жалоба 2026-10-14):
// голос ведущего у зрителя «зависает и пропадает», хуже — когда ведущий сворачивает урок или открывает приложение поверх.
// Ведущий — учитель (CPU и сеть урезает run-share.sh), зритель — s1. Замеры sample.js раз в 2 с, фазы — в поле phase.
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, press, SHARE, waitFor, labelOf, secondTab } from "./lib.mjs";
const SAMPLE = fs.readFileSync("/w/sample.js", "utf8");
const HEAVY = "data:text/html;base64," + fs.readFileSync("/w/heavy.html").toString("base64");
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
check("s1 joins", await guestEnter(S, "Зритель", { cam: true, mic: false }));
await sleep(10000);
fs.writeFileSync("/w/ctl/start-shape", String(Date.now()));
const out = fs.createWriteStream(`${process.env.OUT}/samples.jsonl`);
let phase = "1-no-share";
let stop = false;
const loop = (async () => {
  while (!stop) {
    await Promise.all([["a", T], ["b", S]].map(async ([who, p]) => {
      try { out.write(JSON.stringify({ who, phase, ...JSON.parse(await p.eval(SAMPLE)) }) + "\n"); } catch {}
    }));
    await sleep(2000);
  }
})();
await sleep(30000);
mark("демонстрация"); phase = "2-share";
await press(T, SHARE.off);
check("share on", (await waitFor(async () => (await labelOf(T, [SHARE.on])) === SHARE.on, 30000)).ok);
await sleep(40000);
mark("поверх урока — тяжёлая вкладка"); phase = "3-share-hidden";
const H = await secondTab(T, "heavy");
await H.goto(HEAVY);
await T.browser.call("Target.activateTarget", { targetId: H.targetId });
await sleep(1500);
check("room tab hidden", (await T.eval("document.visibilityState")) === "hidden", await T.eval("document.visibilityState"));
await sleep(60000);
mark("вернулся на урок"); phase = "4-back";
await T.browser.call("Target.activateTarget", { targetId: T.targetId });
await sleep(30000);
stop = true; await loop; out.end();
await finish();
