// Эксперимент: после скачка задержки — (а) ничего, (б) jitterBufferTarget у приёмников звука, (в) пересоздать приём
// (снять/вернуть дорожку через replace receiver нельзя без LiveKit — проверяем (б)).
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, ctl, clearNet, log } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик JB"));
await sleep(6000);
const jb = (p) => p.eval(`(async () => { const s = await window.__collect(); const a = s.filter(x => x.conn !== 'closed').flatMap(x => x.inbound || []).filter(x => x.kind === 'audio'); return { d: a.reduce((s, x) => s + (x.jitterBufferDelay || 0), 0), n: a.reduce((s, x) => s + (x.jitterBufferEmittedCount || 0), 0) }; })()`, 5000).catch(() => null);
async function watch(p, seconds) { let prev = await jb(p); const rows = []; for (let i = 0; i < seconds; i++) { await sleep(1000); const cur = await jb(p); rows.push(cur.n > prev.n ? Math.round((1000 * (cur.d - prev.d)) / (cur.n - prev.n)) : null); prev = cur; } return rows; }
for (const variant of ["none", "target"]) {
  mark(`скачок 1500 мс на 8 с, вариант ${variant}`);
  await ctl({ cmd: "custom", who: "s1", down: 10000, up: 5000, lat: 1500, jit: 500, loss: 0 });
  await sleep(8000);
  await clearNet("s1");
  await sleep(1500);
  if (variant === "target") {
    const n = await S.eval(`(() => { let n = 0; for (const pc of window.__pcs || []) for (const r of pc.getReceivers()) if (r.track && r.track.kind === 'audio' && 'jitterBufferTarget' in r) { r.jitterBufferTarget = 0; n++; } return n; })()`);
    log({ kind: "info", text: "jitterBufferTarget set on receivers", extra: n });
  }
  const rows = await watch(S, 12);
  log({ kind: "info", text: `variant ${variant}: delay per s`, extra: rows });
  await sleep(15000);
}
await finish();
