// Слабый ПК при хорошей сети (урок 2026-10-19, Елена: 4 потока, CRITICAL cpu-governor,
// звук собеседницы с задержкой 0,7–1 с, видео замирает ~10 с/мин). CPU ученика s1
// задаёт run-weak-cpu.sh (docker --cpus). DIP=1 — входящий канал s1 провалами, как у Елены
// по логам LiveKit (оценка 75–290 кбит/с, очередь 0,4–0,5 с): 20 с норма, 25 с — 250 кбит/с.
// Замеры — sample.js.
import fs from "node:fs";
import { openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, ctl, clearNet } from "./lib.mjs";
const SAMPLE = fs.readFileSync("/w/sample.js", "utf8");
const SECS = Number(process.env.SECS || 300);
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
check("s1 joins", await guestEnter(S, "Елена-стенд", { cam: true, mic: true }));
// CUT_DELAY — подождать после входа, прежде чем урезать CPU: RNNoise сильного по профилю
// s1 стартует на полном процессоре, иначе прогон решает случайный rnnoise_timeout.
await sleep(Number(process.env.CUT_DELAY || 0) * 1000);
fs.writeFileSync("/w/ctl/start-shape", String(Date.now()));
mark("оба в уроке");
const out = fs.createWriteStream(`${process.env.OUT}/samples.jsonl`);
const end = Date.now() + SECS * 1000;
const DIP = process.env.DIP === "1";
const NORM = { down: 3000, up: 1500, lat: 40, jit: 4, loss: 0.3 }, LOW = { ...NORM, down: 250 };
let phase = -1, phaseAt = 0;
while (Date.now() < end) {
  if (DIP && Date.now() >= phaseAt) {
    phase = (phase + 1) % 2;
    phaseAt = Date.now() + (phase ? 25000 : 20000);
    await ctl({ cmd: "custom", who: "s1", ...(phase ? LOW : NORM) });
    mark(phase ? "канал s1: провал 250 кбит/с" : "канал s1: норма");
  }
  await Promise.all([["a", T], ["b", S]].map(async ([who, p]) => {
    try { out.write(JSON.stringify({ who, ...JSON.parse(await p.eval(SAMPLE, 15000)) }) + "\n"); } catch {}
  }));
  await sleep(2000);
}
out.end();
if (DIP) await clearNet("s1");
await finish();
