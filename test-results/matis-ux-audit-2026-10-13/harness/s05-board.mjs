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

mark("1. одновременно: учитель 2, А 3, Б 3 прямоугольника");
await Promise.all([
  (async () => { for (let k = 0; k < 2; k++) await rect(T, k); })(),
  (async () => { for (let k = 0; k < 3; k++) await rect(A, k); })(),
  (async () => { for (let k = 0; k < 3; k++) await rect(B, k + 4); })(),
]);
await sleep(4000);
const s1 = await boardState(ORIGIN, LID);
const big = (st) => st.live;
check("all 8 concurrent shapes saved on server", s1.live - s0.live === 8, { before: s0, after: s1 });
for (const p of [T, A, B]) await shot(p, "board-concurrent");

mark("2. учитель переключает стейдж, пока А тянет прямоугольник");
const b = await box(A);
await A.key("r", "KeyR", 82);
await A.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x + 300, y: b.y + 300 });
await A.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x + 300, y: b.y + 300, button: "left", clickCount: 1 });
await A.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x + 350, y: b.y + 340, button: "left", buttons: 1 });
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "people" });
await sleep(1500);
await A.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x + 360, y: b.y + 350, button: "left", clickCount: 1 }).catch(() => {});
await sleep(1500);
const aBoardGone = await A.eval("!document.querySelector('.excalidraw')");
check("student A's board closed by teacher stage switch", aBoardGone);
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "board" });
await boardReady(A); await sleep(2500);
const s2 = await boardState(ORIGIN, LID);
check("board content intact after stage round-trip", s2.live >= s1.live, { s1: s1.live, s2: s2.live });
log({ kind: "info", text: "half-drawn shape kept?", extra: { delta: s2.live - s1.live } });

mark("3. А отменяет своё последнее действие (Ctrl+Z)");
log({ kind: "info", text: "board buttons", extra: await A.eval(`[...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => /Отмен|Undo|Вернуть|Redo/i.test(l))`) });
await A.click(`[...document.querySelectorAll('button[aria-label]')].find(b => b.getBoundingClientRect().width > 0 && /^(Отменить|Undo)$/i.test(b.getAttribute('aria-label')))`);
await sleep(2500);
const s3 = await boardState(ORIGIN, LID);
check("undo removes exactly one element (own), others intact", s3.live === s2.live - 1, { s2: s2.live, s3: s3.live, types: s3.types });
for (const p of [T, A, B]) await shot(p, "board-after-undo");
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "people" });
await finish();
