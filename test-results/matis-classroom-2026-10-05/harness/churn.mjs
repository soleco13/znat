// G-06: сколько строк lesson_participants дают переподключения и циклы входа/выхода.
// Боты API как браузер; строки считает вызывающий по guestId (psql).
import { Bot } from "./lib.mjs";
const cfg = { lessonId: process.env.LID, joinPath: process.env.JOIN_PATH };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const joinRaw = async (b) => {
  const r = await b.http.req("POST", `/lessons/${b.lessonId}/join`);
  if (r.status === 200) b.identity = JSON.parse(Buffer.from(r.json.media.token.split(".")[1], "base64url").toString()).sub;
  return r.status;
};
const tally = (arr) => arr.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {});
// Переподключения: /join при живой записи присутствия (обрыв, F5, MediaRecovery).
for (const n of (process.env.RECONNECTS || "20,100").split(",").map(Number)) {
  const b = new Bot(900 + n, cfg);
  await b.enter();
  const st = [];
  for (let i = 0; i < n; i++) { st.push(await joinRaw(b)); await sleep(250); }
  out[`reconnect${n}`] = { identity: b.identity, statuses: tally(st) };
  await b.http.req("POST", `/lessons/${b.lessonId}/leave`);
}
// Выход → вход той же личностью.
{
  const n = Number(process.env.CYCLES || 20);
  const b = new Bot(950, cfg);
  await b.enter();
  const st = [];
  for (let i = 0; i < n; i++) { st.push(await joinRaw(b)); await b.http.req("POST", `/lessons/${b.lessonId}/leave`); await sleep(250); }
  out[`leaveRejoin${n}`] = { identity: b.identity, statuses: tally(st) };
}
// Новые гостевые личности подряд: /enter → /join → /leave.
{
  const n = Number(process.env.NEW_IDS || 20);
  const ids = [], st = [];
  for (let i = 0; i < n; i++) {
    const b = new Bot(1000 + i, cfg);
    await b.enter();
    st.push(await joinRaw(b));
    if (b.identity) ids.push(b.identity);
    await b.http.req("POST", `/lessons/${b.lessonId}/leave`);
  }
  out[`newIdentities${n}`] = { identities: ids, statuses: tally(st) };
}
console.log(JSON.stringify(out));
