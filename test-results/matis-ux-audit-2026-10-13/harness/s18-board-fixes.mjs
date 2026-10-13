// Регрессия: R-01 (битые записи не роняют доску), R-02 (уникальные ключи), UX-04 (отмена после смены стейджа).
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, finish, sleep, shot, mark, LID, teacherApi, log, ORIGIN } from "./lib.mjs";
import { boardElements, injectCorrupt } from "./ydoc.mjs";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, A = P.s1, B = P.s2;
const errs = [];
for (const p of [T]) {}
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(A, "Ученик А"));
check("s2 joins", await guestEnter(B, "Ученик Б"));
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "board" });
await teacherApi(T, "POST", `/lessons/${LID}/draw-all`, { canDraw: true });
const boardReady = (p) => waitFor(() => p.eval("!!document.querySelector('.excalidraw canvas.interactive')"), 30000);
for (const p of [T, A, B]) await boardReady(p);
await sleep(2000);
const box = (p) => p.eval("(() => { const c = document.querySelector('.excalidraw canvas.interactive'); const b = c.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; })()");
async function rect(p, k) {
  const b = await box(p);
  await p.click(`[...document.querySelectorAll('.excalidraw [data-testid="toolbar-rectangle"]')][0]`);
  await sleep(150);
  const row = { teacher: 0.15, s1: 0.4, s2: 0.65 }[p.name];
  const x = b.x + b.w * (0.15 + k * 0.17), y = b.y + b.h * row;
  await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 12; i++) { await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 6 * i, y: y + 4 * i, button: "left", buttons: 1 }); await sleep(25); }
  await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 72, y: y + 48, button: "left", clickCount: 1 });
  await sleep(300);
}
const crashed = (p) => p.eval(`/Что-то пошло не так|invalid order key|Произошла ошибка/.test(document.body.innerText) || !document.querySelector('.excalidraw')`);

mark("R-01: в доску вписаны битые записи (неверный pos, без id, без элемента, не объект)");
await injectCorrupt(ORIGIN, LID);
await sleep(2500);
for (const p of [T, A, B]) check(`R-01: ${p.name} board alive after corrupt entries`, !(await crashed(p)));
const n0 = (await boardElements(ORIGIN, LID)).length;
await rect(A, 0); await rect(T, 0);
await sleep(2500);
const n1 = (await boardElements(ORIGIN, LID)).length;
for (const p of [T, A, B]) check(`R-01: ${p.name} board still alive after drawing`, !(await crashed(p)));
check("R-01: drawing after corruption saved", n1 >= n0 + 2, { n0, n1 });
for (const p of [T, A, B]) await shot(p, "r01");

mark("R-02: одновременно 8 фигур — ключи уникальны");
const before = new Set((await boardElements(ORIGIN, LID)).map((e) => e.id));
await Promise.all([(async () => { for (let k = 1; k < 3; k++) await rect(T, k); })(), (async () => { for (let k = 1; k < 4; k++) await rect(A, k); })(), (async () => { for (let k = 1; k < 4; k++) await rect(B, k); })()]);
await sleep(3000);
const added = (await boardElements(ORIGIN, LID)).filter((e) => !before.has(e.id));
check("R-02: 8 added", added.length === 8, added.length);
check("R-02: all order keys unique", new Set(added.map((e) => e.pos)).size === added.length, added.map((e) => e.pos));

mark("UX-04: А рисует, учитель переключает экран туда-обратно, А жмёт «Отменить»");
const u0 = (await boardElements(ORIGIN, LID)).length;
await rect(A, 0);
await sleep(1500);
const u1 = (await boardElements(ORIGIN, LID)).length;
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "people" });
await sleep(2500);
check("UX-04: board hidden for A", await A.eval("!document.querySelector('.excalidraw')"));
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "board" });
await boardReady(A); await sleep(2000);
await A.click(`[...document.querySelectorAll('button[aria-label]')].find(b => b.getBoundingClientRect().width > 0 && b.getAttribute('aria-label') === 'Отменить')`);
await sleep(2000);
const u2 = (await boardElements(ORIGIN, LID)).length;
check("UX-04: undo after stage round-trip removes A's last shape", u1 === u0 + 1 && u2 === u0, { u0, u1, u2 });
await teacherApi(T, "PATCH", `/lessons/${LID}/stage`, { stage: "people" });
await finish();
