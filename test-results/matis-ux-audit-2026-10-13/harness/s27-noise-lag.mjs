// 2026-10-17: задержка звука учителя у ученика при RNNoise и без него (MODE=strong|standard).
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, waitFor, flow, hears, mark, byLabel } from "./lib.mjs";
const MODE = process.env.MODE || "strong";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
if (MODE !== "strong") {
  await T.click(byLabel("Выбрать микрофон"));
  await waitFor(() => T.eval(`!!document.querySelector('[aria-label="Шумоподавление"]')`), 8000);
  await T.click(`document.querySelector('[aria-label="Шумоподавление"]')`);
  await sleep(500);
  await T.click(`[...document.querySelectorAll('[role=option]')].find(o => o.innerText.startsWith("Обычное"))`);
  await sleep(300);
  await T.click(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Применить')`);
  await sleep(3000);
}
const lbl = await T.eval(`(window.__pcs.flatMap(pc => pc.getSenders()).find(x => x.track && x.track.kind === 'audio')||{track:{label:'-'}}).track.label`);
mark("teacher sender", lbl);
check("s1 enters", await guestEnter(S, "Ника Тестова"));
await sleep(15000);
mark("steady start");
const J = `(async()=>{const r=[];for(const pc of window.__pcs){if(pc.connectionState==='closed')continue;const st=await pc.getStats();st.forEach(v=>{if(v.type==='inbound-rtp'&&v.kind==='audio')r.push({jbd:v.jitterBufferDelay,jbe:v.jitterBufferEmittedCount,conc:v.concealedSamples,tot:v.totalSamplesReceived});});}return r;})()`;
const a = await S.eval(J);
await sleep(60000);
const b = await S.eval(J);
const sum = (x, k) => x.reduce((s, v) => s + (v[k] || 0), 0);
const jb = (sum(b, "jbd") - sum(a, "jbd")) / Math.max(1, sum(b, "jbe") - sum(a, "jbe")) * 1000;
const conc = (sum(b, "conc") - sum(a, "conc")) / Math.max(1, sum(b, "tot") - sum(a, "tot")) * 100;
mark("steady end", { mode: MODE, jitterBufferMs: Math.round(jb), concealedPct: Math.round(conc * 100) / 100 });
const f = await flow(S, 3000);
check("student hears", hears(f), f);
await finish();
