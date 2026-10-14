// Скачок задержки (Wi-Fi «захлебнулся») и всплеск потерь на 8 с: сколько звук отстаёт ПОСЛЕ нормализации сети.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, ctl, clearNet, log } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Скачок"));
await sleep(6000);
// задержка воспроизведения входящего звука (мс): прирост jitterBufferDelay / прирост выданных сэмплов
const jb = (p) => p.eval(`(async () => { const s = await window.__collect(); const a = s.filter(x => x.conn !== 'closed').flatMap(x => x.inbound || []).filter(x => x.kind === 'audio'); return { d: a.reduce((s, x) => s + (x.jitterBufferDelay || 0), 0), n: a.reduce((s, x) => s + (x.jitterBufferEmittedCount || 0), 0), b: a.reduce((s, x) => s + (x.bytesReceived || 0), 0) }; })()`, 5000).catch(() => null);
async function watch(label, p, seconds) {
  let prev = await jb(p); const rows = [];
  for (let i = 0; i < seconds; i++) { await sleep(1000); const cur = await jb(p); if (prev && cur) rows.push({ s: i + 1, delayMs: cur.n > prev.n ? Math.round((1000 * (cur.d - prev.d)) / (cur.n - prev.n)) : null, kb: Math.round((cur.b - prev.b) / 1024) }); prev = cur; }
  log({ kind: "info", text: label, extra: rows });
  return rows;
}
await watch("baseline: student playout delay", S, 4);
for (const [name, p] of [["latency 1500±500 ms", { down: 10000, up: 5000, lat: 1500, jit: 500, loss: 0 }], ["loss 30%", { down: 10000, up: 5000, lat: 40, jit: 10, loss: 30 }]]) {
  mark(`${name} на 8 с`);
  await ctl({ cmd: "custom", who: "s1", ...p });
  await sleep(8000);
  await clearNet("s1");
  const rows = await watch(`after ${name}: student playout delay per second`, S, 20);
  const settled = rows.findIndex((r) => r.delayMs !== null && r.delayMs < 250);
  // 2026-10-14: AudioLagGuard ждёт 3 с спокойной сети (без скачков RTT), чтобы
  // не сбрасывать буфер на волнистой сети (урок Елены) — порог 5 → 10 с;
  // без сброса задержка держится 15–20 с.
  check(`${name}: playout delay back under 250 ms within 10 s after network normalises`, settled >= 0 && settled < 10, { settledAtS: settled + 1, rows: rows.slice(0, 12) });
  await sleep(5000);
}
await finish();
