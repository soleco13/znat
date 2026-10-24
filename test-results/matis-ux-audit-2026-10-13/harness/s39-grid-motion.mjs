// 2026-10-24: сетка камер как у Толка — ряды по центру (трое — 2 + 1, а не «Г»),
// плавная перестройка, отклик иконок панели на наведение. Учитель 1440×900;
// участники добавляются по одному (run-grid-motion.sh запускает синтетических).
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, shot, teacherApi, LID, byLabel } from "./lib.mjs";

await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S1 = P.s1, S2 = P.s2;
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
await teacherApi(T, "PATCH", `/lessons/${LID}/mode`, { mode: "discussion" });

const CELLS = `(() => {
  const host = document.querySelector('.grid-cell')?.parentElement;
  if (!host) return null;
  const h = host.getBoundingClientRect();
  return { w: Math.round(h.width), h: Math.round(h.height), cells: [...host.querySelectorAll(':scope > .grid-cell')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x - h.x), Math.round(r.y - h.y), Math.round(r.width), Math.round(r.height)]; }) };
})()`;
// Ряды по центру: у каждого ряда отступ слева = справа (±2 px), сетка по центру по высоте.
function symmetric(g) {
  if (!g || !g.cells.length) return false;
  const rows = new Map();
  for (const [x, y, w, h] of g.cells) { const r = rows.get(y) ?? []; r.push([x, w, h]); rows.set(y, r); }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const top = ys[0], last = ys[ys.length - 1] + g.cells.find((c) => c[1] === ys[ys.length - 1])[3];
  if (Math.abs(top - (g.h - last)) > 2) return false;
  const counts = ys.map((y) => rows.get(y).length);
  if (Math.max(...counts) - Math.min(...counts) > 1) return false;
  return ys.every((y) => { const r = rows.get(y); const l = Math.min(...r.map((c) => c[0])); const rr = Math.max(...r.map((c) => c[0] + c[1])); return Math.abs(l - (g.w - rr)) <= 2; });
}
const seen = new Set();
async function snap() {
  const g = await T.eval(CELLS).catch(() => null);
  const n = g?.cells.length ?? 0;
  if (!n || seen.has(n)) return;
  await sleep(700);
  const g2 = await T.eval(CELLS);
  if ((g2?.cells.length ?? 0) !== n) return;
  seen.add(n);
  const rowsDesc = Object.values(g2.cells.reduce((a, c) => ((a[c[1]] = (a[c[1]] ?? 0) + 1), a), {})).join("+");
  mark(`grid ${n}`, { rows: rowsDesc, cells: g2.cells });
  check(`${n} participants: rows centered (${rowsDesc})`, symmetric(g2), g2);
  await shot(T, `grid-${n}`);
}
// Плавность: положение первой плитки каждые 40 мс во время перестройки.
async function trace(label) {
  const pts = [];
  for (let i = 0; i < 25; i++) { const g = await T.eval(CELLS).catch(() => null); if (g?.cells[0]) pts.push(g.cells[0].slice(0, 3)); await sleep(40); }
  const distinct = new Set(pts.map((p) => p.join(","))).size;
  mark(`motion ${label}`, { distinct, pts });
  return distinct;
}

await snap();
check("s1 joins", await guestEnter(S1, "Юля Тестова", { cam: true, mic: true }));
await snap();
const joining = guestEnter(S2, "Елена Тестова", { cam: true, mic: true });
await sleep(1500);
const steps = await trace("2→3");
check("s2 joins", await joining);
check("tiles glide (≥4 intermediate positions)", steps >= 4, { steps });
await snap();

// Наведение на микрофон: иконка анимируется, кнопка не двигается.
const HOVER = `(() => { const b = document.querySelector('.room-ctl[aria-label="Микрофон"], .room-ctl[aria-label="Включить звук"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, box: [Math.round(r.x), Math.round(r.y)] }; })()`;
const hb = await T.eval(HOVER);
if (hb) {
  await T.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hb.x, y: hb.y });
  await sleep(120);
  const st = await T.eval(`(() => { const i = document.querySelector('.room-ctl[aria-label="Микрофон"] [data-icon-motion], .room-ctl[aria-label="Включить звук"] [data-icon-motion]'); const b = i.closest('.room-ctl').getBoundingClientRect(); return { motion: i.dataset.iconMotion, anim: getComputedStyle(i).animationName, box: [Math.round(b.x), Math.round(b.y)] }; })()`);
  mark("hover mic", st);
  await shot(T, "hover-mic");
  check("mic icon animates on hover", st.anim && st.anim !== "none", st);
  check("button itself does not move on hover", st.box[0] === hb.box[0] && st.box[1] === hb.box[1], { before: hb.box, after: st.box });
  await T.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
} else check("mic button found", false);

fs.writeFileSync("/w/ctl/start-shape", String(Date.now()));
mark("синтетические ученики по одному");
const until = Date.now() + Number(process.env.GROW_MS || 75000);
let traced = false;
while (Date.now() < until) {
  const before = (await T.eval(CELLS).catch(() => null))?.cells.length ?? 0;
  await sleep(150);
  const now = (await T.eval(CELLS).catch(() => null))?.cells.length ?? 0;
  if (now !== before && !traced && now >= 5) { traced = true; check("tiles glide on later join", (await trace(`${before}→${now}`)) >= 4); }
  await snap();
}
await finish();
