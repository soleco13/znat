// 2026-10-17: на слабом устройстве «Сильное» недоступно, «Авто» = встроенное или выключено.
import { resetLesson, openBrowsers, P, teacherJoin, check, finish, sleep, waitFor, mark, byLabel } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
check("teacher joins", await teacherJoin(T));
await sleep(4000);
const s = await T.eval(`(() => { const s = window.__pcs.flatMap(pc => pc.getSenders()).find(x => x.track && x.track.kind === 'audio'); return s ? { label: s.track.label, ns: s.track.getSettings().noiseSuppression } : null; })()`);
mark("sender", s);
check("no RNNoise on weak device", s && s.label !== "MediaStreamAudioDestinationNode", s);
await T.click(byLabel("Выбрать микрофон"));
await waitFor(() => T.eval(`!!document.querySelector('[aria-label="Шумоподавление"]')`), 8000);
await T.click(`document.querySelector('[aria-label="Шумоподавление"]')`);
await waitFor(() => T.eval(`document.querySelectorAll('[role=option]').length > 0`), 20000);
const opts = await T.eval(`[...document.querySelectorAll('[role=option]')].map(o => ({ t: o.innerText, dis: o.hasAttribute('data-disabled') }))`);
mark("options", opts);
check("«Сильное» disabled with hint", opts.some((o) => o.dis && /недоступно/.test(o.t)), opts);
await finish();
