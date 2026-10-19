// Проверка: звук и камера одного участника — в одном MediaStream (синхронизация губ Chrome)?
import { openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, log } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
check("teacher joins", await teacherJoin(P.teacher, { cam: true, mic: true }));
check("s1 joins", await guestEnter(P.s1, "Елена-стенд", { cam: true, mic: true }));
await sleep(15000);
const r = await P.s1.eval(`(async () => {
  const out = { msid: [], streams: [], stats: [] };
  for (const pc of window.__pcs || []) {
    if (pc.connectionState === 'closed') continue;
    const sdp = pc.remoteDescription?.sdp || '';
    out.msid.push(...sdp.split('\\r\\n').filter(l => l.startsWith('a=msid:')));
    for (const t of pc.getTransceivers()) if (t.receiver.track && t.currentDirection !== 'inactive') out.streams.push(t.receiver.track.kind + ' ' + t.mid);
    const st = await pc.getStats();
    st.forEach(s => { if (s.type === 'inbound-rtp') out.stats.push({ kind: s.kind, jbd: s.jitterBufferDelay, jbt: s.jitterBufferTargetDelay, jbm: s.jitterBufferMinimumDelay, jbe: s.jitterBufferEmittedCount }); });
  }
  return JSON.stringify(out);
})()`, 15000);
log({ kind: "PROBE", text: r });
console.log("PROBE", r);
await finish();
