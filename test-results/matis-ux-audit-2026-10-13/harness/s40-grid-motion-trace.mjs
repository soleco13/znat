// 2026-10-24: покадровый замер перестройки сетки (в странице, requestAnimationFrame)
// и наведение на кнопки панели с эмуляцией мыши (в безголовом Chrome нет
// указателя, и (hover: hover) and (pointer: fine) не выполняется).
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, shot, teacherApi, LID } from "./lib.mjs";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S1 = P.s1, S2 = P.s2;
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
mark("media before", await T.eval(`({ hover: matchMedia('(hover: hover)').matches, fine: matchMedia('(pointer: fine)').matches, motion: matchMedia('(prefers-reduced-motion: no-preference)').matches })`));
await T.send("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "hover" }, { name: "pointer", value: "fine" }, { name: "any-hover", value: "hover" }] });
mark("media after", await T.eval(`({ hover: matchMedia('(hover: hover)').matches, fine: matchMedia('(pointer: fine)').matches })`));
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
await teacherApi(T, "PATCH", `/lessons/${LID}/mode`, { mode: "discussion" });
check("s1 joins", await guestEnter(S1, "Юля Тестова", { cam: true, mic: true }));
await sleep(1500);
// Покадровый трекер: позиция и размер первой ячейки и число ячеек на каждом кадре.
await T.eval(`(() => { window.__tr = []; const t0 = performance.now(); const f = () => { const c = document.querySelectorAll('.grid-cell'); const r = c[0]?.getBoundingClientRect(); window.__tr.push([Math.round(performance.now() - t0), c.length, r ? Math.round(r.x) : null, r ? Math.round(r.y) : null, r ? Math.round(r.width) : null, c[c.length-1] ? +getComputedStyle(c[c.length-1]).opacity : null]); if (window.__tr.length < 3000) requestAnimationFrame(f); }; requestAnimationFrame(f); return true; })()`);
check("s2 joins", await guestEnter(S2, "Елена Тестова", { cam: true, mic: true }));
await sleep(2500);
const tr = await T.eval(`window.__tr`);
const i = tr.findIndex((x, k) => k > 0 && x[1] !== tr[k - 1][1]);
const win = i > 0 ? tr.slice(i - 1, i + 30) : [];
const changes = win.filter((x, k) => k > 0 && (x[2] !== win[k - 1][2] || x[3] !== win[k - 1][3] || x[4] !== win[k - 1][4])).length;
const t0 = win[0]?.[0] ?? 0;
const settle = win.findLast((x, k) => k > 0 && (x[2] !== win[k - 1][2] || x[3] !== win[k - 1][3] || x[4] !== win[k - 1][4]));
mark("frames around 2→3", win.map((x) => [x[0] - t0, x[1], x[2], x[3], x[4], x[5]]));
check("first tile moves through ≥5 frames (smooth)", changes >= 5, { changes });
check("motion settles within ~400 ms", settle ? settle[0] - t0 <= 450 : false, { ms: settle ? settle[0] - t0 : null });
check("new tile fades in (opacity < 1 on some frame)", win.some((x) => x[5] !== null && x[5] < 1));
// Наведение на каждую кнопку панели: у иконки идёт анимация, кнопка на месте.
const BTNS = `[...document.querySelectorAll('.room-ctl')].filter(b => b.getBoundingClientRect().width > 0).map(b => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2, box: [Math.round(r.x), Math.round(r.y)] }; })`;
for (const b of await T.eval(BTNS)) {
  await T.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y });
  await sleep(100);
  const st = await T.eval(`(() => { const btn = [...document.querySelectorAll('.room-ctl')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(b.label)}); const i = btn.querySelector('[data-icon-motion]'); const r = btn.getBoundingClientRect(); return { motion: i?.dataset.iconMotion, anim: i ? getComputedStyle(i).animationName : null, transform: i ? getComputedStyle(i).transform : null, box: [Math.round(r.x), Math.round(r.y)], bg: getComputedStyle(btn).backgroundColor }; })()`);
  mark(`hover ${b.label}`, st);
  check(`hover «${b.label}»: icon animates (${st.motion})`, st.anim && st.anim !== "none", st);
  check(`hover «${b.label}»: button stays`, st.box[0] === b.box[0] && st.box[1] === b.box[1]);
  if (b.label === "Микрофон") await shot(T, "hover-mic");
  await T.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 300 });
  await sleep(500);
}
await finish();
