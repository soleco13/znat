// 1) Медленная сеть (3G / BAD_3G): сколько ждёт ученик до формы, до урока, до задания.
// 2) Телефон 360×740: кнопки достижимы, нет горизонтальной прокрутки, «Ещё» работает.
// 3) Клавиатура: горячие клавиши, Tab доходит до кнопок, у иконок есть подписи.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, mark, LID, profile, clearNet, ORIGIN, JOIN, inRoom, byText, ctlState, MIC, log, passDeviceCheck } from "./lib.mjs";
const MAT = "78fb5acf-eb79-428c-8830-878400353fe0";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S = P.s1, M = P.s2;
await teacherJoin(T); await resetLesson(T);

for (const prof of ["3G", "BAD_3G"]) {
  mark(`1. ${prof}: путь ученика`);
  await S.send("Network.clearBrowserCache").catch(() => {});
  await profile("s1", prof);
  const t0 = Date.now();
  await S.goto(`${ORIGIN}${JOIN}`);
  const form = await waitFor(() => S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]') || !!${byText("button", "Присоединиться")}`), 120000, 300);
  const tForm = Date.now() - t0;
  const ok = await guestEnter(S, `Ученик ${prof}`);
  const tRoom = Date.now() - t0;
  check(`${prof}: student reaches room`, ok, { tFormMs: tForm, tRoomMs: tRoom });
  const ta = Date.now();
  await T.eval(`(async () => { const r = await fetch("/api/v1/auth/refresh", {method:"POST",credentials:"include"}).then(r=>r.json()); await fetch("/api/v1/lessons/${LID}/activities", {method:"POST", headers:{"content-type":"application/json", authorization:"Bearer "+r.accessToken}, body: JSON.stringify({materialId:"${MAT}"})}); })()`);
  const act = await waitFor(() => S.eval(`document.body.innerText.includes('Все типы заданий на одном уроке')`), 120000, 300);
  const loadingShown = await S.eval(`document.body.innerText.includes('Загрузка задания') || document.body.innerText.includes('Загружаем задание')`);
  check(`${prof}: activity opens`, act.ok, { ms: Date.now() - ta });
  log({ kind: "info", text: `${prof} timings`, extra: { tFormMs: tForm, tRoomMs: tRoom, activityMs: Date.now() - ta, loadingShown } });
  const res = await S.eval(`performance.getEntriesByType('resource').filter(e => e.transferSize > 0).reduce((a, e) => a + e.transferSize, 0)`);
  log({ kind: "info", text: `${prof} bytes transferred`, extra: { kb: Math.round(res / 1024) } });
  await shot(S, `slow-${prof}`);
  await clearNet("s1");
  await S.goto("about:blank");
}

mark("2. телефон 360×740");
await M.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
await M.send("Emulation.setTouchEmulationEnabled", { enabled: true });
check("phone: joins", await guestEnter(M, "Ученик Телефон"));
await sleep(3000);
const overflow = await M.eval(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
check("phone: no horizontal scroll", overflow.sw <= overflow.cw + 1, overflow);
const footerBtns = await M.eval(`[...document.querySelectorAll('footer button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.bottom <= innerHeight && r.right <= innerWidth; }).map(b => ({ l: b.getAttribute('aria-label'), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }))`);
check("phone: footer buttons visible and ≥44px", footerBtns.length >= 3 && footerBtns.every((b) => b.w >= 44 && b.h >= 44), footerBtns);
await M.click(`document.querySelector('button[aria-label="Другие кнопки урока"]')`);
await sleep(800);
const menu = await M.eval(`[...document.querySelectorAll('[role=menuitem]')].map(e => e.textContent.trim())`);
check("phone: 'more' menu lists hand/chat", menu.some((t) => /руку/.test(t)) && menu.some((t) => /Чат/.test(t)), menu);
await M.click(`[...document.querySelectorAll('[role=menuitem]')].find(e => /Чат/.test(e.textContent))`);
await sleep(1000);
check("phone: chat opens from menu", await M.eval(`!!document.querySelector('[aria-label="Сообщение классу"]')`));
await shot(M, "phone-chat");
await M.key("Escape", "Escape", 27); await sleep(600);
await shot(M, "phone");

mark("3. клавиатура и подписи");
const unlabeled = await T.eval(`[...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0 && !b.getAttribute('aria-label') && !b.textContent.trim()).map(b => b.outerHTML.slice(0, 120))`);
check("teacher: every visible icon button has an accessible name", unlabeled.length === 0, unlabeled.slice(0, 5));
const micBefore = await ctlState(T, MIC);
await T.click("document.body");
await T.key("m", "KeyM", 77); await sleep(1500);
check("hotkey M toggles mic", (await ctlState(T, MIC)) === !micBefore, { before: micBefore, after: await ctlState(T, MIC) });
await T.key("m", "KeyM", 77); await sleep(1000);
const tabStops = [];
for (let i = 0; i < 25; i++) { await T.key("Tab", "Tab", 9); tabStops.push(await T.eval(`(() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20) || e.tagName) : null; })()`)); }
check("Tab reaches mic/camera/leave", ["Микрофон", "Камера", "Выйти"].every((l) => tabStops.some((s) => s && s.includes(l))), tabStops);
const focusVisible = await T.eval(`(() => { const e = document.activeElement; const s = getComputedStyle(e); return s.outlineStyle !== 'none' || s.boxShadow !== 'none'; })()`);
check("focused element has visible focus ring", focusVisible);
await finish();
