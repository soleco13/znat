// 2026-10-20: двойной микрофон (урок Юли, iPhone). Вход с выключенным микрофоном
// запускает «прогрев» — заглушённую дорожку в фоне; нажатие «Включить звук» в эти
// же доли секунды публиковало вторую. Кнопка показывала «выключен», а звук шёл;
// после включения — два голоса. Проверяем: при любом моменте нажатия у ученика
// одна звуковая дорожка, кнопка и звук совпадают.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, waitFor, mark, byLabel } from "./lib.mjs";

await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T));
await resetLesson(T);

const SENDERS = `(() => {
  const s = window.__pcs.filter(pc => pc.connectionState !== 'closed').flatMap(pc => pc.getSenders())
    .filter(x => x.track && x.track.kind === 'audio' && x.track.readyState === 'live');
  return { audioSenders: s.length, enabled: s.filter(x => x.track.enabled).length,
    button: document.querySelector('[aria-label="Микрофон"]') ? 'on' : document.querySelector('[aria-label="Включить звук"]') ? 'off' : null };
})()`;

const DELAYS = [0, 0, 0, 30, 60, 100, 250, 400, 700, 1200];
let bad = 0;
for (const delay of DELAYS) {
  const ok = await guestEnter(S, "Юля Тестова", { cam: true, mic: false });
  if (!ok) { check(`enter (delay ${delay})`, false); continue; }
  await waitFor(() => S.eval(`!!document.querySelector('[aria-label="Включить звук"]')`), 10000, 20);
  if (delay) await sleep(delay);
  await S.click(byLabel("Включить звук"));
  await sleep(4000);
  const st = await S.eval(SENDERS);
  mark(`delay ${delay}`, st);
  const good = st.audioSenders === 1 && st.enabled === 1 && st.button === "on";
  if (!good) bad++;
  check(`one live mic after click at +${delay} ms`, good, st);
}
check("no double mic in any attempt", bad === 0, { bad });
await finish();
