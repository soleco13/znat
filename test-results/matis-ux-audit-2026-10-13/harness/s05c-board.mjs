// Доска: одновременное рисование трёх участников, смена стейджа посреди штриха, отмена своего действия.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, finish, sleep, shot, mark, LID, teacherApi, log, ORIGIN } from "./lib.mjs";
import { boardState, boardElements } from "./ydoc.mjs";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, A = P.s1, B = P.s2;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(A, "Ученик А"));
check("s2 joins", await guestEnter(B, "Ученик Б"));
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "board" });
await teacherApi(T, "POST", `/lessons/${LID}/draw-all`, { canDraw: true });
const boardReady = (p) => waitFor(() => p.eval("!!document.querySelector('.excalidraw canvas.interactive')"), 30000);
for (const p of [T, A, B]) check(`${p.name} board ready`, (await boardReady(p)).ok);
await sleep(2500);
const box = (p) => p.eval("(() => { const c = document.querySelector('.excalidraw canvas.interactive'); const b = c.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; })()");
async function rect(p, k) {
  const b = await box(p);
  // инструмент «прямоугольник» — кнопкой панели, как человек
  await p.click(`[...document.querySelectorAll('.excalidraw [data-testid="toolbar-rectangle"], .excalidraw label[title*="Прямоугольник"]')][0]`);
  await sleep(150);
  const row = { teacher: 0.15, s1: 0.4, s2: 0.65 }[p.name];
  const x = b.x + b.w * (0.15 + k * 0.17), y = b.y + b.h * row;
  await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 12; i++) { await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 6 * i, y: y + 4 * i, button: "left", buttons: 1 }); await sleep(25); }
  await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 72, y: y + 48, button: "left", clickCount: 1 });
  await sleep(300);
}
for (let round = 0; round < 3; round++) {
  mark(`раунд ${round}: одновременно учитель 2, А 3, Б 3`);
  const before = await boardElements(ORIGIN, LID);
  const beforeIds = new Set(before.map((e) => e.id));
  await Promise.all([(async () => { for (let k = 0; k < 2; k++) await rect(T, k); })(), (async () => { for (let k = 0; k < 3; k++) await rect(A, k); })(), (async () => { for (let k = 0; k < 3; k++) await rect(B, k); })()]);
  await sleep(3000);
  const after = await boardElements(ORIGIN, LID);
  const added = after.filter((e) => !beforeIds.has(e.id));
  const removed = before.filter((e) => !after.some((x) => x.id === e.id));
  const rows = (ys) => ys.reduce((a, e) => { const r = e.y < 230 ? "teacher" : e.y < 400 ? "s1" : "s2"; a[r] = (a[r] || 0) + 1; return a; }, {});
  check(`round ${round}: 8 added, none removed`, added.length === 8 && removed.length === 0, { added: added.length, byRow: rows(added), removed: removed.length, posDupes: added.length - new Set(added.map((e) => e.pos)).size });
  log({ kind: "info", text: "added", extra: added });
  for (const p of [T, A, B]) await shot(p, `round${round}`);
}
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "people" });
await finish();
