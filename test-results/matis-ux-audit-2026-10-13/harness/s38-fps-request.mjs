// 2026-10-21: прямо проверяем выбор временного слоя LiveKit: камера ученика 15 кадр/с,
// учитель просит у сервера 10, затем 7 кадр/с (setVideoFPS на публикации) — что приходит.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark } from "./lib.mjs";

await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
check("s1 enters", await guestEnter(S, "Юля Тестова", { cam: true, mic: true }));
await sleep(3000);
mark("s1 cap", await S.eval(`(async () => {
  const s = window.__pcs.flatMap(pc => pc.getSenders()).find(x => x.track && x.track.kind === 'video');
  await s.track.applyConstraints({ frameRate: { max: 15 }, width: { max: 640 }, height: { max: 360 } });
  return s.track.getSettings();
})()`));

// Комната LiveKit из дерева React (контекст <LiveKitRoom>).
const FIND_ROOM = `(() => {
  if (window.__lkRoom) return true;
  const host = document.getElementById('root');
  const key = Object.keys(host).find(k => k.startsWith('__reactContainer'));
  const stack = [host[key]];
  const seen = new Set();
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue; seen.add(f);
    const v = f.memoizedProps && f.memoizedProps.value;
    if (v && v.remoteParticipants && v.localParticipant) { window.__lkRoom = v; return true; }
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
  }
  return false;
})()`;
check("found room", await T.eval(FIND_ROOM));
const SET = (fps) => `(() => {
  for (const p of window.__lkRoom.remoteParticipants.values())
    for (const pub of p.trackPublications.values())
      if (pub.source === 'camera') { pub.setVideoQuality(0); pub.setVideoFPS(${fps}); return pub.trackSid; }
  return null;
})()`;
const IN = `(async () => {
  for (const pc of window.__pcs.filter(p => p.connectionState !== 'closed')) {
    const r = await pc.getStats(); let o = null;
    r.forEach(s => { if (s.type === 'inbound-rtp' && s.kind === 'video') o = { fps: s.framesPerSecond ?? null, h: s.frameHeight ?? null, bytes: s.bytesReceived }; });
    if (o) return o;
  }
  return null;
})()`;
async function measure(label) {
  await sleep(8000);
  const a = await T.eval(IN); await sleep(10000); const b = await T.eval(IN);
  const r = { fps: b?.fps, h: b?.h, kbps: a && b ? Math.round(((b.bytes - a.bytes) * 8) / 10000) : null };
  mark(label, r); return r;
}
const OUT = `(async () => { const o = []; for (const pc of window.__pcs.filter(p => p.connectionState !== 'closed')) { const r = await pc.getStats(); r.forEach(s => { if (s.type === 'outbound-rtp' && s.kind === 'video') o.push({ rid: s.rid, fps: s.framesPerSecond ?? null, h: s.frameHeight ?? null, sm: s.scalabilityMode ?? null }); }); } return o; })()`;
const res = {};
for (const fps of [30, 10, 7, 30, 10, 7]) {
  mark(`request ${fps}`, await T.eval(SET(fps)));
  const r = await measure(`LOW + ${fps} fps`);
  mark("s1 out", await S.eval(OUT));
  (res[fps] ??= []).push(r.fps);
}
mark("summary", res);
check("10 fps request on 15 fps camera ≈ full rate (bug)", Math.min(...res[10]) >= 12, res);
check("7 fps request gives ~7.5", Math.max(...res[7]) <= 9, res);
await finish();
