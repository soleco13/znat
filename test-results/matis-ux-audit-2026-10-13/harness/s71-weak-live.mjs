// A3/E2 (аудит 13.11): слабое устройство в живом классе. Один ученик с камерой и
// микрофоном на ограниченном числе потоков (cpuset — браузер видит столько ядер).
// Просто сидит в уроке HOLD_S секунд; всё, что нужно, пишет телеметрия приложения
// (media_cpu_adapt.audioCapture, computePressure, receivePressure, media_recv).
import { openBrowsers, P, guestEnter, check, finish, sleep, OUT } from "./lib.mjs";
await openBrowsers(["s1"]);
const S = P.s1;
check("weak student joins", await guestEnter(S, process.env.OBS_NAME || "Слабый ученик (замер)", { cam: true, mic: true }));
const hold = Number(process.env.HOLD_S || 240);
for (let t = 0; t < hold; t += 30) {
  await sleep(30000);
  const st = await S.eval(`({ cores: navigator.hardwareConcurrency, videos: [...document.querySelectorAll("video")].filter(v => v.videoWidth > 0 && !v.paused).length, tiles: document.querySelectorAll("video").length })`).catch(() => null);
  console.log("state", t + 30, JSON.stringify(st));
}
await S.shot(`${OUT}/shots/room.png`).catch(() => {});
await S.goto("about:blank");
await sleep(1500);
await finish({});
