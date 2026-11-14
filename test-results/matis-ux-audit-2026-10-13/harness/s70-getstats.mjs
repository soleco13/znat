// B2 (аудит 13.11): цена мониторов статистики livekit-client — `receiver.getStats()` на
// каждую удалённую дорожку раз в 2 с. Один наблюдатель в тестовом уроке владельца на
// проде (с его разрешения), камера и микрофон выключены. Режим A — как есть; режим B —
// `RTCRtpReceiver.getStats` сразу отдаёт пустой отчёт (как если бы мониторы остановили).
// Фазы A/B чередуются на одной странице без перевхода; CPU контейнера браузера снимает
// хост (run-getstats.sh) и сопоставляет с метками фаз.
import fs from "node:fs";
import { openBrowsers, P, guestEnter, check, finish, sleep, mark, OUT } from "./lib.mjs";

const PHASE_S = Number(process.env.PHASE_S || 60);
const ROUNDS = Number(process.env.ROUNDS || 3);
const PATCH = `(() => {
  window.__gs = { mode: "A", calls: 0 };
  const orig = RTCRtpReceiver.prototype.getStats;
  RTCRtpReceiver.prototype.getStats = function () {
    window.__gs.calls++;
    return window.__gs.mode === "B" ? Promise.resolve(new Map()) : orig.call(this);
  };
})();`;

await openBrowsers(["s1"]);
const S = P.s1;
await S.send("Page.addScriptToEvaluateOnNewDocument", { source: PATCH });
check("observer joins", await guestEnter(S, process.env.OBS_NAME || "Наблюдатель (замер)", { cam: false, mic: false }));
await sleep(20000);
const state = () => S.eval(`({ calls: window.__gs.calls, cores: navigator.hardwareConcurrency,
  videos: [...document.querySelectorAll("video")].filter(v => v.videoWidth > 0 && !v.paused).length,
  audios: document.querySelectorAll("audio").length })`);
const phases = [];
for (let r = 0; r < ROUNDS; r++) {
  for (const mode of ["A", "B"]) {
    await S.eval(`window.__gs.mode = ${JSON.stringify(mode)}`);
    await sleep(3000); // переход между режимами в замер не входит
    const from = Date.now(), before = await state(), m0 = await S.metrics();
    await sleep(PHASE_S * 1000);
    const after = await state(), m1 = await S.metrics();
    const ph = { mode, from, to: Date.now(), calls: after.calls - before.calls, videos: after.videos, audios: after.audios, cores: after.cores,
      taskS: +(m1.TaskDuration - m0.TaskDuration).toFixed(2), scriptS: +(m1.ScriptDuration - m0.ScriptDuration).toFixed(2) };
    phases.push(ph);
    mark(`phase ${mode}`, ph);
    fs.writeFileSync(`${OUT}/phases.json`, JSON.stringify(phases));
  }
}
await S.eval(`window.__gs.mode = "A"`);
await S.shot(`${OUT}/shots/room.png`).catch(() => {});
// Выйти из урока, чтобы плитка наблюдателя не висела.
await S.goto("about:blank");
await sleep(1500);
await finish({ phases });
