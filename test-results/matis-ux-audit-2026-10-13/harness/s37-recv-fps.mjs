// 2026-10-21: доходит ли «чужие камеры реже» (setVideoFPS(10) в PoorLinkMedia) до
// сервера. Учитель с урезанным CPU (run-recv-fps.sh) → его автомат нагрузки
// включает облегчённый приём; смотрим кадр/с и высоту видео ученика у учителя
// и временные слои камеры ученика.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark } from "./lib.mjs";

await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
// S1_CORES=2 — ученик как MacBook Юли: слабое устройство, камера 15 кадр/с.
if (process.env.S1_CORES) await S.send("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: Number(process.env.S1_CORES) });
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
check("s1 enters", await guestEnter(S, "Юля Тестова", { cam: true, mic: true }));
// S1_FPS=15 — камера ученика как у Юли (15 кадр/с): временные слои 3,75 / 7,5 / 15.
if (process.env.S1_FPS) {
  await sleep(3000);
  mark("s1 camera fps cap", await S.eval(`(async () => {
    const s = window.__pcs.flatMap(pc => pc.getSenders()).find(x => x.track && x.track.kind === 'video');
    if (!s) return 'no camera';
    await s.track.applyConstraints({ frameRate: { max: ${Number(process.env.S1_FPS)} } });
    return s.track.getSettings().frameRate;
  })()`));
}

const IN = `(async () => {
  const out = [];
  for (const pc of window.__pcs.filter(p => p.connectionState !== 'closed')) {
    const r = await pc.getStats();
    r.forEach(s => { if (s.type === 'inbound-rtp' && s.kind === 'video') out.push({ fps: s.framesPerSecond ?? null, h: s.frameHeight ?? null, decoded: s.framesDecoded, bytes: s.bytesReceived }); });
  }
  return out;
})()`;
const OUT = `(async () => {
  const out = [];
  for (const pc of window.__pcs.filter(p => p.connectionState !== 'closed')) {
    const r = await pc.getStats();
    r.forEach(s => { if (s.type === 'outbound-rtp' && s.kind === 'video') out.push({ rid: s.rid, sm: s.scalabilityMode ?? null, fps: s.framesPerSecond ?? null, h: s.frameHeight ?? null, active: s.active }); });
  }
  return out;
})()`;

let prev = null;
for (let i = 0; i < 16; i++) {
  await sleep(10000);
  const inV = await T.eval(IN);
  const kbps = prev && inV[0] ? Math.round(((inV[0].bytes - prev) * 8) / 10000) : null;
  prev = inV[0]?.bytes ?? null;
  mark(`t+${(i + 1) * 10}s`, { teacherIn: inV.map(({ fps, h }) => ({ fps, h })), kbps, s1Out: i % 4 === 0 ? await S.eval(OUT) : undefined });
}
await finish();
