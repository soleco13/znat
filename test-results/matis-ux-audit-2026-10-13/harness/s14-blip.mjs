// Короткие обрывы (3/5/10 с): посекундно — когда после возврата сети снова идёт звук в обе стороны,
// что делает LiveKit (переподключение/ICE-restart), сколько «лишнего» молчания сверх самого обрыва.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, cut, log } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Блип"));
await sleep(6000);
const inAudio = (p) => p.eval(`(async () => { const s = await window.__collect(); return s.filter(x => x.conn !== 'closed').flatMap(x => x.inbound || []).filter(x => x.kind === 'audio').reduce((a, x) => a + (x.bytesReceived || 0), 0); })()`, 5000).catch(() => null);
const pcState = (p) => p.eval(`(window.__pcs || []).map(pc => pc.connectionState + '/' + pc.iceConnectionState).join(',')`).catch(() => "?");
for (const sec of [3, 5, 10]) {
  mark(`обрыв ${sec} с`);
  let prevS = await inAudio(S), prevT = await inAudio(T);
  await cut("s1", true);
  const tCut = Date.now();
  await sleep(sec * 1000);
  await cut("s1", false);
  const tBack = Date.now();
  let sResume = null, tResume = null;
  const timeline = [];
  for (let i = 0; i < 40 && (sResume === null || tResume === null); i++) {
    await sleep(500);
    const [s, t] = [await inAudio(S), await inAudio(T)];
    const ds = s - prevS, dt = t - prevT; prevS = s; prevT = t;
    timeline.push({ at: ((Date.now() - tBack) / 1000).toFixed(1), studentIn: ds, teacherIn: dt, pc: await pcState(S) });
    if (sResume === null && ds > 500) sResume = Date.now() - tBack;
    if (tResume === null && dt > 500) tResume = Date.now() - tBack;
  }
  log({ kind: "info", text: `blip ${sec}s`, extra: { studentHearsAfterMs: sResume, teacherHearsAfterMs: tResume } });
  console.log(JSON.stringify(timeline.slice(0, 12)));
  const pcev = await S.eval(`(window.__pcEvents || []).filter(e => e.t > ${tCut} - 1000).map(e => ((e.t - ${tCut}) / 1000).toFixed(1) + 's pc' + e.pc + ' ' + e.type + '=' + e.v).slice(0, 40)`);
  log({ kind: "info", text: `pc events ${sec}s`, extra: pcev });
  check(`blip ${sec}s: audio back within 2 s after network returns (both ways)`, sResume !== null && tResume !== null && sResume <= 2000 && tResume <= 2000, { sResume, tResume });
  await sleep(8000);
}
await finish();
