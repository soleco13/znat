// Функциональная проверка оптимизаций (2026-10-05): порядок загрузки на входе
// ученика, pdf.js по требованию (импорт PDF, перезагрузка), mathlive по
// требованию (правка формулы, автосохранение, повторное открытие).
import { connectBrowser, sleep, byText } from "./cdp.mjs";

const ORIGIN = "https://213.21.241.28";
const { LID, JOIN_PATH, T_EMAIL, T_PW, M_EMAIL, M_PW, DECK_TITLE = "perf-test" } = process.env;
const B = await connectBrowser(process.env.CDP);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail ? JSON.stringify(detail) : ""); };
const waitFor = async (fn, ms, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - t0, v }; } catch {} await sleep(step); } return { ok: false, ms: Date.now() - t0 }; };

async function api(method, path, body, token) {
  const r = await fetch(ORIGIN + "/api/v1" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), cookie: r.headers.get("set-cookie") };
}

async function fresh() {
  const { browserContextId } = await B.call("Target.createBrowserContext", {});
  const { targetId } = await B.call("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await B.call("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p, t) => B.call(m, p, sessionId, t);
  const reqs = []; const ws = []; const errors = [];
  B.listeners.set(sessionId, (m, p) => {
    if (m === "Network.requestWillBeSent") reqs.push({ url: p.request.url, t: Date.now(), method: p.request.method });
    if (m === "Network.responseReceived") { const r = reqs.findLast((x) => x.url === p.response.url); if (r) r.status = p.response.status; }
    if (m === "Network.webSocketCreated") ws.push({ url: p.url, t: Date.now() });
    if (m === "Runtime.exceptionThrown") errors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || "").slice(0, 200));
  });
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setBypassServiceWorker", { bypass: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  const page = {
    send, reqs, ws, errors, browserContextId,
    async eval(e, t = 30000) { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, t); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; },
    async click(expr) { const pt = await page.eval(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return b.width ? { x: b.x + b.width/2, y: b.y + b.height/2 } : null; })()`); if (!pt) return false; for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 }); return true; },
    async type(t) { await send("Input.insertText", { text: t }); },
    goto: (url) => send("Page.navigate", { url }),
    asset: (re) => reqs.filter((r) => /\/assets\//.test(r.url) && re.test(r.url.split("/").pop())),
  };
  return page;
}
async function setRefresh(p, cookie) { const v = cookie.match(/refresh_token=([^;]+)/)[1]; await p.send("Network.setCookie", { name: "refresh_token", value: v, url: ORIGIN + "/api/v1/auth", path: "/api/v1/auth", secure: true, httpOnly: true, sameSite: "Lax" }); }
const inRoom = (p) => p.eval(`!![...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === 'Чат')`);
// После F5 урок восстанавливается сам (rejoin) — экрана проверки устройств может не быть.
async function backInRoom(p) { const r = await waitFor(async () => (await inRoom(p)) || (await p.eval(`!!${byText("button", "Присоединиться")}`)), 60000); if (!r.ok) return false; if (await inRoom(p)) return true; return passDeviceCheck(p); }
async function passDeviceCheck(p) { const r = await waitFor(() => p.eval(`!!${byText("button", "Присоединиться")}`), 60000); if (!r.ok) return false; await sleep(800); await p.click(byText("button", "Присоединиться")); return (await waitFor(() => inRoom(p), 60000)).ok; }
const boardBtn = `[...document.querySelectorAll('button')].find(e => e.getBoundingClientRect().width > 0 && ((e.getAttribute('aria-label')||'') === 'Доска' || (e.textContent||'').trim() === 'Доска'))`;
const boardMore = `[...document.querySelectorAll('button[aria-label="Ещё"]')].filter(e => e.getBoundingClientRect().width > 0).find(e => e.closest('.canvas-board, [class*="board"]') || e.parentElement?.parentElement?.querySelector('[aria-label="Повторить"]'))`;
async function openBoardMenu(p) {
  // Лента миниатюр слайдов на 1366×768 перекрывает панель доски — открываем меню с клавиатуры.
  await p.eval(`[...document.querySelectorAll('button[aria-label="Ещё"]')].find(e => e.getBoundingClientRect().y < 400)?.focus()`);
  for (const type of ["keyDown", "keyUp"]) await p.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  return (await waitFor(() => p.eval(`!!${deckItem}`), 5000)).ok;
}
const deckItem = `[...document.querySelectorAll('[role="menuitem"]')].find(e => (e.textContent||'').includes(${JSON.stringify(DECK_TITLE)}))`;
const pdfImg = `[...document.querySelectorAll('img')].filter(i => (i.getAttribute('src')||'').startsWith('data:image/png') && i.naturalWidth > 0).length`;
const LESSON_STAGE = /^(Board|ActivityStage|LessonActivityPanel|textarea)-/;

const lg = await api("POST", "/auth/login", { email: T_EMAIL, password: T_PW });
const T = await fresh(); await setRefresh(T, lg.cookie);
try {
  // ── 1. Учитель в уроке: доска докачивается только после подключения медиа ──
  await T.goto(`${ORIGIN}/lessons/${LID}/room`);
  check("teacher: in room", await passDeviceCheck(T));
  const tJoin = Date.now();
  const tb = await waitFor(() => T.asset(/^Board-/).length > 0, 30000);
  const lkWs = T.ws.find((w) => /\/livekit\/rtc/.test(w.url));
  check("teacher: board prefetched after LiveKit signalling opened", tb.ok && lkWs && T.asset(/^Board-/)[0].t >= lkWs.t, { boardAfterJoinMs: tb.ms, lkWsBeforeBoardMs: lkWs ? T.asset(/^Board-/)[0]?.t - lkWs.t : null });
  check("teacher: pdf.js not loaded with room/board prefetch", T.asset(/^pdf-/).length === 0);

  // ── 2. Ученик: до «Войти» ничего от доски/заданий ──
  const S = await fresh();
  await S.goto(ORIGIN + JOIN_PATH);
  await waitFor(() => S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 30000);
  await waitFor(() => S.asset(/^useRoomSocket-/).length > 0, 30000);
  await sleep(5000);
  const early = S.reqs.filter((r) => /\/assets\//.test(r.url) && LESSON_STAGE.test(r.url.split("/").pop()));
  check("student: no board/activity chunks before «Войти»", early.length === 0, { early: early.map((r) => r.url.split("/").pop()) });
  check("student: room core (RoomPage + LiveKit) prefetched on entry page", S.asset(/^RoomPage-/).length > 0 && S.asset(/^useRoomSocket-/).length > 0);
  await S.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await S.type("Verify Ученик");
  await S.click(`document.querySelector('[role=checkbox]')`); await sleep(300);
  await S.click(`document.querySelector('button[type=submit]')`);
  check("student: in room", await passDeviceCheck(S));
  const sb = await waitFor(() => S.asset(/^Board-/).length > 0 && S.asset(/^ActivityStage-/).length > 0, 30000);
  const sWs = S.ws.find((w) => /\/livekit\/rtc/.test(w.url));
  check("student: board+activities prefetched after LiveKit opened", sb.ok && sWs && S.asset(/^Board-/)[0].t >= sWs.t, { afterLkMs: sWs ? S.asset(/^Board-/)[0]?.t - sWs.t : null });
  check("student: no page errors", S.errors.length === 0, S.errors);
  await B.call("Target.disposeBrowserContext", { browserContextId: S.browserContextId });

  // ── 3. PDF: импорт на доску, рендер, перезагрузка, повторный рендер ──
  await T.click(boardBtn);
  check("teacher: board shown", (await waitFor(() => T.eval(`!!document.querySelector('.excalidraw canvas')`), 30000)).ok);
  await sleep(1500);
  check("board open: pdf.js still not loaded", T.asset(/^pdf-/).length === 0);
  const item = await openBoardMenu(T);
  check("deck import menu item present", item);
  const tImport = Date.now();
  await T.click(deckItem);
  const rendered = await waitFor(() => T.eval(pdfImg).then((n) => n > 0), 30000);
  check("PDF page rendered after import", rendered.ok, { ms: rendered.ms });
  const pdfReq = T.asset(/^pdf-/);
  check("pdf.js loaded only on import", pdfReq.length > 0 && pdfReq[0].t >= tImport, { files: pdfReq.map((r) => r.url.split("/").pop()), worker: T.asset(/^pdf\.worker/).length });
  // перезагрузка: страницы PDF уже на доске → pdf.js грузится заново по требованию
  T.reqs.length = 0;
  await T.send("Page.reload", { ignoreCache: false });
  check("teacher: back in room after reload", await backInRoom(T));
  const again = await waitFor(() => T.eval(pdfImg).then((n) => n > 0), 40000);
  check("PDF page rendered again after reload", again.ok, { ms: again.ms, pdfFetched: T.asset(/^pdf-/).length });
  // убрать слайды колоды с доски (тот же пункт меню) и вернуть «Люди»
  await waitFor(() => T.eval(`!!document.querySelector('.excalidraw canvas')`), 30000);
  await openBoardMenu(T); await T.click(deckItem);
  const gone = await waitFor(() => T.eval(pdfImg).then((n) => n === 0), 10000);
  check("deck pages removed from board (cleanup)", gone.ok);
  await T.click(boardBtn);
  check("board hidden again (cleanup)", (await waitFor(() => T.eval(`!document.querySelector('.excalidraw canvas')`), 10000)).ok);
  check("teacher: no page errors", T.errors.length === 0, T.errors);
} catch (e) { check("exception", false, String(e)); }
await B.call("Target.disposeBrowserContext", { browserContextId: T.browserContextId }).catch(() => {});

// ── 4. Формула: mathlive только при правке, автосохранение, повторное открытие ──
let matId = null;
try {
  const ml = await api("POST", "/auth/login", { email: M_EMAIL, password: M_PW });
  const tok = ml.json.accessToken;
  const id = () => crypto.randomUUID();
  const created = await api("POST", "/materials", {
    id: id(), schemaVersion: 1, title: "PERF-VERIFY формула (временный)", subject: "Проверка", grades: [7], topic: "temp", tags: ["perf-verify"],
    settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 1, layout: "scroll" },
    blocks: [{ type: "rich_text", id: id(), html: "<p>Временный материал проверки</p>" }, { type: "formula", id: id(), latex: "x^2" }], groups: [],
  }, tok);
  matId = created.json?.materialId;
  check("temp material created", created.status === 201, { status: created.status, matId, err: created.status !== 201 ? created.json : undefined });
  const M = await fresh(); await setRefresh(M, ml.cookie);
  await M.goto(`${ORIGIN}/materials/edit/${matId}`);
  check("editor opened", (await waitFor(() => M.eval(`!!document.querySelector('.katex')`), 30000)).ok);
  await sleep(2000);
  check("editor: mathlive not loaded on open", M.asset(/^FormulaEditor-/).length === 0, { editorChunks: M.asset(/^MaterialEditorPage-/).length });
  const editBtn = `[...document.querySelectorAll('button[aria-label="Изменить формулу"]')][0]`;
  await M.click(editBtn);
  const field = await waitFor(() => M.eval(`!!document.querySelector('math-field')`), 30000);
  check("formula editor (mathlive) appears on edit", field.ok && M.asset(/^FormulaEditor-/).length > 0, { ms: field.ms });
  await sleep(500); await M.click(`document.querySelector('math-field')`); await sleep(300);
  // <math-field> — веб-компонент: Input.insertText до него не доходит, нужны настоящие нажатия.
  for (const k of ["+", "1"]) { await M.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k }); await M.send("Input.dispatchKeyEvent", { type: "keyUp", key: k }); }
  const saved = await waitFor(() => M.reqs.some((r) => r.method === "PUT" && r.url.includes(`/materials/${matId}`) && r.status === 200), 20000);
  check("autosave PUT after formula edit", saved.ok);
  const got = await api("GET", `/materials/${matId}`, null, tok);
  const latex = got.json?.material?.blocks?.find((b) => b.type === "formula")?.latex;
  check("saved latex contains edit", typeof latex === "string" && latex.includes("+1"), { latex });
  // повторное открытие
  M.reqs.length = 0;
  await M.send("Page.reload", { ignoreCache: false });
  check("reopen: formula rendered by KaTeX", (await waitFor(() => M.eval(`!!document.querySelector('.katex')`), 30000)).ok);
  check("reopen: mathlive not loaded until edit", M.asset(/^FormulaEditor-/).length === 0);
  await M.click(editBtn);
  const f2 = await waitFor(() => M.eval(`document.querySelector('math-field')?.value || ''`), 30000);
  check("reopen: edit shows saved latex", f2.ok && String(f2.v).includes("+1"), { value: f2.v });
  check("editor: no page errors", M.errors.length === 0, M.errors);
  await B.call("Target.disposeBrowserContext", { browserContextId: M.browserContextId });
} catch (e) { check("exception (formula)", false, String(e)); }

console.log(`TEMP_MATERIAL_ID=${matId}`);
console.log(`SUMMARY ${results.filter((r) => r.ok).length}/${results.length}`);
process.exit(0);
