// 2026-10-17: шумоподавление по силе устройства — на стенде (сильный ПК) «Авто» = RNNoise.
// Проверяем: на сервер уходит обработанный трек, голос учителя ученик слышит,
// переключение «Выключено» / «Обычное» / «Сильное» в настройках урока работает.
import { resetLesson, openBrowsers, shot, P, teacherJoin, guestEnter, check, finish, sleep, waitFor, flow, hears, mark, byLabel } from "./lib.mjs";

await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
check("s1 enters", await guestEnter(S, "Ника Тестова"));

// Обработанный трек — из MediaStreamDestination (так он и называется).
const SENDER = `(() => {
  const s = window.__pcs.filter(pc => pc.connectionState !== 'closed').flatMap(pc => pc.getSenders()).find(x => x.track && x.track.kind === 'audio');
  if (!s) return null;
  const st = s.track.getSettings();
  return { processed: s.track.label === 'MediaStreamAudioDestinationNode', ns: st.noiseSuppression ?? null, label: s.track.label.slice(0, 60), enabled: s.track.enabled, state: s.track.readyState };
})()`;
const sender = () => T.eval(SENDER).catch((e) => ({ err: String(e) }));

const rn = await waitFor(async () => (await sender())?.processed === true, 20000);
const s0 = await sender();
check("auto on strong device → RNNoise track sent", rn.ok, s0);
let f;
await waitFor(async () => hears(f = await flow(S, 3000)), 30000, 100);
check("student hears teacher with RNNoise", hears(f), f);
const energyStrong = f.inAudioEnergy;

async function chooseNoise(optionText) {
  await T.click(byLabel("Выбрать микрофон"));
  await waitFor(() => T.eval(`!!document.querySelector('[aria-label="Шумоподавление"]')`), 8000);
  await shot(T, `ns-1-dialog-${optionText}`);
  await T.click(`document.querySelector('[aria-label="Шумоподавление"]')`);
  await sleep(500);
  await shot(T, `ns-2-open-${optionText}`);
  await waitFor(() => T.eval(`!![...document.querySelectorAll('[role=option]')].find(o => o.innerText.startsWith(${JSON.stringify(optionText)}))`), 5000);
  await T.click(`[...document.querySelectorAll('[role=option]')].find(o => o.innerText.startsWith(${JSON.stringify(optionText)}))`);
  await sleep(300);
  await shot(T, `ns-3-picked-${optionText}`);
  const shown = await T.eval(`document.querySelector('[aria-label="Шумоподавление"]')?.innerText ?? null`);
  mark("select shows", shown);
  await T.click(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Применить')`);
  mark(`noise → ${optionText}`);
}

await chooseNoise("Выключено");
const off = await waitFor(async () => { const s = await sender(); return s?.processed === false && s?.ns === false; }, 10000);
check("«Выключено» → raw mic, browser NS off", off.ok, await sender());
const INB = `(async()=>(await window.__collect()).flatMap(x=>(x.inbound||[]).filter(i=>i.kind==='audio').map(i=>({c:x.conn, id:(i.id||'').slice(-12), ssrc:i.ssrc, b:i.bytesReceived, tid:i.trackIdentifier && i.trackIdentifier.slice(0,8)}))))()`;
for (let i = 0; i < 4; i++) { mark("inbound", await S.eval(INB)); await sleep(1500); }
await waitFor(async () => hears(f = await flow(S, 3000)), 20000, 100);
check("student hears teacher, NS off", hears(f), f);
const energyOff = f.inAudioEnergy;

await chooseNoise("Обычное");
const std = await waitFor(async () => { const s = await sender(); return s?.processed === false && s?.ns === true; }, 10000);
check("«Обычное» → raw mic, browser NS on", std.ok, await sender());

await chooseNoise("Сильное");
const back = await waitFor(async () => (await sender())?.processed === true, 15000);
check("«Сильное» → RNNoise again", back.ok, await sender());
f = await flow(S, 4000);
check("student hears teacher after re-enable", hears(f), f);

// Микрофон выключить/включить — обработка остаётся.
await T.click(byLabel("Микрофон"));
await sleep(1500);
await T.click(byLabel("Включить звук"));
await sleep(2500);
check("mic toggle keeps RNNoise", (await sender())?.processed === true, await sender());
f = await flow(S, 4000);
check("student hears after mic toggle", hears(f), f);

mark("energy", { strong: energyStrong, off: energyOff });
await finish();
