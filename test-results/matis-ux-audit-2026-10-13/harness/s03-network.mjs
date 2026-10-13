// Обрывы сети ученика 5/15/30/60 с; потеря только приложения (REST/WS) при живом медиа;
// чат во время обрыва. Что видит ученик во время обрыва и после, что видит учитель.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, inRoom, flow, hears, mark, cut, block, sendChat, countText, text } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Сеть"));
await sleep(5000);
const recovered = async (label) => {
  const r = await waitFor(async () => { const u = await ui(S); return u.inRoom && !u.overlayReconnect && u.pills.length === 0; }, 60000, 500);
  const [fs_, ft] = await Promise.all([flow(S), flow(T)]);
  check(`${label}: UI recovered`, r.ok, { ms: r.ms, ui: await ui(S) });
  check(`${label}: student hears teacher`, hears(fs_), fs_);
  check(`${label}: teacher hears student`, hears(ft), ft);
  const msg = `net-${label}-${Date.now() % 100000}`;
  await sendChat(S, msg);
  check(`${label}: chat works after`, (await waitFor(async () => (await countText(T, msg)) >= 1, 10000)).ok);
};
for (const sec of [5, 15, 30, 60]) {
  mark(`обрыв ${sec} с`);
  await cut("s1", true);
  const seen = new Set(); const tSeen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < sec * 1000) {
    const u = await ui(S); const tu = await text(T);
    if (u.pills?.length) seen.add(u.pills.join("|"));
    if (u.overlayReconnect) seen.add("overlay:Связь прервалась");
    for (const t of u.toasts || []) seen.add("toast:" + t);
    if (/Переподключ|переподключ/.test(tu)) tSeen.add("teacher:reconnecting-label");
    await sleep(1000);
  }
  await shot(S, `cut${sec}`); await shot(T, `cut${sec}`);
  check(`cut ${sec}s: student sees some connection state`, sec < 5 || seen.size > 0, [...seen]);
  log2(`cut ${sec}s student saw`, [...seen], [...tSeen]);
  await cut("s1", false);
  await recovered(`cut${sec}`);
  await sleep(3000);
}
function log2(...a) { console.log("INFO", JSON.stringify(a)); }

mark("только приложение (REST/WS урока/доска) недоступно 30 с, медиа живо");
await block("s1", "app");
const seenApp = new Set(); const t1 = Date.now();
let mediaDuring = null;
while (Date.now() - t1 < 30000) { const u = await ui(S); if (u.pills?.length) seenApp.add(u.pills.join("|")); if (u.overlayReconnect) seenApp.add("overlay"); if (!mediaDuring && Date.now() - t1 > 12000) mediaDuring = await flow(S); await sleep(1000); }
log2("app-down student saw", [...seenApp]);
check("app-down: media keeps flowing (student hears teacher)", mediaDuring && hears(mediaDuring), mediaDuring);
await shot(S, "app-down");
mark("чат во время недоступности приложения");
await block("s1", "app");
const m2 = `offline-${Date.now() % 100000}`;
await sendChat(S, m2);
await sleep(8000);
const errShown = await S.eval(`document.body.innerText.includes('не отправлено') || document.body.innerText.includes('Отправляется')`);
check("app-down: chat shows pending/error state", errShown, (await ui(S)).toasts);
await block("s1", "none");
const delivered = await waitFor(async () => (await countText(T, m2)) >= 1, 30000);
const draft = await S.eval(`document.querySelector('[aria-label="Сообщение классу"]')?.value || ''`);
check("app-down: message either delivered after recovery or returned to input", delivered.ok || draft.includes(m2), { delivered: delivered.ok, draft });
check("app-down: no duplicate after recovery", (await countText(T, m2)) <= 1, { n: await countText(T, m2) });
await recovered("app-down");
await finish();
