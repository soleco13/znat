// 2026-10-17: до 5 вкладок с одного аккаунта персонала; шестая — отказ.
import { resetLesson, openBrowsers, secondTab, P, teacherJoin, guestEnter, passDeviceCheck, check, finish, sleep, waitFor, ORIGIN, LID, inRoom, ui, mark } from "./lib.mjs";

await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("tab1 joins", await teacherJoin(T));
await resetLesson(T);
check("student joins", await guestEnter(S, "Ника Тестова", { cam: false, mic: false }));

const openTab = async (name, opts = { cam: false, mic: false }) => {
  const t = await secondTab(T, name);
  await t.goto(`${ORIGIN}/lessons/${LID}/room`);
  return { t, ok: await passDeviceCheck(t, opts) };
};
const t2 = await openTab("teacher-2", { cam: true, mic: false });
check("tab2 joins", t2.ok);
await sleep(4000);
check("tab1 not taken over", (await inRoom(T)) && !(await ui(T)).takenOver, await ui(T));

const tiles = (p) => p.eval(`document.body.innerText`);
const sText = await tiles(S);
check("student sees «Тимур (2)» tile", /Тимур \(2\)|Тимур Учителев \(2\)/.test(sText), sText.match(/Тимур[^\n]{0,20}/g));
const count = await S.eval(`(document.body.innerText.match(/(\\d+) участник/) || [])[1]`);
check("participant count counts teacher once (2)", count === "2", count);

const extra = [];
for (const n of [3, 4, 5]) {
  const r = await openTab(`teacher-${n}`);
  extra.push(r.t);
  check(`tab${n} joins`, r.ok);
}
const t6 = await secondTab(T, "teacher-6");
await t6.goto(`${ORIGIN}/lessons/${LID}/room`);
await waitFor(() => t6.eval(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('Присоединиться'))`), 30000);
await sleep(1200);
await t6.click(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('Присоединиться'))`);
const refused = await waitFor(() => t6.eval(`document.body.innerText.includes('Урок уже открыт на других устройствах')`), 20000);
check("tab6 refused with message", refused.ok, (await t6.eval("document.body.innerText")).slice(0, 200));

// Закрыть вкладки 3–5 кнопкой «Выйти» — остальные остаются.
for (const t of extra) {
  await t.click(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Выйти')`);
  await sleep(800);
  await t.click(`[...document.querySelectorAll('[role=alertdialog] button')].find(b => /Выйти/.test(b.innerText))`).catch(() => {});
}
await sleep(5000);
check("tab1 still in room", await inRoom(T));
check("tab2 still in room", await inRoom(t2.t));
const sAfter = await tiles(S);
check("student still sees teacher", /Тимур/.test(sAfter));
const att = await S.eval(`(document.body.innerText.match(/(\\d+) участник/) || [])[1]`);
check("count still 2", att === "2", att);

// F5 во второй вкладке — снова «(2)», первая не выбита.
await t2.t.eval("location.reload()").catch(() => {});
await sleep(3000);
await passDeviceCheck(t2.t, { cam: true, mic: false }).catch(() => false);
await sleep(5000);
check("tab2 back after F5", await inRoom(t2.t));
check("tab1 not kicked by F5 of tab2", (await inRoom(T)) && !(await ui(T)).takenOver);
const sF5 = await tiles(S);
check("still one «(2)» tile after F5", (sF5.match(/Тимур \(2\)|Тимур Учителев \(2\)/g) || []).length === 1, sF5.match(/Тимур[^\n]{0,20}/g));
await finish();
