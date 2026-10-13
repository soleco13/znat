// Доска: одновременное рисование трёх участников, смена стейджа посреди штриха, отмена своего действия.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, finish, sleep, shot, mark, LID, teacherApi, log, ORIGIN } from "./lib.mjs";
import { boardState } from "./ydoc.mjs";
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
const s0 = await boardState(ORIGIN, LID);
log({ kind: "info", text: "board before", extra: s0 });

mark("1b. по очереди: учитель 2, А 3, Б 3");
for (const [p, n] of [[T, 2], [A, 3], [B, 3]]) {
  const before = (await boardState(ORIGIN, LID)).live;
  for (let k = 0; k < n; k++) await rect(p, k);
  await sleep(2000);
  const after = (await boardState(ORIGIN, LID)).live;
  check(`${p.name}: sequential ${n} shapes saved`, after - before === n, { before, after });
}
mark("1c. одновременно ещё раз (после очереди)");
const c0 = (await boardState(ORIGIN, LID)).live;
await Promise.all([(async () => { for (let k = 0; k < 2; k++) await rect(T, k + 3); })(), (async () => { for (let k = 0; k < 3; k++) await rect(A, k + 3); })(), (async () => { for (let k = 0; k < 3; k++) await rect(B, k + 3); })()]);
await sleep(3000);
const c1 = (await boardState(ORIGIN, LID)).live;
check("concurrent 8 shapes saved", c1 - c0 === 8, { c0, c1 });
mark("3b. А рисует и сразу отменяет кнопкой «Отменить»");
const u0 = (await boardState(ORIGIN, LID)).live;
await rect(A, 0);
await sleep(1500);
const u1 = (await boardState(ORIGIN, LID)).live;
await A.click(`[...document.querySelectorAll('button[aria-label]')].find(b => b.getBoundingClientRect().width > 0 && b.getAttribute('aria-label') === 'Отменить')`);
await sleep(2000);
const u2 = (await boardState(ORIGIN, LID)).live;
check("undo right after drawing removes it", u1 === u0 + 1 && u2 === u0, { u0, u1, u2 });
for (const p of [T, A, B]) await shot(p, "board-b");
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "people" });
await finish();
